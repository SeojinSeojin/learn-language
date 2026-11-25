// Minimal client for a local Ollama server (keyless fallback for script text). Only loopback hosts are
// accepted: the model runs on the same machine (the GitHub-hosted runner in CI).
import { UserFacingError } from '../util/errors';
import type { TextGenerator } from '../text/provider';

export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';
/** CPU inference on a 4-vCPU runner: one schema-constrained script takes a few minutes. */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 15 * 60_000;
const NS_PER_MS = 1_000_000;

export class OllamaError extends UserFacingError {
  constructor(message: string, hint?: string, readonly status?: number) {
    super(message, hint);
    this.name = 'OllamaError';
  }
}

/** Normalizes OLLAMA_HOST ("127.0.0.1:11434" or "http://localhost:11434") and refuses non-loopback hosts. */
export function ollamaBaseUrl(host = process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST): string {
  const withScheme = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new OllamaError(`OLLAMA_HOST is not a valid host: "${host}".`);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new OllamaError(`OLLAMA_HOST must be a loopback address (got "${url.hostname}").`, 'The Qwen fallback runs Ollama on localhost only.');
  }
  return url.origin;
}

export function ollamaModel(value = process.env.OLLAMA_MODEL?.trim()): string {
  const model = value || DEFAULT_OLLAMA_MODEL;
  if (!/^[\w.-]+(?::[\w.-]+)?$/.test(model)) throw new OllamaError(`OLLAMA_MODEL is not a valid model tag: "${model}".`);
  return model;
}

/** Timing reported by Ollama for one request (milliseconds). */
export interface OllamaCallStats {
  wallMs: number;
  loadMs: number;
  totalMs: number;
  promptTokens?: number;
  outputTokens?: number;
  doneReason?: string;
}

export interface OllamaOptions {
  host?: string;
  model?: string;
  timeoutMs?: number;
  /** Every request's timing is appended here (for run summaries). */
  stats?: OllamaCallStats[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function post(base: string, path: string, body: unknown, model: string, timeoutMs: number): Promise<any> {
  const service = `Ollama (${model})`;
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new OllamaError(`${service}: request timed out after ${Math.round(timeoutMs / 1000)} s.`);
    }
    throw new OllamaError(`${service}: cannot reach the local Ollama server at ${base} (${e.message}).`, 'Start it first (the workflow does this with .github/actions/ollama).');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new OllamaError(`${service}: non-JSON response (HTTP ${res.status}).`, undefined, res.status);
  }
  if (!res.ok || typeof json?.error === 'string') {
    const detail = typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
    throw new OllamaError(
      `${service}: ${detail}`,
      res.status === 404 ? `Pull the model first: ollama pull ${model}` : undefined,
      res.status,
    );
  }
  return json;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function statsOf(json: any, wallMs: number): OllamaCallStats {
  const ms = (ns: unknown) => (typeof ns === 'number' ? ns / NS_PER_MS : 0);
  return {
    wallMs,
    loadMs: ms(json?.load_duration),
    totalMs: ms(json?.total_duration),
    promptTokens: json?.prompt_eval_count,
    outputTokens: json?.eval_count,
    doneReason: json?.done_reason,
  };
}

/** GET /api/version: confirms the server is up. */
export async function ollamaVersion(opts: OllamaOptions = {}): Promise<string> {
  const base = ollamaBaseUrl(opts.host);
  try {
    const res = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(10_000) });
    const json = (await res.json()) as { version?: string };
    if (!res.ok || typeof json.version !== 'string') throw new Error(`HTTP ${res.status}`);
    return json.version;
  } catch (err) {
    throw new OllamaError(`The local Ollama server at ${base} is not running (${(err as Error).message}).`, 'Start it first (the workflow does this with .github/actions/ollama).');
  }
}

/** Loads the model into memory (empty prompt) and keeps it loaded. Returns Ollama's timing. */
export async function ollamaLoadModel(opts: OllamaOptions = {}): Promise<OllamaCallStats> {
  const base = ollamaBaseUrl(opts.host);
  const model = ollamaModel(opts.model);
  const t0 = performance.now();
  const json = await post(base, '/api/generate', { model, prompt: '', keep_alive: -1, stream: false }, model, opts.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS);
  const stats = statsOf(json, performance.now() - t0);
  opts.stats?.push(stats);
  return stats;
}

/** Strips an (empty) <think> block in case a model emits one despite think:false. */
function stripThinking(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
}

/**
 * Text generator backed by Ollama /api/chat: thinking disabled, output constrained to the JSON schema
 * (`format`), schema also shown in the prompt as Ollama recommends. The caller validates the result.
 */
export function ollamaTextGenerator(opts: OllamaOptions = {}): TextGenerator {
  const base = ollamaBaseUrl(opts.host);
  const model = ollamaModel(opts.model);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
  return {
    label: `Qwen (${model} via Ollama)`,
    provider: 'ollama',
    model,
    async generate(prompt, schema) {
      const t0 = performance.now();
      const json = await post(
        base,
        '/api/chat',
        {
          model,
          messages: [{ role: 'user', content: `${prompt}\n\nJSON schema of the answer:\n${JSON.stringify(schema)}` }],
          format: schema,
          think: false,
          stream: false,
          keep_alive: -1,
          // Qwen3 non-thinking sampling recommendations; 8k context fits prompt + schema + answer.
          options: { temperature: 0.7, top_p: 0.8, top_k: 20, num_ctx: 8192 },
        },
        model,
        timeoutMs,
      );
      opts.stats?.push(statsOf(json, performance.now() - t0));
      const content = json?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new OllamaError(`Ollama (${model}): empty response.`);
      return stripThinking(content);
    },
  };
}

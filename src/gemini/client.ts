// Low-level Gemini Interactions API client (dialogue + TTS share this).
// The API key is only ever sent in the x-goog-api-key header and is never logged.
import { ProviderUnavailableError, QuotaExhaustedError, UserFacingError, type QuotaScope } from '../util/errors';

export const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/**
 * Endpoint for Interactions requests. GEMINI_INTERACTIONS_URL may point at a loopback mock server
 * (the Actions smoke test uses one); any other host is refused so the API key can't be redirected.
 */
export function interactionsUrl(override = process.env.GEMINI_INTERACTIONS_URL?.trim()): string {
  if (!override) return INTERACTIONS_URL;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    throw new UserFacingError(`GEMINI_INTERACTIONS_URL is not a valid URL: "${override}".`);
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new UserFacingError('GEMINI_INTERACTIONS_URL may only point at a loopback mock server (http://127.0.0.1:PORT/...).');
  }
  return url.href;
}

let geminiBlocked: string | undefined;
/**
 * Refuse every Gemini request from now on in this process (e.g. a Short built from a prepared script
 * with Edge TTS must make none). Any attempt throws instead of reaching the network.
 */
export function blockGeminiRequests(reason: string | undefined) {
  geminiBlocked = reason;
}
export const DEFAULT_TIMEOUT_MS = 120_000;
/** Longest server-requested wait we honour for a per-minute 429 (free-tier RPM limits). */
const MAX_QUOTA_RETRY_AFTER_S = 65;
/** Per-minute rate-limit retries per request. Daily-quota errors are never retried. */
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_SERVER_RETRIES = 2;

export const QUOTA_HINT =
  'Free-tier limits reset over time (requests-per-day resets at midnight Pacific time). ' +
  'Check your current usage at https://aistudio.google.com/rate-limit, wait and re-run, ' +
  'or choose another free model via GEMINI_MODEL / GEMINI_TTS_MODEL.';

export interface CallOptions {
  apiKey: string;
  timeoutMs?: number;
  /** Base delay for 5xx/network retry backoff (default 2000 ms). Tests set this to 0. */
  retryBaseMs?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Interaction = Record<string, any>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ParsedError {
  message: string;
  status?: string;
  retryDelayS?: number;
  /** quotaId values from google.rpc.QuotaFailure details, e.g. "GenerateRequestsPerDayPerProjectPerModel-FreeTier". */
  quotaIds: string[];
}

function parseErrorBody(text: string): ParsedError {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { message: text.trim().slice(0, 500), quotaIds: [] };
  }
  // Google's standard shape is {error:{code,message,status,details}}; some proxies wrap it in an array.
  const root = Array.isArray(json) ? json[0] : json;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err: any = (root as any)?.error ?? root;
  const message = typeof err?.message === 'string' ? err.message : typeof err === 'string' ? err : text.trim().slice(0, 500);
  const status = typeof err?.status === 'string' ? err.status : undefined;
  let retryDelayS: number | undefined;
  const quotaIds: string[] = [];
  if (Array.isArray(err?.details)) {
    for (const d of err.details) {
      const m = typeof d?.retryDelay === 'string' ? /^([\d.]+)s$/.exec(d.retryDelay) : null;
      if (m) retryDelayS = Number(m[1]);
      if (Array.isArray(d?.violations)) {
        for (const v of d.violations) {
          const id = typeof v?.quotaId === 'string' ? v.quotaId : typeof v?.quotaMetric === 'string' ? v.quotaMetric : undefined;
          if (id) quotaIds.push(id);
        }
      }
    }
  }
  return { message, status, retryDelayS, quotaIds };
}

/**
 * Daily vs short-lived quota for a 429. Structured QuotaFailure details win when present ("…PerDay…" vs
 * "…PerMinute…"); otherwise the API's message must say so, as in the observed free-tier error
 * "Rate limit exceeded for model gemini-3.6-flash (limit: 20 requests per day on Free Tier). Please retry
 * in 5h39m1s…". A bare 429 / RESOURCE_EXHAUSTED is `unknown`, never daily.
 */
export function quotaScope(err: { message: string; quotaIds?: string[] }): QuotaScope {
  const ids = err.quotaIds ?? [];
  if (ids.some((id) => /per[_-]?day/i.test(id))) return 'daily';
  if (ids.some((id) => /per[_-]?(minute|second)/i.test(id))) return 'short';
  if (/\brequests?\s+per\s+day\b|\bper\s+day\b|\bRPD\b|\bdaily\s+(request\s+)?(quota|limit)\b/i.test(err.message)) return 'daily';
  if (/\bper\s+(minute|second)\b|\bRPM\b|\bTPM\b/i.test(err.message)) return 'short';
  return 'unknown';
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, (t - Date.now()) / 1000) : undefined;
}

/**
 * POSTs one Interactions API request and returns the parsed Interaction JSON.
 * Never switches model or provider. 429 is retried at most once (only when the server asks for a
 * short wait); 5xx/network errors are retried up to twice with backoff.
 */
export async function callInteraction(body: Record<string, unknown>, opts: CallOptions): Promise<Interaction> {
  const model = typeof body.model === 'string' ? body.model : 'unknown model';
  const service = `Gemini (${model})`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = opts.retryBaseMs ?? 2000;
  if (geminiBlocked) throw new UserFacingError(`${service}: request blocked. ${geminiBlocked}`);
  const url = interactionsUrl();
  let serverRetries = 0;
  let rateLimitRetries = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        // Timeouts are not retried (each one already waited timeoutMs). Typed so callers can fall back.
        throw new ProviderUnavailableError(
          'gemini',
          'timeout',
          `${service}: request timed out after ${Math.round(timeoutMs / 1000)} s.`,
          'The Gemini API may be slow or unreachable; try again later.',
        );
      }
      if (serverRetries < MAX_SERVER_RETRIES) {
        serverRetries++;
        await sleep(base * 2 ** (serverRetries - 1));
        continue;
      }
      throw new UserFacingError(`${service}: network error contacting the Gemini API (${(err as Error).message}).`, 'Check your internet connection and try again.');
    }
    clearTimeout(timer);

    if (res.ok) {
      try {
        return JSON.parse(text) as Interaction;
      } catch {
        throw new UserFacingError(`${service}: the API returned a non-JSON response.`);
      }
    }

    const err = parseErrorBody(text);
    if (res.status === 429 || err.status === 'RESOURCE_EXHAUSTED') {
      const wait = parseRetryAfter(res.headers.get('retry-after')) ?? err.retryDelayS;
      // A per-day / exhausted quota stops immediately. A per-minute rate limit with a short
      // server-suggested delay is waited out (still free tier), a bounded number of times.
      const scope = quotaScope(err);
      const noRetry = scope === 'daily' || /daily|exhausted your/i.test(err.message);
      if (!noRetry && rateLimitRetries < MAX_RATE_LIMIT_RETRIES && wait !== undefined && wait <= MAX_QUOTA_RETRY_AFTER_S) {
        rateLimitRetries++;
        console.warn(`  … ${service}: per-minute free-tier rate limit hit; waiting ${Math.ceil(wait)} s as the API asks (retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES}).`);
        await sleep(wait * 1000 + (wait > 0 ? 500 : 0));
        continue;
      }
      throw new QuotaExhaustedError(service, err.message, QUOTA_HINT, { provider: 'gemini', model, scope });
    }
    if (res.status === 400) {
      throw new UserFacingError(`${service}: request rejected (400 ${err.status ?? 'INVALID_ARGUMENT'}): ${err.message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new UserFacingError(
        `${service}: GEMINI_API_KEY is invalid or not authorized (${res.status}): ${err.message}`,
        'Create or check a key at https://aistudio.google.com/apikey and set GEMINI_API_KEY.',
      );
    }
    if (res.status === 404) {
      throw new UserFacingError(
        `${service}: model not found or unavailable (404): ${err.message}`,
        'Set GEMINI_MODEL (dialogue) or GEMINI_TTS_MODEL (speech) to an available model.',
      );
    }
    if (res.status >= 500 && serverRetries < MAX_SERVER_RETRIES) {
      serverRetries++;
      await sleep(base * 2 ** (serverRetries - 1));
      continue;
    }
    const message = `${service}: API error ${res.status}${err.status ? ` ${err.status}` : ''}: ${err.message}`;
    if (res.status >= 500) {
      // Retries exhausted: the server is persistently failing.
      throw new ProviderUnavailableError('gemini', 'http', message, 'The Gemini API is having trouble; try again later.', res.status);
    }
    throw new UserFacingError(message);
  }
}

function checkStatus(interaction: Interaction, what: string) {
  const status = interaction?.status;
  const errors: string[] = Array.isArray(interaction?.errors)
    ? interaction.errors.map((e: { code?: unknown; message?: unknown }) => [e?.code, e?.message].filter(Boolean).join(': ')).filter(Boolean)
    : [];
  if (status === 'failed' || status === 'incomplete' || status === 'cancelled') {
    throw new UserFacingError(`Gemini interaction ${status} while generating ${what}${errors.length ? `: ${errors.join('; ')}` : '.'}`);
  }
  return errors;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function outputContents(interaction: Interaction): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  if (Array.isArray(interaction?.steps)) {
    for (const step of interaction.steps) {
      if (step?.type !== 'model_output') continue;
      if (Array.isArray(step.content)) out.push(...step.content);
      else if (step.content) out.push(step.content);
    }
  }
  // Older Interactions responses used a flat `outputs[]` list.
  if (Array.isArray(interaction?.outputs)) out.push(...interaction.outputs);
  return out;
}

/** Concatenated model text output. Throws UserFacingError if the interaction failed or has no text. */
export function extractText(interaction: Interaction): string {
  const errors = checkStatus(interaction, 'text');
  if (typeof interaction?.output_text === 'string' && interaction.output_text.trim()) return interaction.output_text;
  const text = outputContents(interaction)
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  if (!text.trim()) throw new UserFacingError(`Gemini returned no text output${errors.length ? `: ${errors.join('; ')}` : '.'}`);
  return text;
}

export interface ExtractedAudio {
  data: string;
  mimeType?: string;
}

/** Base64 audio from the interaction (plus mime type when reported). */
export function extractAudio(interaction: Interaction): ExtractedAudio {
  const errors = checkStatus(interaction, 'audio');
  const oa = interaction?.output_audio;
  if (typeof oa?.data === 'string' && oa.data) return { data: oa.data, mimeType: oa.mime_type ?? oa.mimeType };
  for (const c of outputContents(interaction)) {
    if (c?.type === 'audio' && typeof c.data === 'string' && c.data) return { data: c.data, mimeType: c.mime_type ?? c.mimeType };
  }
  throw new UserFacingError(`Gemini returned no audio output${errors.length ? `: ${errors.join('; ')}` : '.'}`);
}

export function extractAudioBase64(interaction: Interaction): string {
  return extractAudio(interaction).data;
}

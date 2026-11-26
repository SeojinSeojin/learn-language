// Text providers for script generation. The dialogue/vocab generators own the prompts, retry-with-issues
// loop and Zod validation; a provider only turns (prompt, JSON schema) into raw JSON text.
import { callInteraction, extractText } from '../gemini/client';
import { ProviderUnavailableError, QuotaExhaustedError } from '../util/errors';

export interface TextGenerator {
  /** Short name used in logs and error messages, e.g. "Gemini" or "Qwen (qwen3:8b via Ollama)". */
  readonly label: string;
  readonly provider: 'gemini' | 'ollama';
  readonly model: string;
  /** Returns the model's raw text (expected to be JSON matching `schema`). */
  generate(prompt: string, schema: Record<string, unknown>): Promise<string>;
}

export interface GeminiTextOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  retryBaseMs?: number;
}

export function geminiTextGenerator(opts: GeminiTextOptions): TextGenerator {
  return {
    label: 'Gemini',
    provider: 'gemini',
    model: opts.model,
    async generate(prompt, schema) {
      const interaction = await callInteraction(
        { model: opts.model, input: prompt, response_format: { type: 'text', mime_type: 'application/json', schema } },
        { apiKey: opts.apiKey, timeoutMs: opts.timeoutMs, retryBaseMs: opts.retryBaseMs },
      );
      return extractText(interaction);
    },
  };
}

/** HTTP statuses that, after Gemini's own bounded retries, let a batch fall back to the local model. */
export const FALLBACK_HTTP_STATUSES: readonly number[] = [503];

/**
 * Gemini confirmed that the daily request quota is used up (QuotaFailure "…PerDay…" or the API's
 * "requests per day" message). A short-lived per-minute limit or a bare 429 is not this.
 */
export function isGeminiDailyQuotaExhausted(err: unknown): err is QuotaExhaustedError {
  return err instanceof QuotaExhaustedError && err.provider === 'gemini' && err.scope === 'daily';
}

/**
 * True only for a Gemini outage after its retry policy is exhausted (a request timeout or a persistent
 * HTTP 503). Short-lived or unconfirmed quota (429), auth, bad-request and validation errors never fall back;
 * a confirmed daily quota is handled separately by isGeminiDailyQuotaExhausted.
 */
export function isGeminiFallbackEligible(err: unknown): err is ProviderUnavailableError {
  return (
    err instanceof ProviderUnavailableError &&
    err.provider === 'gemini' &&
    (err.reason === 'timeout' || (err.reason === 'http' && err.status !== undefined && FALLBACK_HTTP_STATUSES.includes(err.status)))
  );
}

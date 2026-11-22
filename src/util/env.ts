import { existsSync } from 'node:fs';
import { UserFacingError } from './errors';

let loaded = false;
/** Loads ./.env for local runs (Node's built-in loader). CI uses real env vars. */
export function loadDotEnv() {
  if (loaded) return;
  loaded = true;
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export function optionalEnv(name: string): string | undefined {
  loadDotEnv();
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function requireEnv(name: string, hint?: string): string {
  const v = optionalEnv(name);
  if (!v) throw new UserFacingError(`Missing required environment variable ${name}.`, hint ?? 'Set it in .env locally or as a GitHub Actions secret/variable.');
  return v;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';

/** Minimal --flag value / --flag parser. Positional args are returned in `_`. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out: Record<string, string | boolean> & { _: string[] } = { _: [] } as never;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

export const TTS_PROVIDERS = ['edge', 'gemini'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

/** TTS_PROVIDER: "edge" (default, no API key) or "gemini". */
export function ttsProvider(value = optionalEnv('TTS_PROVIDER')): TtsProvider {
  const v = (value ?? 'edge').trim().toLowerCase();
  if ((TTS_PROVIDERS as readonly string[]).includes(v)) return v as TtsProvider;
  throw new UserFacingError(`TTS_PROVIDER must be one of: ${TTS_PROVIDERS.join(', ')} (got "${value}")`);
}

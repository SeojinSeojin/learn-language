// Microsoft Edge TTS provider (no API key), via the Python `edge-tts` CLI (pinned in requirements-tts.txt).
// One line per request, sequentially. Each successful line is cached by provider + voice + exact text,
// so a retry reuses it. Provider MP3 is converted to 24 kHz mono WAV with FFmpeg, and the measured WAV
// duration drives subtitles and animation.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Dialogue, Lang, Speaker } from '../../shared/types';
import { SPEAKERS } from '../../shared/types';
import { durationOf, readWav, writeWav } from '../audio/wav';
import { splitByPauses } from '../audio/split';
import { runFfmpeg } from '../render/ffmpeg';
import { optionalEnv } from '../util/env';
import { UserFacingError } from '../util/errors';

export type EdgeVoiceMap = Record<Speaker, Record<Lang, string>>;

/** Defaults. Edge offers only Dalia/Jorge (es-MX) and SunHi/InJoon/HyunsuMultilingual (ko-KR). */
export const EDGE_VOICES: EdgeVoiceMap = {
  lupita: { es: 'es-MX-DaliaNeural', ko: 'ko-KR-SunHiNeural' },
  jisoo: { es: 'es-MX-JorgeNeural', ko: 'ko-KR-InJoonNeural' },
};
export const EDGE_LOCALES: Record<Lang, string> = { es: 'es-MX', ko: 'ko-KR' };
export const EDGE_INSTALL_HINT = 'Install it with: pip install -r requirements-tts.txt   (or set TTS_PROVIDER=gemini)';

/** Voice map with EDGE_TTS_VOICE_{LUPITA,JISOO}_{ES,KO} overrides applied. */
export function resolveEdgeVoices(env: (k: string) => string | undefined = optionalEnv): EdgeVoiceMap {
  const out = {} as EdgeVoiceMap;
  for (const s of SPEAKERS) {
    out[s] = { ...EDGE_VOICES[s] };
    for (const lang of ['es', 'ko'] as Lang[]) {
      const v = env(`EDGE_TTS_VOICE_${s.toUpperCase()}_${lang.toUpperCase()}`);
      if (v) out[s][lang] = v.trim();
    }
  }
  return out;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type Runner = (args: string[], timeoutMs: number) => Promise<RunResult>;

export const edgeBin = () => optionalEnv('EDGE_TTS_BIN') ?? 'edge-tts';

/** Runs the edge-tts CLI with an argument array (no shell). */
export const runEdgeCli: Runner = (args, timeoutMs) =>
  new Promise((ok, fail) => {
    const p = spawn(edgeBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      stderr += `\n(timed out after ${Math.round(timeoutMs / 1000)} s)`;
    }, timeoutMs);
    p.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT') fail(new UserFacingError(`edge-tts command not found ("${edgeBin()}").`, EDGE_INSTALL_HINT));
      else fail(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      ok({ code, stdout, stderr });
    });
  });

function providerError(what: string, r: RunResult): UserFacingError {
  const detail = r.stderr.trim().split('\n').slice(-8).join('\n') || `exit code ${r.code}`;
  return new UserFacingError(
    `Edge TTS failed ${what}:\n${detail}`,
    'Microsoft\'s Edge TTS service is unofficial and can change without notice. Re-run to retry (finished lines are cached); if it keeps failing, upgrade edge-tts in requirements-tts.txt or set TTS_PROVIDER=gemini.',
  );
}

/** Parses `edge-tts --list-voices` (table: Name, Gender, ...) into voice ids. */
export function parseVoiceList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((n) => /^[a-z]{2,3}-[A-Z][A-Za-z]+-\w+Neural$/.test(n ?? ''));
}

/** Checks every configured voice against the provider's current voice list and its expected locale. */
export async function verifyEdgeVoices(voices: EdgeVoiceMap, run: Runner = runEdgeCli): Promise<void> {
  const r = await run(['--list-voices'], 60_000);
  if (r.code !== 0) throw providerError('to list voices', r);
  const available = parseVoiceList(r.stdout);
  if (!available.length) throw providerError('to list voices (empty or unrecognized voice list)', r);
  const issues: string[] = [];
  for (const s of SPEAKERS) {
    for (const lang of ['es', 'ko'] as Lang[]) {
      const v = voices[s][lang];
      const env = `EDGE_TTS_VOICE_${s.toUpperCase()}_${lang.toUpperCase()}`;
      const locale = EDGE_LOCALES[lang];
      if (!v.startsWith(locale + '-')) issues.push(`${env}="${v}" is not a ${locale} voice`);
      else if (!available.includes(v)) {
        issues.push(`${env}="${v}" is not in Edge's voice list (available ${locale}: ${available.filter((a) => a.startsWith(locale + '-')).join(', ')})`);
      }
    }
  }
  if (issues.length) throw new UserFacingError(`Edge TTS voice check failed:\n${issues.map((i) => `  - ${i}`).join('\n')}`, 'Set the EDGE_TTS_VOICE_* variables to voices from the list.');
}

export const cacheDir = () => resolve(optionalEnv('TTS_CACHE_DIR') ?? '.cache/tts');

/** Cache key: provider + voice + exact text. */
export function edgeCacheKey(voice: string, text: string): string {
  return createHash('sha256').update(JSON.stringify(['edge', voice, text])).digest('hex').slice(0, 32);
}

export interface EdgeLineResult {
  path: string;
  duration: number;
  cached: boolean;
}

/**
 * Synthesizes one line to `outPath` (24 kHz mono WAV, trimmed to speech with small padding).
 * Tries `attempts` times (transient network errors), then throws the provider error.
 */
export async function synthesizeEdgeLine(
  o: { text: string; voice: string; outPath: string; attempts?: number; readCache?: boolean },
  run: Runner = runEdgeCli,
): Promise<EdgeLineResult> {
  const dir = join(cacheDir(), 'edge');
  mkdirSync(dir, { recursive: true });
  const cached = join(dir, `${edgeCacheKey(o.voice, o.text)}.wav`);
  if (o.readCache !== false && existsSync(cached) && statSync(cached).size > 44) {
    copyFileSync(cached, o.outPath);
    return { path: o.outPath, duration: durationOf(readWav(o.outPath)), cached: true };
  }
  const tmp = mkdtempSync(join(tmpdir(), 'edge-tts-'));
  try {
    const mp3 = join(tmp, 'line.mp3');
    const attempts = Math.max(1, o.attempts ?? 2);
    let last: RunResult | undefined;
    for (let a = 1; a <= attempts; a++) {
      // `--text=` keeps text that starts with "-" from being read as an option.
      last = await run(['--voice', o.voice, `--text=${o.text}`, '--write-media', mp3], 90_000);
      if (last.code === 0 && existsSync(mp3) && statSync(mp3).size > 0) break;
      last = { ...last, code: last.code === 0 ? -1 : last.code, stderr: last.stderr || 'no audio was written' };
      if (a < attempts) {
        console.log(`  … Edge TTS attempt ${a} failed, retrying in 3 s`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (!last || last.code !== 0) throw providerError(`for ${o.voice}: "${o.text}"`, last ?? { code: null, stdout: '', stderr: '' });

    const rawWav = join(tmp, 'line.wav');
    await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', mp3, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', rawWav]);
    // Trim provider lead-in/tail silence so gaps between lines match the timeline's spacing.
    const [clip] = splitByPauses(readWav(rawWav), [1]);
    const partial = `${cached}.${process.pid}.tmp`;
    writeWav(partial, clip);
    renameSync(partial, cached); // atomic: a crash never leaves a half-written cache entry
    copyFileSync(cached, o.outPath);
    return { path: o.outPath, duration: durationOf(clip), cached: false };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** All 12 lines, sequentially. Writes audio/{lang}-{n}.wav. Stops at the first failure. */
export async function synthesizeDialogueEdge(dialogue: Dialogue, outDir: string, o: { voices?: EdgeVoiceMap; run?: Runner; voicesVerified?: boolean } = {}) {
  const voices = o.voices ?? resolveEdgeVoices();
  const run = o.run ?? runEdgeCli;
  if (!o.voicesVerified) await verifyEdgeVoices(voices, run);
  const dir = join(outDir, 'audio');
  mkdirSync(dir, { recursive: true });
  const paths: Record<Lang, string[]> = { es: [], ko: [] };
  let fresh = 0;
  for (const lang of ['es', 'ko'] as Lang[]) {
    for (const [i, line] of dialogue.lines.entries()) {
      const voice = voices[line.speaker][lang];
      const text = lang === 'es' ? line.esMX : line.ko;
      const r = await synthesizeEdgeLine({ text, voice, outPath: join(dir, `${lang}-${i + 1}.wav`) }, run);
      if (!r.cached) fresh++;
      console.log(`  ${r.cached ? '↺' : '✓'} audio/${lang}-${i + 1}.wav  ${r.duration.toFixed(2)} s  (${line.speaker}, ${voice}${r.cached ? ', cached' : ''})`);
      paths[lang].push(r.path);
    }
  }
  console.log(`  Edge TTS requests this run: ${fresh} (12 lines, ${12 - fresh} from cache)`);
  return paths;
}

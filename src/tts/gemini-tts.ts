// Gemini TTS (Interactions API): one request per line, fixed voice per character.
// The `text` field is a verbatim transcript; delivery/accent guidance goes in the speech_metadata style.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Dialogue, Lang, Speaker } from '../../shared/types';
import { SPEAKERS } from '../../shared/types';
import { durationOf, encodeWav, parseWav, pcm16ToWav, type PcmAudio } from '../audio/wav';
import { lineWeight, SplitError, splitByPauses } from '../audio/split';
import { callInteraction, extractAudio } from '../gemini/client';
import { optionalEnv } from '../util/env';
import { QuotaExhaustedError, UserFacingError } from '../util/errors';

export type VoiceMap = Record<Speaker, Record<Lang, string>>;

/** Default fixed voices: Lupita = Leda (Youthful), Jisoo = Charon (Informative), same in both languages. */
export const VOICES: VoiceMap = {
  lupita: { es: 'Leda', ko: 'Leda' },
  jisoo: { es: 'Charon', ko: 'Charon' },
};

/** VOICES with env overrides GEMINI_TTS_VOICE_{LUPITA,JISOO}_{ES,KO}. */
export function resolveVoices(): VoiceMap {
  const out = {} as VoiceMap;
  for (const speaker of Object.keys(VOICES) as Speaker[]) {
    out[speaker] = {} as Record<Lang, string>;
    for (const lang of ['es', 'ko'] as Lang[]) {
      out[speaker][lang] = optionalEnv(`GEMINI_TTS_VOICE_${speaker.toUpperCase()}_${lang.toUpperCase()}`) ?? VOICES[speaker][lang];
    }
  }
  return out;
}

export const LANGUAGE_CODES: Record<Lang, string> = { es: 'es-MX', ko: 'ko-KR' };

export const STYLE: Record<Lang, string> = {
  es: 'Natural Mexican Spanish (es-MX) pronunciation and intonation, as spoken in Mexico City; friendly, relaxed, clear conversational pace for language learners. Read the transcript exactly as written.',
  ko: 'Standard South Korean (Seoul, ko-KR) pronunciation; friendly, natural, clear conversational pace for language learners. Read the transcript exactly as written.',
};

const DEFAULT_PCM_RATE = 24000;
const MIN_DURATION_S = 0.2;
const MIN_PEAK = 1e-3;

export interface SynthesizeLineOptions {
  text: string;
  lang: Lang;
  speaker: Speaker;
  apiKey: string;
  model: string;
  voices?: VoiceMap;
  timeoutMs?: number;
  retryBaseMs?: number;
  /** Delivery guidance (speech_metadata.style). Defaults to STYLE[lang]. Never spoken. */
  style?: string;
}

export interface SynthesizedLine {
  wav: Buffer;
  audio: PcmAudio;
  voice: string;
}

/** Decodes a TTS payload (RIFF WAV or headerless L16) into a validated WAV buffer. */
export function decodeTtsAudio(base64: string, mimeType?: string): { wav: Buffer; audio: PcmAudio } {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new UserFacingError('Gemini TTS returned empty audio.');
  let wav: Buffer;
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF') {
    wav = bytes;
  } else {
    const rate = Number(/rate=(\d+)/i.exec(mimeType ?? '')?.[1]) || DEFAULT_PCM_RATE;
    wav = pcm16ToWav(bytes.length % 2 ? bytes.subarray(0, bytes.length - 1) : bytes, rate);
  }
  let audio: PcmAudio;
  try {
    audio = parseWav(wav);
  } catch (err) {
    throw new UserFacingError(`Gemini TTS returned audio that could not be decoded: ${(err as Error).message}`);
  }
  const dur = durationOf(audio);
  if (dur < MIN_DURATION_S) throw new UserFacingError(`Gemini TTS returned near-empty audio (${dur.toFixed(2)} s).`);
  let peak = 0;
  for (let i = 0; i < audio.samples.length; i++) peak = Math.max(peak, Math.abs(audio.samples[i]));
  if (peak < MIN_PEAK) throw new UserFacingError('Gemini TTS returned silent audio.');
  return { wav, audio };
}

export async function synthesizeLineDetailed(o: SynthesizeLineOptions): Promise<SynthesizedLine> {
  const text = o.text.trim();
  if (!text) throw new UserFacingError(`Cannot synthesize an empty ${o.lang} line.`);
  const voice = (o.voices ?? resolveVoices())[o.speaker][o.lang];
  const interaction = await callInteraction(
    {
      model: o.model,
      input: [
        {
          type: 'user_input',
          content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: o.style ?? STYLE[o.lang] }] }],
        },
      ],
      response_format: { type: 'audio', mime_type: 'audio/wav' },
      generation_config: { speech_config: [{ voice, language: LANGUAGE_CODES[o.lang] }] },
    },
    { apiKey: o.apiKey, timeoutMs: o.timeoutMs, retryBaseMs: o.retryBaseMs },
  );
  const { data, mimeType } = extractAudio(interaction);
  return { ...decodeTtsAudio(data, mimeType), voice };
}

/** Synthesizes one line (text only — never the speaker label) and returns a validated WAV buffer. */
export async function synthesizeLine(o: SynthesizeLineOptions): Promise<Buffer> {
  return (await synthesizeLineDetailed(o)).wav;
}

export interface TtsProgress {
  lang: Lang;
  lineNo: number;
  path: string;
  duration: number;
  voice: string;
}

export interface SynthesizeDialogueOptions {
  apiKey: string;
  model: string;
  onProgress?: (p: TtsProgress) => void;
  voices?: VoiceMap;
  /** Minimum gap between request starts. Default: 60 s / GEMINI_TTS_RPM (free tier: 3 RPM → ~20 s). */
  spacingMs?: number;
  /** Keep valid WAVs already in outDir/audio (resume after a rate-limit/quota stop). */
  reuseExisting?: boolean;
  timeoutMs?: number;
  retryBaseMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extra delivery guidance for a batch request; the transcript itself stays verbatim. */
export const BATCH_STYLE_SUFFIX =
  ' The transcript contains separate lines of dialogue, one per paragraph: read each exactly as written and leave a clear pause of about one second between lines.';

function reusable(path: string): PcmAudio | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const a = parseWav(readFileSync(path));
    return durationOf(a) >= MIN_DURATION_S ? a : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Free-tier friendly synthesis: ONE request per character per language (4 requests per episode).
 * Each request reads that character's three lines verbatim (one paragraph per line, fixed voice);
 * the returned clip is split at the pauses into outDir/audio/{es,ko}-1..6.wav, and the per-line
 * WAV durations drive captions and animation. Stops immediately on QuotaExhaustedError.
 */
export async function synthesizeDialogue(dialogue: Dialogue, outDir: string, opts: SynthesizeDialogueOptions): Promise<{ es: string[]; ko: string[] }> {
  const dir = resolve(outDir, 'audio');
  mkdirSync(dir, { recursive: true });
  const voices = opts.voices ?? resolveVoices();
  const rpm = Number(optionalEnv('GEMINI_TTS_RPM') ?? 3);
  const spacing = opts.spacingMs ?? (rpm > 0 ? Math.ceil(60_000 / rpm) + 300 : 0);
  const pathOf = (lang: Lang, i: number) => join(dir, `${lang}-${i + 1}.wav`);
  let lastStart = 0;
  let requests = 0;

  for (const lang of ['es', 'ko'] as Lang[]) {
    for (const speaker of SPEAKERS) {
      const idx = dialogue.lines.map((l, i) => (l.speaker === speaker ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      const texts = idx.map((i) => (lang === 'es' ? dialogue.lines[i].esMX : dialogue.lines[i].ko).trim());
      if (opts.reuseExisting && idx.every((i) => reusable(pathOf(lang, i)))) {
        idx.forEach((i) => console.log(`  ↺ audio/${lang}-${i + 1}.wav  ${durationOf(reusable(pathOf(lang, i))!).toFixed(2)} s  (reused)`));
        continue;
      }
      const waitMs = lastStart ? lastStart + spacing - Date.now() : 0;
      if (waitMs > 0) {
        console.log(`  … waiting ${Math.ceil(waitMs / 1000)} s (free-tier limit GEMINI_TTS_RPM=${rpm})`);
        await sleep(waitMs);
      }
      lastStart = Date.now();
      requests++;
      let synth: SynthesizedLine;
      try {
        synth = await synthesizeLineDetailed({
          text: texts.join('\n\n'),
          lang,
          speaker,
          apiKey: opts.apiKey,
          model: opts.model,
          voices,
          timeoutMs: opts.timeoutMs,
          retryBaseMs: opts.retryBaseMs,
          style: STYLE[lang] + (texts.length > 1 ? BATCH_STYLE_SUFFIX : ''),
        });
      } catch (err) {
        if (err instanceof QuotaExhaustedError) console.error(`  ✖ Quota exhausted at ${lang}/${speaker} (request ${requests}); stopping TTS (no further requests).`);
        throw err;
      }
      writeFileSync(join(dir, `${lang}-${speaker}-batch.wav`), synth.wav);
      let clips: PcmAudio[];
      try {
        clips = splitByPauses(synth.audio, texts.map(lineWeight));
      } catch (err) {
        if (err instanceof SplitError) {
          throw new UserFacingError(
            `Could not split ${speaker}'s ${lang} TTS audio into ${texts.length} lines: ${err.message}.`,
            `The raw clip is saved at audio/${lang}-${speaker}-batch.wav. Re-run with --resume --out ${outDir} to retry only the missing lines.`,
          );
        }
        throw err;
      }
      clips.forEach((clip, k) => {
        const i = idx[k];
        writeFileSync(pathOf(lang, i), encodeWav(clip));
        const duration = durationOf(clip);
        console.log(`  ✓ audio/${lang}-${i + 1}.wav  ${duration.toFixed(2)} s  (${speaker}, ${synth.voice}, ${clip.sampleRate} Hz)`);
        opts.onProgress?.({ lang, lineNo: i + 1, path: pathOf(lang, i), duration, voice: synth.voice });
      });
    }
  }
  console.log(`  TTS requests this run: ${requests} (max 4 per episode)`);
  return {
    es: dialogue.lines.map((_, i) => pathOf('es', i)),
    ko: dialogue.lines.map((_, i) => pathOf('ko', i)),
  };
}

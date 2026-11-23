// Speech for vocabulary mode. Every word is spoken twice per language, first in Lupita's voice and then in
// Jisoo's (VOCAB_VOICE_ORDER), so learners hear a female and a male speaker. One WAV per word, language and
// voice: audio/w{n}-{lang}-{speaker}.wav.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VOCAB_VOICE_ORDER, type Lang, type Speaker, type VocabWord } from '../../shared/types';
import { durationOf, encodeWav, parseWav, writeWav, type PcmAudio } from '../audio/wav';
import { SplitError, splitByLongestPauses } from '../audio/split';
import { synthesizeEdgeLine, type EdgeVoiceMap, type Runner, runEdgeCli } from '../tts/edge-tts';
import { STYLE, resolveVoices, synthesizeLineDetailed, type VoiceMap, type SynthesizedLine } from '../tts/gemini-tts';
import { synthTestSpeech } from '../tts/test-audio';
import { optionalEnv } from '../util/env';
import { QuotaExhaustedError, UserFacingError } from '../util/errors';

/** Per word: for each language, one WAV path per voice in VOCAB_VOICE_ORDER. */
export type VocabAudioPaths = Record<Lang, string[]>[];

const LANGS: Lang[] = ['es', 'ko'];
const textOf = (w: VocabWord, lang: Lang) => (lang === 'es' ? w.esMX : w.ko);

export function vocabAudioPath(dir: string, i: number, lang: Lang, speaker: Speaker) {
  return join(dir, 'audio', `w${i + 1}-${lang}-${speaker}.wav`);
}

function allPaths(words: VocabWord[], dir: string): VocabAudioPaths {
  return words.map((_, i) => ({
    es: VOCAB_VOICE_ORDER.map((s) => vocabAudioPath(dir, i, 'es', s)),
    ko: VOCAB_VOICE_ORDER.map((s) => vocabAudioPath(dir, i, 'ko', s)),
  }));
}

/** Local placeholder audio (sample mode only, not real speech). */
export function writeVocabTestAudio(words: VocabWord[], jobDir: string): VocabAudioPaths {
  mkdirSync(join(jobDir, 'audio'), { recursive: true });
  words.forEach((w, i) => {
    for (const lang of LANGS) for (const s of VOCAB_VOICE_ORDER) writeWav(vocabAudioPath(jobDir, i, lang, s), synthTestSpeech(textOf(w, lang), lang, s));
  });
  return allPaths(words, jobDir);
}

/** Edge TTS: one request per word, language and voice (cached per line), a few at a time. */
export async function synthesizeVocabEdge(words: VocabWord[], jobDir: string, o: { voices: EdgeVoiceMap; run?: Runner; concurrency?: number }): Promise<VocabAudioPaths> {
  mkdirSync(join(jobDir, 'audio'), { recursive: true });
  const jobs: { i: number; lang: Lang; speaker: Speaker }[] = [];
  words.forEach((_, i) => LANGS.forEach((lang) => VOCAB_VOICE_ORDER.forEach((speaker) => jobs.push({ i, lang, speaker }))));
  let next = 0;
  let fresh = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { i, lang, speaker } = jobs[next++];
      const voice = o.voices[speaker][lang];
      const outPath = vocabAudioPath(jobDir, i, lang, speaker);
      const r = await synthesizeEdgeLine({ text: textOf(words[i], lang), voice, outPath }, o.run ?? runEdgeCli);
      if (!r.cached) fresh++;
      console.log(`  ${r.cached ? '↺' : '✓'} audio/w${i + 1}-${lang}-${speaker}.wav  ${r.duration.toFixed(2)} s  (${voice}${r.cached ? ', cached' : ''})`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 3) }, worker));
  console.log(`  Edge TTS requests this run: ${fresh} (${jobs.length} clips, ${jobs.length - fresh} from cache)`);
  return allPaths(words, jobDir);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reusable(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return durationOf(parseWav(readFileSync(path))) >= 0.15;
  } catch {
    return false;
  }
}

/** Delivery guidance for a word-list request; the transcript itself stays verbatim. */
export const VOCAB_BATCH_STYLE_SUFFIX =
  ' The transcript is a list of separate vocabulary words, one per paragraph: say each one clearly, exactly as written, and leave a pause of about one second between words.';

/**
 * Gemini TTS: ONE request per voice per language (4 requests per video, like dialogue mode). Each request
 * reads every word, one paragraph per word, and the clip is split at the longest pauses.
 */
export async function synthesizeVocabGemini(
  words: VocabWord[],
  jobDir: string,
  o: { apiKey: string; model: string; voices?: VoiceMap; reuseExisting?: boolean; spacingMs?: number; timeoutMs?: number; retryBaseMs?: number },
): Promise<VocabAudioPaths> {
  const dir = resolve(jobDir, 'audio');
  mkdirSync(dir, { recursive: true });
  const voices = o.voices ?? resolveVoices();
  const rpm = Number(optionalEnv('GEMINI_TTS_RPM') ?? 3);
  const spacing = o.spacingMs ?? (rpm > 0 ? Math.ceil(60_000 / rpm) + 300 : 0);
  let lastStart = 0;
  let requests = 0;
  for (const lang of LANGS) {
    for (const speaker of VOCAB_VOICE_ORDER) {
      const paths = words.map((_, i) => vocabAudioPath(jobDir, i, lang, speaker));
      if (o.reuseExisting && paths.every(reusable)) {
        console.log(`  ↺ ${lang}/${speaker}: ${paths.length} words reused`);
        continue;
      }
      const waitMs = lastStart ? lastStart + spacing - Date.now() : 0;
      if (waitMs > 0) {
        console.log(`  … waiting ${Math.ceil(waitMs / 1000)} s (free-tier limit GEMINI_TTS_RPM=${rpm})`);
        await sleep(waitMs);
      }
      lastStart = Date.now();
      requests++;
      const texts = words.map((w) => textOf(w, lang));
      let synth: SynthesizedLine;
      try {
        synth = await synthesizeLineDetailed({
          text: texts.join('\n\n'),
          lang,
          speaker,
          apiKey: o.apiKey,
          model: o.model,
          voices,
          timeoutMs: o.timeoutMs,
          retryBaseMs: o.retryBaseMs,
          style: STYLE[lang] + VOCAB_BATCH_STYLE_SUFFIX,
        });
      } catch (err) {
        if (err instanceof QuotaExhaustedError) console.error(`  ✖ Quota exhausted at ${lang}/${speaker} (request ${requests}); stopping TTS.`);
        throw err;
      }
      const batch = `${lang}-${speaker}-batch.wav`;
      writeFileSync(join(dir, batch), synth.wav);
      let clips: PcmAudio[];
      try {
        clips = splitByLongestPauses(synth.audio, texts.length);
      } catch (err) {
        if (err instanceof SplitError) {
          throw new UserFacingError(
            `Could not split ${speaker}'s ${lang} word list into ${texts.length} words: ${err.message}.`,
            `The raw clip is saved at audio/${batch}. Re-run with --resume --out ${jobDir} to retry only the missing parts.`,
          );
        }
        throw err;
      }
      clips.forEach((clip, i) => {
        writeFileSync(paths[i], encodeWav(clip));
        console.log(`  ✓ audio/w${i + 1}-${lang}-${speaker}.wav  ${durationOf(clip).toFixed(2)} s  (${synth.voice})`);
      });
    }
  }
  console.log(`  TTS requests this run: ${requests} (max 4 per video)`);
  return allPaths(words, jobDir);
}

// Vocabulary-mode timeline: intro card → one view per word (Spanish ×2, then Korean ×2) → outro card.
// Timing comes from the measured WAV durations; words are dropped from the end until the video fits
// VOCAB_MAX_SECONDS (a Short), keeping at least VOCAB_MIN words.
import { VOCAB_VOICE_ORDER, type Lang, type TimelineCard, type VocabList, type VocabTimeline, type VocabTimelineClip, type VocabTimelineWord } from '../../shared/types';
import { durationOf, resample, type PcmAudio } from '../audio/wav';
import { synthJingle } from '../audio/jingle';
import { FPS, HEIGHT, WIDTH, hashSeed } from '../timeline/build';
import { UserFacingError } from '../util/errors';
import { VOCAB_MIN } from './schema';

export const VOCAB_MAX_SECONDS = 59;

export const VOCAB_TIMING = {
  intro: 1.7,
  leadIn: 0.25, // after the intro card, before the first word appears
  pre: 0.35, // word on screen before its first clip
  repGap: 0.3, // between the two voices of one language
  langGap: 0.5, // between Spanish and Korean
  post: 0.45, // after the last clip, before the next word appears
  outroGap: 0.15,
  outro: 1.7,
} as const;

/** Per word: for each language, one clip per voice in VOCAB_VOICE_ORDER. */
export type VocabClips = Record<Lang, PcmAudio[]>[];

const LANGS: Lang[] = ['es', 'ko'];
const T = VOCAB_TIMING;

export function wordSeconds(clips: Record<Lang, PcmAudio[]>): number {
  const speech = LANGS.reduce((s, l) => s + clips[l].reduce((x, c) => x + durationOf(c), 0), 0);
  return T.pre + speech + 2 * T.repGap + T.langGap + T.post;
}

export function vocabSeconds(clips: VocabClips): number {
  return T.intro + T.leadIn + clips.reduce((s, c) => s + wordSeconds(c), 0) + T.outroGap + T.outro;
}

/** The largest number of leading words whose video fits maxSeconds. Throws if even VOCAB_MIN words do not fit. */
export function fitWordCount(clips: VocabClips, maxSeconds = VOCAB_MAX_SECONDS, minWords = VOCAB_MIN): number {
  let n = clips.length;
  // Frame rounding can add up to one frame.
  while (n > 0 && vocabSeconds(clips.slice(0, n)) + 1 / FPS > maxSeconds) n--;
  if (n < Math.min(minWords, clips.length)) {
    throw new UserFacingError(
      `Only ${n} word(s) fit in ${maxSeconds} s (need at least ${minWords}); the spoken words are too long.`,
      'Re-run, or use a topic with simpler, shorter words.',
    );
  }
  return n;
}

export interface BuildVocabOptions {
  music?: boolean;
  /** Relative image URL and short credit per word (undefined = text card). */
  images?: ({ url: string; credit: string } | undefined)[];
}

export function buildVocabTimeline(list: VocabList, clips: VocabClips, opts: BuildVocabOptions = {}): { timeline: VocabTimeline; master: PcmAudio } {
  if (clips.length !== list.words.length) throw new Error(`Expected audio for ${list.words.length} words, got ${clips.length}`);
  const rate = clips[0].es[0].sampleRate;
  const placed: { start: number; audio: PcmAudio }[] = [];
  const words: VocabTimelineWord[] = [];
  const n = list.words.length;
  const cards: TimelineCard[] = [
    { kind: 'intro', start: 0, end: T.intro, title: list.topic, subtitle: `${n} palabras · ${n}개 단어 · ${n} words` },
  ];
  let t = T.intro + T.leadIn;

  list.words.forEach((w, index) => {
    const start = t;
    t += T.pre;
    const wordClips: VocabTimelineClip[] = [];
    LANGS.forEach((lang, li) => {
      if (li > 0) t += T.langGap;
      VOCAB_VOICE_ORDER.forEach((voice, k) => {
        if (k > 0) t += T.repGap;
        const audio = resample(clips[index][lang][k], rate);
        const dur = durationOf(audio);
        wordClips.push({ lang, rep: k + 1, voice, start: round(t), end: round(t + dur) });
        placed.push({ start: round(t), audio });
        t += dur;
      });
    });
    t += T.post;
    const img = opts.images?.[index];
    words.push({
      index,
      start: round(start),
      end: round(t),
      esMX: w.esMX,
      ko: w.ko,
      koPronunciation: w.koPronunciation,
      en: w.en,
      ...(img ? { image: img.url, credit: img.credit } : {}),
      clips: wordClips,
    });
  });

  const outroStart = t + T.outroGap;
  cards.push({ kind: 'outro', start: round(outroStart), end: round(outroStart + T.outro), title: '¿Cuántas recordaste?', subtitle: '몇 개 기억나요?' });
  const frameCount = Math.ceil((outroStart + T.outro) * FPS);
  const duration = frameCount / FPS;

  const master = new Float32Array(Math.round(duration * rate));
  if (opts.music !== false) {
    const jingle = synthJingle(rate).samples; // ends before the first word's audio
    for (let i = 0; i < jingle.length && i < master.length; i++) master[i] += jingle[i];
  }
  for (const p of placed) {
    const off = Math.round(p.start * rate);
    for (let i = 0; i < p.audio.samples.length && off + i < master.length; i++) master[off + i] += p.audio.samples[i];
  }

  const timeline: VocabTimeline = {
    version: 1,
    mode: 'vocab',
    topic: list.topic,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    duration,
    frameCount,
    seed: hashSeed(list.topic + 'vocab'),
    cards,
    words,
    audio: 'audio/master.wav',
  };
  return { timeline, master: { sampleRate: rate, channels: 1, samples: master } };
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}

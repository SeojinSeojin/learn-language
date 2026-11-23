// Vocabulary mode: what is on screen at time t. A pure function of (timeline, t), so the browser
// preview and the frame-accurate renderer draw exactly the same thing.
import type { Lang, TimelineCard, VocabTimeline, VocabTimelineClip, VocabTimelineWord } from './types';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** Seconds a word view takes to fade/slide in, and to fade out at its end. */
export const VOCAB_ENTER_S = 0.35;
export const VOCAB_EXIT_S = 0.18;

export interface VocabState {
  card?: TimelineCard;
  cardAlpha: number;
  word?: VocabTimelineWord;
  wordAlpha: number;
  /** 0..1 progress of the word's entrance animation. */
  enter: number;
  /** The clip being spoken right now (if any). */
  clip?: VocabTimelineClip;
  /** 0..1 progress through the active clip. */
  clipProgress: number;
  /** Repetitions already started for each language (0..2), for the "×2" indicator. */
  heard: Record<Lang, number>;
  /** The language row to highlight: the one being spoken, or the one most recently spoken. */
  focus?: Lang;
}

export function vocabStateAt(tl: VocabTimeline, t: number): VocabState {
  const card = tl.cards.find((c) => t >= c.start && t < c.end);
  const cardAlpha = card ? Math.min(smooth((t - card.start) / 0.25), smooth((card.end - t) / 0.25)) : 0;
  const word = tl.words.find((w) => t >= w.start && t < w.end);
  const state: VocabState = { card, cardAlpha, word, wordAlpha: 0, enter: 0, clipProgress: 0, heard: { es: 0, ko: 0 } };
  if (!word) return state;
  state.enter = clamp01((t - word.start) / VOCAB_ENTER_S);
  state.wordAlpha = Math.min(smooth(state.enter * 1.6), smooth((word.end - t) / VOCAB_EXIT_S));
  for (const c of word.clips) {
    if (t >= c.start) {
      state.heard[c.lang] = Math.max(state.heard[c.lang], c.rep);
      state.focus = c.lang;
    }
    if (t >= c.start && t < c.end) {
      state.clip = c;
      state.clipProgress = clamp01((t - c.start) / Math.max(1e-3, c.end - c.start));
    }
  }
  return state;
}

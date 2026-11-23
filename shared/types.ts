// Types shared by the Node pipeline and the browser scene.
// Nothing in /shared or /web may import Node modules or read credentials.

export const GESTURES = ['none', 'wave', 'nod', 'tilt', 'shrug'] as const;
export type Gesture = (typeof GESTURES)[number];
export const SPEAKERS = ['lupita', 'jisoo'] as const;
export type Speaker = (typeof SPEAKERS)[number];

/** Recurring characters. Labels are shown as subtitles only (never spoken unless in the dialogue). */
export const CHARACTERS: Record<Speaker, { es: string; ko: string; color: number }> = {
  lupita: { es: 'Lupita', ko: '루피타', color: 0xf07c5a },
  jisoo: { es: 'Jisoo', ko: '지수', color: 0x3a7fc1 },
};
export type Lang = 'es' | 'ko';

export interface DialogueLine {
  speaker: Speaker;
  esMX: string;
  ko: string;
  koPronunciation: string;
  gesture: Gesture;
}

export interface Dialogue {
  topic: string;
  /** One of SCENE_IDS from shared/scenes.ts. */
  sceneId: string;
  lines: DialogueLine[];
  /** Topic-specific hashtags suggested by Gemini, normalized without "#" (may be empty). */
  hashtags?: string[];
}

export interface TimelineLine {
  index: number; // 0..11 across both sections
  lineNo: number; // 1..6 within the section
  lang: Lang;
  speaker: Speaker;
  start: number; // seconds
  end: number; // seconds (end of audio)
  text: string;
  pronunciation?: string; // Korean section only
  gesture: Gesture;
  /** Normalized speech amplitude (0..1) sampled at Timeline.envelopeRate, starting at `start`. */
  envelope: number[];
}

export interface TimelineCard {
  kind: 'intro' | 'switch' | 'outro';
  start: number;
  end: number;
  title: string;
  subtitle: string;
}

export interface TimelineSection {
  lang: Lang;
  start: number;
  end: number;
  label: string;
}

export interface Timeline {
  version: 1;
  topic: string;
  sceneId: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  frameCount: number;
  envelopeRate: number;
  seed: number;
  sections: TimelineSection[];
  cards: TimelineCard[];
  lines: TimelineLine[];
  /** Relative URL (from the timeline JSON) of the mixed audio, used by browser preview. */
  audio: string;
}

// ---------- Vocabulary mode ----------

/** One vocabulary item: the same concept in Mexican Spanish, Korean and English. */
export interface VocabWord {
  /** Mexican Spanish, nouns with their article (e.g. "la manzana"). */
  esMX: string;
  ko: string;
  koPronunciation: string;
  en: string;
  /** English Wikipedia article whose lead image shows the word (image lookup only). */
  wikiTitle: string;
  /** Short English search phrase for Wikimedia Commons (image lookup fallback). */
  imageQuery: string;
}

export interface VocabList {
  topic: string;
  words: VocabWord[];
  /** Topic-specific hashtags suggested by Gemini, normalized without "#" (may be empty). */
  hashtags?: string[];
}

/** Each language is spoken twice: first in Lupita's voice, then in Jisoo's. */
export const VOCAB_VOICE_ORDER: readonly Speaker[] = ['lupita', 'jisoo'];

export interface VocabTimelineClip {
  lang: Lang;
  /** 1 or 2: which repetition of this language. */
  rep: number;
  voice: Speaker;
  start: number;
  end: number;
}

export interface VocabTimelineWord {
  index: number; // 0-based
  start: number; // word view appears
  end: number; // word view gone
  esMX: string;
  ko: string;
  koPronunciation: string;
  en: string;
  /** Relative URL (from the timeline JSON) of the square picture, if one was found. */
  image?: string;
  /** Short on-screen credit for the picture (author · license · source). */
  credit?: string;
  clips: VocabTimelineClip[];
}

export interface VocabTimeline {
  version: 1;
  mode: 'vocab';
  topic: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  frameCount: number;
  seed: number;
  cards: TimelineCard[];
  words: VocabTimelineWord[];
  audio: string;
}

/** What timeline.json may contain: a dialogue episode (no `mode`) or a vocabulary episode. */
export type AnyTimeline = Timeline | VocabTimeline;

export function isVocabTimeline(t: AnyTimeline): t is VocabTimeline {
  return (t as VocabTimeline).mode === 'vocab';
}

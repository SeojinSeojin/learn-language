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

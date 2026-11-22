// Deterministic animation: every pose is a pure function of (timeline, character, t).
// The same code drives browser preview (real-time) and frame-accurate video rendering.
import type { Gesture, Speaker, Timeline, TimelineLine } from './types';

export interface Pose {
  bodyY: number; // px, positive = down
  headRot: number; // radians
  headX: number; // px
  headY: number; // px
  faceX: number; // px shift of facial features (head turn)
  faceY: number; // px shift of facial features (nod/pitch)
  gazeX: number; // -1..1 (screen left/right)
  gazeY: number; // -1..1 (up/down)
  lidClose: number; // 0 open .. 1 closed
  browRaise: number; // -1 frown .. 1 raised
  browTilt: number; // asymmetric raise (curious)
  mouthOpen: number; // 0..1
  smile: number; // -1..1
  shoulderLift: number; // px
  outerUpper: number; // radians, outward raise of the arm away from the partner
  outerFore: number; // radians, elbow bend (positive = forearm up/inward)
  innerUpper: number;
  innerFore: number;
}

export const NEUTRAL_POSE: Pose = {
  bodyY: 0, headRot: 0, headX: 0, headY: 0, faceX: 0, faceY: 0, gazeX: 0, gazeY: 0,
  lidClose: 0, browRaise: 0, browTilt: 0, mouthOpen: 0, smile: 0.25, shoulderLift: 0,
  outerUpper: 0.12, outerFore: 0.15, innerUpper: 0.12, innerFore: 0.15,
};

type PoseDelta = Partial<Pose>;

// ---------- small math helpers ----------
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (x: number) => {
  const c = clamp(x);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Attack / hold / release envelope for gestures, 0..1. */
function gestureEnvelope(u: number, dur: number, attack = 0.25, release = 0.3): number {
  if (u < 0 || u > dur) return 0;
  return Math.min(smooth(u / attack), smooth((dur - u) / release));
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- reusable gesture presets ----------
export interface GesturePreset {
  duration: number;
  /** u = seconds since gesture start, dir = +1 if partner is to the right, -1 if left. */
  pose(u: number, dir: number): PoseDelta;
}

export const GESTURE_PRESETS: Record<Exclude<Gesture, 'none'>, GesturePreset> = {
  wave: {
    duration: 1.9,
    pose(u) {
      const e = gestureEnvelope(u, 1.9, 0.3, 0.35);
      const swing = Math.sin(u * Math.PI * 2 * 2.1) * 0.38 * smooth((u - 0.2) / 0.2);
      return {
        outerUpper: 2.55 * e,
        outerFore: (0.55 + swing) * e,
        smile: 0.45 * e,
        browRaise: 0.35 * e,
      };
    },
  },
  nod: {
    duration: 1.05,
    pose(u) {
      const e = gestureEnvelope(u, 1.05, 0.12, 0.2);
      const bob = Math.max(0, Math.sin((u / 1.05) * Math.PI * 4)) * e; // two nods
      return { headY: 9 * bob, faceY: 7 * bob, headRot: 0, browRaise: 0.15 * e, smile: 0.2 * e };
    },
  },
  tilt: {
    duration: 1.5,
    pose(u, dir) {
      const e = gestureEnvelope(u, 1.5, 0.3, 0.4);
      return { headRot: 0.2 * dir * e, browTilt: 0.8 * e, browRaise: 0.3 * e, gazeY: -0.25 * e };
    },
  },
  shrug: {
    duration: 1.5,
    pose(u, dir) {
      const e = gestureEnvelope(u, 1.5, 0.28, 0.4);
      return {
        shoulderLift: 14 * e,
        outerUpper: 0.75 * e,
        outerFore: 1.25 * e,
        innerUpper: 0.75 * e,
        innerFore: 1.25 * e,
        headRot: -0.09 * dir * e,
        browRaise: 0.7 * e,
        smile: -0.15 * e,
      };
    },
  },
};

interface ScheduledGesture {
  start: number;
  gesture: Exclude<Gesture, 'none'>;
}

interface GazeSegment {
  start: number;
  x: number;
  y: number;
}

interface Reaction {
  start: number;
  kind: 'nod' | 'brows';
}

/** Precomputes deterministic schedules (blinks, gaze, reactions) for one character. */
export class CharacterAnimator {
  readonly speaker: Speaker;
  readonly dir: number; // +1 partner is to the right
  private blinks: number[] = [];
  private gaze: GazeSegment[] = [];
  private gestures: ScheduledGesture[] = [];
  private reactions: Reaction[] = [];
  private phase: number;

  /** dir = +1 when the partner stands to the right; basePose = static scene pose offsets. */
  constructor(private timeline: Timeline, speaker: Speaker, dir: 1 | -1, private basePose: Partial<Pose> = {}) {
    this.speaker = speaker;
    this.dir = dir;
    const rand = mulberry32(timeline.seed * 31 + (speaker === 'lupita' ? 7 : 13));
    this.phase = rand() * Math.PI * 2;

    // Blinks every 2.2–5 s, with an occasional double blink.
    for (let t = 0.6 + rand() * 1.5; t < timeline.duration; t += 2.2 + rand() * 2.8) {
      this.blinks.push(t);
      if (rand() < 0.15) this.blinks.push(t + 0.32);
    }

    // Gaze segments: look at partner / camera / glance away depending on role.
    let t = 0;
    while (t < timeline.duration) {
      const mid = t + 0.8;
      const role = this.roleAt(mid);
      const r = rand();
      let x = 0;
      let y = 0;
      if (role === 'card') {
        x = r < 0.6 ? 0 : this.dir * 0.8;
      } else if (role === 'speaking') {
        if (r < 0.65) x = this.dir * 0.9;
        else if (r < 0.92) x = 0;
        else { x = -this.dir * 0.5; y = -0.5; } // thinking glance
      } else {
        // listening: mostly looks toward the speaker, sometimes at camera or away
        if (r < 0.72) x = this.dir * 0.95;
        else if (r < 0.88) x = 0;
        else { x = -this.dir * 0.6; y = 0.35; }
      }
      x += (rand() - 0.5) * 0.15;
      y += (rand() - 0.5) * 0.2;
      this.gaze.push({ start: t, x, y });
      t += 1.1 + rand() * 2.2;
    }

    for (const line of timeline.lines) {
      if (line.speaker === speaker) {
        if (line.gesture !== 'none') this.gestures.push({ start: line.start + 0.08, gesture: line.gesture });
      } else {
        // Listener reacts sometimes (nod or raised brows), later in the partner's line.
        const r = rand();
        const at = lerp(line.start, line.end, 0.45 + rand() * 0.3);
        if (r < 0.5) this.reactions.push({ start: at, kind: 'nod' });
        else if (r < 0.78) this.reactions.push({ start: at, kind: 'brows' });
      }
    }
  }

  private activeLine(t: number): TimelineLine | undefined {
    return this.timeline.lines.find((l) => t >= l.start && t < l.end);
  }

  private roleAt(t: number): 'speaking' | 'listening' | 'card' {
    const card = this.timeline.cards.find((c) => t >= c.start && t < c.end);
    if (card) return 'card';
    // Use nearest line (also covers short gaps between lines).
    let best: TimelineLine | undefined;
    let bestD = Infinity;
    for (const l of this.timeline.lines) {
      const d = t < l.start ? l.start - t : t > l.end ? t - l.end : 0;
      if (d < bestD) { bestD = d; best = l; }
    }
    return best && best.speaker === this.speaker ? 'speaking' : 'listening';
  }

  /** Mouth opening from the audio amplitude envelope of the active line (speaker only). */
  mouthAt(t: number): number {
    const line = this.activeLine(t);
    if (!line || line.speaker !== this.speaker) return 0;
    const pos = (t - line.start) * this.timeline.envelopeRate;
    const i = Math.floor(pos);
    const a = line.envelope[i] ?? 0;
    const b = line.envelope[i + 1] ?? 0;
    const e = lerp(a, b, pos - i);
    return clamp((e - 0.06) * 1.25);
  }

  pose(t: number): Pose {
    const p: Pose = { ...NEUTRAL_POSE };
    for (const key of Object.keys(this.basePose) as (keyof Pose)[]) p[key] += this.basePose[key] ?? 0;
    const dir = this.dir;

    // Idle breathing.
    p.bodyY = Math.sin(t * ((Math.PI * 2) / 3.6) + this.phase) * 3;
    p.headY = Math.sin(t * ((Math.PI * 2) / 3.6) + this.phase - 0.6) * 1.5;

    // Gaze with quick saccade-like transitions.
    let gi = 0;
    while (gi + 1 < this.gaze.length && this.gaze[gi + 1].start <= t) gi++;
    const g = this.gaze[gi];
    const prev = this.gaze[Math.max(0, gi - 1)];
    const k = smooth((t - g.start) / 0.16);
    p.gazeX = lerp(prev.x, g.x, k);
    p.gazeY = lerp(prev.y, g.y, k);
    // Head turns partially toward gaze, lagging a bit.
    const hk = smooth((t - g.start) / 0.45);
    const headTurn = lerp(prev.x, g.x, hk);
    p.faceX = headTurn * 9;
    p.headX = headTurn * 4;
    p.headRot += headTurn * 0.035;

    // Blinks (~150 ms).
    for (const b of this.blinks) {
      const u = t - b;
      if (u >= 0 && u < 0.16) p.lidClose = Math.max(p.lidClose, 1 - Math.abs(u - 0.07) / 0.09);
    }
    p.lidClose = clamp(p.lidClose);

    // Speaking: mouth from amplitude, small emphasis on head and brows.
    const m = this.mouthAt(t);
    p.mouthOpen = m;
    if (m > 0) {
      p.browRaise += m * 0.25;
      p.headRot += Math.sin(t * 5.3 + this.phase) * 0.025 * m;
      p.headY += -m * 2;
    }

    // Gestures (speaker) and reactions (listener).
    const deltas: PoseDelta[] = [];
    for (const sg of this.gestures) {
      const preset = GESTURE_PRESETS[sg.gesture];
      const u = t - sg.start;
      if (u >= 0 && u <= preset.duration) deltas.push(preset.pose(u, dir));
    }
    for (const r of this.reactions) {
      const u = t - r.start;
      if (r.kind === 'nod') {
        if (u >= 0 && u <= 1.05) {
          const d = GESTURE_PRESETS.nod.pose(u, dir);
          deltas.push({ headY: (d.headY ?? 0) * 0.7, faceY: (d.faceY ?? 0) * 0.7, smile: 0.25 });
        }
      } else if (u >= 0 && u <= 1.2) {
        const e = gestureEnvelope(u, 1.2, 0.2, 0.35);
        deltas.push({ browRaise: 0.6 * e, smile: 0.35 * e });
      }
    }
    for (const d of deltas) {
      for (const key of Object.keys(d) as (keyof Pose)[]) p[key] += d[key] ?? 0;
    }
    p.smile = clamp(p.smile, -1, 1);
    p.browRaise = clamp(p.browRaise, -1, 1.2);
    return p;
  }
}

/** Which subtitle/card is visible at time t, with a fade factor. */
export function overlayAt(timeline: Timeline, t: number) {
  const fade = (start: number, end: number, f = 0.14) =>
    Math.min(smooth((t - start) / f), smooth((end - t) / f));
  const card = timeline.cards.find((c) => t >= c.start && t < c.end);
  // Keep a subtitle on screen through the short pause after its audio.
  const lines = timeline.lines;
  let line: TimelineLine | undefined;
  let lineAlpha = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    const holdEnd = next && next.lang === l.lang ? next.start : l.end + 0.5;
    if (t >= l.start - 0.1 && t < holdEnd) {
      line = l;
      lineAlpha = fade(l.start - 0.1, holdEnd, 0.12);
      break;
    }
  }
  const section = timeline.sections.find((s) => t >= s.start && t < s.end);
  return {
    card,
    cardAlpha: card ? fade(card.start, card.end, 0.25) : 0,
    line,
    lineAlpha,
    section,
  };
}

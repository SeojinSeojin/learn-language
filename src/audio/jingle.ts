// Original opening jingle, synthesized in code (no audio files, nothing licensed): a bright marimba-style
// C-major arpeggio that lands on a chord, about 1.8 s, under the intro title card. Deterministic.
import type { PcmAudio } from './wav';

export const JINGLE_SECONDS = 1.8;

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface Note {
  t: number; // start, seconds
  midi: number;
  vel: number; // 0..1
  decay: number; // seconds to ~-60 dB
  bell?: boolean; // add an inharmonic bell partial for sparkle
}

// C5 E5 G5 C6 run-up, then a C-major chord hit with a high sparkle and a soft bass note.
const NOTES: Note[] = [
  { t: 0.0, midi: 48, vel: 0.5, decay: 0.5 }, // C3 bass
  { t: 0.0, midi: 72, vel: 0.7, decay: 0.45 }, // C5
  { t: 0.12, midi: 76, vel: 0.7, decay: 0.45 }, // E5
  { t: 0.24, midi: 79, vel: 0.75, decay: 0.45 }, // G5
  { t: 0.36, midi: 84, vel: 0.8, decay: 0.5 }, // C6
  { t: 0.56, midi: 43, vel: 0.45, decay: 0.9 }, // G2 bass
  { t: 0.56, midi: 48, vel: 0.55, decay: 1.1 }, // C3
  { t: 0.56, midi: 72, vel: 0.6, decay: 1.2 }, // C5
  { t: 0.56, midi: 76, vel: 0.6, decay: 1.2 }, // E5
  { t: 0.56, midi: 79, vel: 0.6, decay: 1.2 }, // G5
  { t: 0.56, midi: 84, vel: 0.65, decay: 1.2 }, // C6
  { t: 0.62, midi: 88, vel: 0.35, decay: 0.9, bell: true }, // E6 sparkle
  { t: 0.7, midi: 91, vel: 0.25, decay: 0.8, bell: true }, // G6 sparkle
];

/** Renders the jingle at `sampleRate` (mono), peak-normalized to `peak`. */
export function synthJingle(sampleRate: number, peak = 0.5): PcmAudio {
  const out = new Float32Array(Math.round(JINGLE_SECONDS * sampleRate));
  for (const n of NOTES) {
    const f = midiHz(n.midi);
    const start = Math.round(n.t * sampleRate);
    const len = Math.min(out.length - start, Math.round(n.decay * 1.2 * sampleRate));
    const k = Math.log(1000) / n.decay; // exponential decay to -60 dB at `decay`
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / 0.004);
      const env = attack * Math.exp(-k * t);
      // Marimba-ish: fundamental + quickly decaying 4th harmonic; bells add a 2.76× inharmonic partial.
      let v = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.exp(-k * 3 * t) * Math.sin(2 * Math.PI * f * 4 * t);
      if (n.bell) v += 0.4 * Math.exp(-k * 1.5 * t) * Math.sin(2 * Math.PI * f * 2.76 * t);
      out[start + i] += v * env * n.vel;
    }
  }
  // Gentle fade over the last 0.3 s so nothing rings into the first spoken line.
  const fade = Math.round(0.3 * sampleRate);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  let max = 0;
  for (const s of out) max = Math.max(max, Math.abs(s));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / max;
  return { sampleRate, channels: 1, samples: out };
}

// Splits one TTS clip that reads N lines in a row into N per-line clips, using the
// pauses between lines. Boundaries are chosen among detected silent gaps, preferring long gaps
// near the positions predicted from each line's text length (so a comma pause inside a line
// is not mistaken for a line break).
import type { PcmAudio } from './wav';

const FRAME_S = 0.01;
const MIN_GAP_S = 0.12;
const EDGE_PAD_S = 0.08;

interface Gap {
  start: number; // seconds
  end: number;
  get mid(): number;
  get len(): number;
}

function frameRms(a: PcmAudio): number[] {
  const win = Math.max(1, Math.round(a.sampleRate * FRAME_S));
  const out: number[] = [];
  for (let i = 0; i < a.samples.length; i += win) {
    let s = 0;
    const end = Math.min(a.samples.length, i + win);
    for (let j = i; j < end; j++) s += a.samples[j] * a.samples[j];
    out.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  return out;
}

function silenceThreshold(rms: number[]): number {
  const sorted = [...rms].sort((x, y) => x - y);
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  return Math.max(floor * 2, loud * 0.06, 1e-4);
}

/** Speech span (first..last non-silent frame) in seconds. */
function speechSpan(rms: number[], thr: number): [number, number] {
  let a = 0;
  let b = rms.length - 1;
  while (a < rms.length && rms[a] < thr) a++;
  while (b > a && rms[b] < thr) b--;
  return [a * FRAME_S, (b + 1) * FRAME_S];
}

function findGaps(rms: number[], thr: number, from: number, to: number): Gap[] {
  const gaps: Gap[] = [];
  let runStart = -1;
  const i0 = Math.floor(from / FRAME_S);
  const i1 = Math.ceil(to / FRAME_S);
  for (let i = i0; i <= i1; i++) {
    const silent = i < i1 && rms[i] < thr;
    if (silent && runStart < 0) runStart = i;
    if (!silent && runStart >= 0) {
      const start = runStart * FRAME_S;
      const end = i * FRAME_S;
      if (end - start >= MIN_GAP_S) {
        gaps.push({ start, end, get mid() { return (this.start + this.end) / 2; }, get len() { return this.end - this.start; } });
      }
      runStart = -1;
    }
  }
  return gaps;
}

function slice(a: PcmAudio, from: number, to: number): PcmAudio {
  const s = Math.max(0, Math.round(from * a.sampleRate));
  const e = Math.min(a.samples.length, Math.round(to * a.sampleRate));
  return { sampleRate: a.sampleRate, channels: 1, samples: a.samples.slice(s, e) };
}

function trim(a: PcmAudio): PcmAudio {
  const rms = frameRms(a);
  const [s, e] = speechSpan(rms, silenceThreshold(rms));
  return slice(a, Math.max(0, s - EDGE_PAD_S), Math.min(a.samples.length / a.sampleRate, e + EDGE_PAD_S));
}

export class SplitError extends Error {}

/**
 * @param weights relative expected length of each line (e.g. syllable or character counts)
 * @returns one clip per line, trimmed to speech with a small padding
 */
export function splitByPauses(audio: PcmAudio, weights: number[]): PcmAudio[] {
  const n = weights.length;
  if (n === 1) return [trim(audio)];
  const rms = frameRms(audio);
  const thr = silenceThreshold(rms);
  const [s0, s1] = speechSpan(rms, thr);
  const span = s1 - s0;
  if (span <= 0.3) throw new SplitError('audio contains no speech');
  const gaps = findGaps(rms, thr, s0, s1);
  if (gaps.length < n - 1) {
    throw new SplitError(`found ${gaps.length} pause(s) but need ${n - 1} to separate ${n} lines`);
  }
  const total = weights.reduce((x, y) => x + y, 0);
  const expected: number[] = [];
  let acc = 0;
  for (let k = 0; k < n - 1; k++) {
    acc += weights[k];
    expected.push(s0 + (acc / total) * span);
  }

  // Exhaustive search over ordered gap combinations (n is small: 3 lines → 2 boundaries).
  let best: Gap[] | undefined;
  let bestScore = -Infinity;
  const pick: Gap[] = [];
  const search = (k: number, startIdx: number) => {
    if (k === n - 1) {
      let score = 0;
      pick.forEach((g, j) => {
        score += Math.min(g.len, 1.2) - 4 * (Math.abs(g.mid - expected[j]) / span);
      });
      if (score > bestScore) {
        bestScore = score;
        best = [...pick];
      }
      return;
    }
    for (let i = startIdx; i <= gaps.length - (n - 1 - k); i++) {
      pick.push(gaps[i]);
      search(k + 1, i + 1);
      pick.pop();
    }
  };
  search(0, 0);
  const cuts = best!.map((g) => g.mid);
  const bounds = [0, ...cuts, audio.samples.length / audio.sampleRate];
  const clips = bounds.slice(0, -1).map((b, i) => trim(slice(audio, b, bounds[i + 1])));
  clips.forEach((c, i) => {
    const d = c.samples.length / c.sampleRate;
    const share = weights[i] / total;
    // Sanity check: each line's audio should roughly match its text share (catches mis-splits).
    if (d < 0.25 || d / span < share * 0.35 || d / span > share * 2.6) {
      throw new SplitError(`line ${i + 1} split looks wrong (${d.toFixed(2)} s for ${(share * 100).toFixed(0)}% of the text)`);
    }
  });
  return clips;
}

/** Rough spoken-length weight for a line (Hangul syllables, or Spanish vowel groups). */
export function lineWeight(text: string): number {
  const hangul = text.match(/[가-힣]/g)?.length ?? 0;
  if (hangul) return hangul;
  return Math.max(1, text.toLowerCase().match(/[aeiouáéíóúü]+/g)?.length ?? 1);
}

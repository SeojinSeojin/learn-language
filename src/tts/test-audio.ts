// Local, deterministic placeholder "speech" for the no-credentials sample mode.
// It is a syllable-timed voiced buzz (not real words) so mouth sync, timing and
// the audio stream can be verified without calling any API.
import type { Lang, Speaker } from '../../shared/types';
import type { PcmAudio } from '../audio/wav';

const RATE = 24000;

function syllables(text: string, lang: Lang): { count: number; pausesAfter: Set<number> } {
  const pausesAfter = new Set<number>();
  let count = 0;
  if (lang === 'ko') {
    for (const ch of text) {
      if (/[가-힣]/.test(ch)) count++;
      else if (/[ ,.!?]/.test(ch) && count > 0) pausesAfter.add(count - 1);
    }
  } else {
    // Count vowel groups as syllables.
    const words = text.toLowerCase().split(/\s+/);
    for (const w of words) {
      const groups = w.match(/[aeiouáéíóúü]+/g)?.length ?? 0;
      count += Math.max(groups, w.replace(/[^a-zñ]/g, '') ? 1 : 0);
      if (count > 0) pausesAfter.add(count - 1);
    }
  }
  return { count: Math.max(1, count), pausesAfter };
}

export function synthTestSpeech(text: string, lang: Lang, speaker: Speaker): PcmAudio {
  const { count, pausesAfter } = syllables(text, lang);
  const f0 = speaker === 'lupita' ? 215 : 135;
  const sylDur = lang === 'ko' ? 0.17 : 0.155;
  const segs: { dur: number; voiced: boolean; pitch: number }[] = [{ dur: 0.12, voiced: false, pitch: 0 }];
  for (let i = 0; i < count; i++) {
    const progress = i / count;
    const contour = 1 + 0.08 * Math.sin(i * 1.7) - 0.12 * progress;
    segs.push({ dur: sylDur * (0.85 + 0.3 * ((i * 7) % 5) / 5), voiced: true, pitch: f0 * contour });
    if (pausesAfter.has(i)) segs.push({ dur: /[,.!?]/.test(text) && i === count - 1 ? 0 : 0.07, voiced: false, pitch: 0 });
  }
  segs.push({ dur: 0.15, voiced: false, pitch: 0 });
  const total = segs.reduce((s, x) => s + x.dur, 0);
  const out = new Float32Array(Math.round(total * RATE));
  let pos = 0;
  let phase = 0;
  for (const s of segs) {
    const n = Math.round(s.dur * RATE);
    for (let i = 0; i < n && pos + i < out.length; i++) {
      if (!s.voiced) continue;
      const u = i / n;
      const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.8;
      phase += (2 * Math.PI * s.pitch) / RATE;
      // A few harmonics with formant-ish weights give a soft vowel-like tone.
      const v = Math.sin(phase) * 0.55 + Math.sin(2 * phase) * 0.3 + Math.sin(3 * phase) * 0.18 + Math.sin(5 * phase) * 0.06;
      out[pos + i] = v * env * 0.32;
    }
    pos += n;
  }
  return { sampleRate: RATE, channels: 1, samples: out };
}

// Builds the single shared timeline (speech, subtitles, gestures, mouth) from measured WAV durations,
// and mixes the matching master audio track.
import type { Dialogue, Lang, Timeline, TimelineCard, TimelineLine } from '../../shared/types';
import { durationOf, resample, type PcmAudio } from '../audio/wav';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const ENVELOPE_RATE = 60;

const INTRO = 1.7;
const LEAD_IN = 0.25; // after a card, before the first line
const GAP = 0.45; // between lines
const SWITCH = 1.7;
const OUTRO = 1.8;

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

/** RMS amplitude per 1/rate s window, normalized to 0..1 with light smoothing. */
export function amplitudeEnvelope(audio: PcmAudio, rate = ENVELOPE_RATE): number[] {
  const win = Math.max(1, Math.round(audio.sampleRate / rate));
  const n = Math.ceil(audio.samples.length / win);
  const rms: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const end = Math.min(audio.samples.length, (i + 1) * win);
    for (let j = i * win; j < end; j++) sum += audio.samples[j] * audio.samples[j];
    rms.push(Math.sqrt(sum / Math.max(1, end - i * win)));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const ref = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  // Noise gate + fast attack / slower release so the mouth reads as speech.
  const out: number[] = [];
  let prev = 0;
  for (const v of rms) {
    const x = Math.min(1, Math.max(0, (v / ref - 0.08) / 0.92));
    prev = x > prev ? prev + (x - prev) * 0.75 : prev + (x - prev) * 0.35;
    out.push(Math.round(prev * 1000) / 1000);
  }
  return out;
}

export interface BuiltTimeline {
  timeline: Timeline;
  master: PcmAudio;
}

export function buildTimeline(dialogue: Dialogue, audio: { es: PcmAudio[]; ko: PcmAudio[] }): BuiltTimeline {
  if (audio.es.length !== 6 || audio.ko.length !== 6) throw new Error('Expected 6 Spanish and 6 Korean audio clips');
  const rate = audio.es[0].sampleRate;
  const clips = { es: audio.es.map((a) => resample(a, rate)), ko: audio.ko.map((a) => resample(a, rate)) };

  const lines: TimelineLine[] = [];
  const cards: TimelineCard[] = [];
  const placed: { start: number; audio: PcmAudio }[] = [];
  let t = 0;

  cards.push({ kind: 'intro', start: 0, end: INTRO, title: dialogue.topic, subtitle: 'Español de México → 한국어' });
  t = INTRO + LEAD_IN;

  const addSection = (lang: Lang) => {
    dialogue.lines.forEach((line, i) => {
      const clip = clips[lang][i];
      const dur = durationOf(clip);
      lines.push({
        index: lines.length,
        lineNo: i + 1,
        lang,
        speaker: line.speaker,
        start: round(t),
        end: round(t + dur),
        text: lang === 'es' ? line.esMX : line.ko,
        pronunciation: lang === 'ko' ? line.koPronunciation : undefined,
        gesture: line.gesture,
        envelope: amplitudeEnvelope(clip),
      });
      placed.push({ start: round(t), audio: clip });
      t += dur + (i < 5 ? GAP : 0);
    });
  };

  addSection('es');
  const esEnd = t + 0.55;
  cards.push({ kind: 'switch', start: round(esEnd), end: round(esEnd + SWITCH), title: 'Ahora en coreano', subtitle: '이제 한국어로!' });
  t = esEnd + SWITCH + LEAD_IN;
  const koStart = t;
  addSection('ko');
  const outroStart = t + 0.6;
  cards.push({ kind: 'outro', start: round(outroStart), end: round(outroStart + OUTRO), title: '¡Repite conmigo!', subtitle: '따라 해 보세요!' });

  const frameCount = Math.ceil((outroStart + OUTRO) * FPS);
  const duration = frameCount / FPS;
  const switchMid = round(esEnd + SWITCH / 2);

  const master = new Float32Array(Math.round(duration * rate));
  for (const p of placed) {
    const off = Math.round(p.start * rate);
    for (let i = 0; i < p.audio.samples.length && off + i < master.length; i++) master[off + i] += p.audio.samples[i];
  }

  const timeline: Timeline = {
    version: 1,
    topic: dialogue.topic,
    sceneId: dialogue.sceneId,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    duration,
    frameCount,
    envelopeRate: ENVELOPE_RATE,
    seed: hashSeed(dialogue.topic + dialogue.sceneId),
    sections: [
      { lang: 'es', start: 0, end: switchMid, label: 'ESPAÑOL · MÉXICO' },
      { lang: 'ko', start: switchMid, end: duration + 1, label: '한국어 · KOREAN' },
    ],
    cards,
    lines,
    audio: 'audio/master.wav',
  };
  void koStart;
  return { timeline, master: { sampleRate: rate, channels: 1, samples: master } };
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}

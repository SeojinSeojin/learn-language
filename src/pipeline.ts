// Shared pipeline steps used by the CLIs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import type { Dialogue, Lang } from '../shared/types';
import { isSceneId, SCENE_IDS } from '../shared/scenes';
import { readWav, writeWav, type PcmAudio } from './audio/wav';
import { buildTimeline } from './timeline/build';
import { synthTestSpeech } from './tts/test-audio';
import { renderVideo } from './render/render';
import { checkFfmpeg, verifyVideo } from './render/ffmpeg';
import { UserFacingError } from './util/errors';
import { optionalEnv } from './util/env';

export function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

export function assertRenderableScene(sceneId: string) {
  if (!isSceneId(sceneId)) throw new UserFacingError(`Scene "${sceneId}" is not an implemented preset. Allowed: ${SCENE_IDS.join(', ')}`);
}

/** Writes local placeholder WAVs (sample mode only). */
export function writeTestAudio(dialogue: Dialogue, jobDir: string) {
  mkdirSync(join(jobDir, 'audio'), { recursive: true });
  const paths: Record<Lang, string[]> = { es: [], ko: [] };
  dialogue.lines.forEach((l, i) => {
    for (const lang of ['es', 'ko'] as const) {
      const p = join(jobDir, 'audio', `${lang}-${i + 1}.wav`);
      writeWav(p, synthTestSpeech(lang === 'es' ? l.esMX : l.ko, lang, l.speaker));
      paths[lang].push(p);
    }
  });
  return paths;
}

/** OPENING_MUSIC=off (or 0/false/no) disables the intro jingle. */
export function openingMusicEnabled() {
  return !/^(off|0|false|no)$/i.test(optionalEnv('OPENING_MUSIC') ?? '');
}

/** Measures the WAVs, writes timeline.json and the mixed audio/master.wav. */
export function writeTimeline(dialogue: Dialogue, jobDir: string, audioPaths: Record<Lang, string[]>) {
  const load = (ps: string[]): PcmAudio[] => ps.map((p) => readWav(p));
  const { timeline, master } = buildTimeline(dialogue, { es: load(audioPaths.es), ko: load(audioPaths.ko) }, { music: openingMusicEnabled() });
  writeWav(join(jobDir, timeline.audio), master);
  writeFileSync(join(jobDir, 'timeline.json'), JSON.stringify(timeline, null, 1));
  return timeline;
}

export function defaultConcurrency() {
  return Math.max(1, Math.min(4, cpus().length - 1));
}

export async function renderAndVerify(jobDir: string, o: { concurrency?: number; renderer?: 'webgl' | 'canvas'; duration: number }) {
  checkFfmpeg();
  const outFile = join(jobDir, 'short.mp4');
  log(`Rendering frames with headless Chromium → ${outFile}`);
  let lastPct = -1;
  const r = await renderVideo({
    jobDir,
    outFile,
    concurrency: o.concurrency ?? defaultConcurrency(),
    renderer: o.renderer,
    onProgress: (d, t) => {
      const pct = Math.floor((d / t) * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        log(`  frames ${d}/${t} (${pct}%)`);
      }
    },
  });
  log(`Rendered ${r.frames} frames in ${r.seconds.toFixed(1)} s using PixiJS ${r.renderer} renderer`);
  const v = verifyVideo(outFile, { duration: o.duration });
  for (const c of v.checks) log(`  ${c}`);
  return { outFile, ...r, probe: v.probe };
}

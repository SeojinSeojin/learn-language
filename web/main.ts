// Browser entry for both modes:
//   ?mode=preview  – real-time playback synced to the mixed audio
//   ?mode=render   – exposes window.__short.frame(t) for frame-accurate capture by Playwright
// Loads only timeline JSON + audio from the local job directory; never sees credentials.
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-sans-kr/900.css';
import type { Timeline } from '../shared/types';
import { ShortScene } from './scene/scene';
import { Overlay } from './scene/overlay';

declare global {
  interface Window {
    __short?: {
      ready: Promise<{ renderer: string; duration: number; frameCount: number; fps: number }>;
      frame(t: number, type?: string, quality?: number): string;
    };
  }
}

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'render' ? 'render' : 'preview';
const timelineUrl = params.get('timeline') ?? 'job/timeline.json';
const rendererParam = params.get('renderer');
document.body.classList.add(mode);

async function loadFonts(timeline: Timeline) {
  const text = Overlay.allStrings(timeline).join(' ') + ' 0123456789·≈→!?¿¡';
  // Fontsource splits Noto Sans KR into unicode-range subsets; request exactly the glyphs we draw.
  await Promise.all(
    ['500', '700', '900'].map((w) => document.fonts.load(`${w} 64px "Noto Sans KR"`, text)),
  );
  await document.fonts.ready;
  if (!document.fonts.check(`700 64px "Noto Sans KR"`, '한국어')) throw new Error('Noto Sans KR failed to load');
}

async function boot() {
  const res = await fetch(timelineUrl);
  if (!res.ok) throw new Error(`Could not load ${timelineUrl} (${res.status})`);
  const timeline = (await res.json()) as Timeline;
  await loadFonts(timeline);

  const scene = new ShortScene(timeline);
  await scene.init({ renderer: rendererParam === 'canvas' || rendererParam === 'webgl' ? rendererParam : undefined });
  document.getElementById('stage')!.appendChild(scene.app.canvas);
  const canvas = scene.app.canvas as HTMLCanvasElement;

  if (mode === 'render') {
    return { scene, timeline, canvas };
  }

  // ---- preview ----
  const audio = new Audio(new URL(timeline.audio, new URL(timelineUrl, location.href)).href);
  const play = document.getElementById('play') as HTMLButtonElement;
  const seek = document.getElementById('seek') as HTMLInputElement;
  const time = document.getElementById('time')!;
  play.onclick = () => (audio.paused ? audio.play() : audio.pause());
  audio.onplay = () => (play.textContent = 'Pause');
  audio.onpause = () => (play.textContent = 'Play');
  seek.oninput = () => {
    audio.currentTime = (Number(seek.value) / 1000) * timeline.duration;
    draw();
  };
  const draw = () => {
    const t = Math.min(timeline.duration, audio.currentTime);
    scene.update(t);
    time.textContent = `${t.toFixed(1)}s / ${timeline.duration.toFixed(1)}s · ${scene.rendererName}`;
    if (!audio.paused) seek.value = String(Math.round((t / timeline.duration) * 1000));
  };
  const loop = () => {
    draw();
    requestAnimationFrame(loop);
  };
  loop();
  return { scene, timeline, canvas };
}

const booted = boot();
booted.catch((err) => {
  document.getElementById('error')!.textContent = String(err?.stack ?? err);
  console.error(err);
});

window.__short = {
  ready: booted.then(({ scene, timeline }) => ({
    renderer: scene.rendererName,
    duration: timeline.duration,
    frameCount: timeline.frameCount,
    fps: timeline.fps,
  })),
  frame(t: number, type = 'image/png', quality = 0.92) {
    throw new Error('Scene not ready');
    void t; void type; void quality;
  },
};
booted.then(({ scene, canvas }) => {
  window.__short!.frame = (t: number, type = 'image/png', quality = 0.92) => {
    scene.update(t);
    return canvas.toDataURL(type, quality);
  };
});

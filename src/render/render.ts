// Frame-accurate rendering: headless Chromium (Playwright) draws the PixiJS scene at explicit
// timestamps t = i / fps, frames are piped to FFmpeg and muxed with the master audio.
import { chromium, type Browser, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Timeline } from '../../shared/types';
import { buildWeb } from './build-web';
import { startServer } from './server';
import { ffmpegPath } from './ffmpeg';
import { UserFacingError } from '../util/errors';

// CPU-only WebGL (SwiftShader via ANGLE) so a GPU-less Ubuntu runner renders identically.
export const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'];

export interface RenderOptions {
  jobDir: string;
  outFile: string;
  concurrency?: number;
  renderer?: 'webgl' | 'canvas';
  format?: 'png' | 'jpeg';
  onProgress?: (done: number, total: number) => void;
  skipBuild?: boolean;
}

export async function openScenePage(browser: Browser, baseUrl: string, renderer?: string): Promise<{ page: Page; info: { renderer: string; frameCount: number; fps: number; duration: number } }> {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const q = new URLSearchParams({ mode: 'render', timeline: 'job/timeline.json' });
  if (renderer) q.set('renderer', renderer);
  await page.goto(`${baseUrl}/index.html?${q}`);
  try {
    const info = await page.evaluate(() => window.__short!.ready);
    return { page, info };
  } catch (e) {
    throw new Error(`Scene failed to initialise in Chromium: ${e}\n${errors.join('\n')}`);
  }
}

export async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  } catch (e) {
    if (String(e).includes("Executable doesn't exist")) {
      throw new UserFacingError('Playwright Chromium is not installed.', 'Run: npx playwright install chromium   (CI: npx playwright install --with-deps --only-shell chromium)');
    }
    throw e;
  }
}

export async function renderVideo(opts: RenderOptions): Promise<{ renderer: string; frames: number; seconds: number }> {
  const timeline = JSON.parse(readFileSync(join(opts.jobDir, 'timeline.json'), 'utf8')) as Timeline;
  const format = opts.format ?? 'png';
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  // Default: PixiJS Canvas renderer (pure CPU, ~2x faster than WebGL-on-SwiftShader, same output).
  const renderer = opts.renderer ?? 'canvas';
  const webDir = opts.skipBuild ? (await import('./build-web')).WEB_DIST : await buildWeb();
  const server = await startServer(webDir, opts.jobDir);
  const browser = await launchBrowser();
  const started = Date.now();
  try {
    const pages = await Promise.all(Array.from({ length: concurrency }, () => openScenePage(browser, server.url, renderer)));
    const usedRenderer = pages[0].info.renderer;
    const total = timeline.frameCount;

    const ff = spawn(
      ffmpegPath(),
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(timeline.fps), '-c:v', format === 'png' ? 'png' : 'mjpeg', '-i', 'pipe:0',
        '-i', join(opts.jobDir, timeline.audio),
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        '-r', String(timeline.fps), '-g', String(timeline.fps * 2),
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-t', timeline.duration.toFixed(3),
        '-movflags', '+faststart',
        opts.outFile,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let ffErr = '';
    ff.stderr.on('data', (d) => (ffErr = (ffErr + d).slice(-4000)));
    const ffDone = new Promise<void>((ok, fail) =>
      ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}: ${ffErr}`)))),
    );
    let stdinError: Error | undefined;
    ff.stdin.on('error', (e) => (stdinError = e));
    const write = (buf: Buffer) =>
      new Promise<void>((ok, fail) => {
        if (stdinError) return fail(new Error(`ffmpeg input closed: ${stdinError.message}\n${ffErr}`));
        if (ff.stdin.write(buf)) ok();
        else ff.stdin.once('drain', ok);
      });

    // Workers render frames out of order; a reorder buffer writes them sequentially.
    const ready = new Map<number, Buffer>();
    let nextIndex = 0;
    let nextWrite = 0;
    let writing = Promise.resolve();
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const flush = () => {
      writing = writing.then(async () => {
        while (ready.has(nextWrite)) {
          const buf = ready.get(nextWrite)!;
          ready.delete(nextWrite);
          await write(buf);
          nextWrite++;
          if (nextWrite % 30 === 0 || nextWrite === total) opts.onProgress?.(nextWrite, total);
        }
      });
      return writing;
    };
    await Promise.all(
      pages.map(async ({ page }) => {
        while (nextIndex < total) {
          const i = nextIndex++;
          // Avoid unbounded memory if one worker races ahead.
          while (i - nextWrite > concurrency * 8) await new Promise((r) => setTimeout(r, 5));
          const t = i / timeline.fps;
          const dataUrl = await page.evaluate(([tt, m]) => window.__short!.frame(tt as number, m as string, 0.95), [t, mime] as const);
          ready.set(i, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
          await flush();
        }
      }),
    );
    await flush();
    ff.stdin.end();
    await ffDone;
    return { renderer: usedRenderer, frames: total, seconds: (Date.now() - started) / 1000 };
  } finally {
    await browser.close();
    await server.close();
  }
}

// npm run scenes:preview   → one preview PNG per scene preset (Spanish + Korean subtitle frames)
// rendered by the same PixiJS scene in headless Chromium, into out/scene-previews/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCENE_IDS } from '../../shared/scenes';
import type { Timeline } from '../../shared/types';
import { SAMPLE_DIALOGUE } from '../dialogue/sample';
import { log, writeTestAudio, writeTimeline } from '../pipeline';
import { buildWeb } from '../render/build-web';
import { startServer } from '../render/server';
import { launchBrowser, openScenePage } from '../render/render';
import { parseArgs } from '../util/env';
import { runCli } from '../util/errors';

runCli(async () => {
  const args = parseArgs();
  const outRoot = resolve(String(args.out ?? 'out/scene-previews'));
  const renderer = args.renderer === 'webgl' ? 'webgl' : 'canvas';
  const webDir = await buildWeb();
  const browser = await launchBrowser();
  try {
    for (const sceneId of SCENE_IDS) {
      const jobDir = join(outRoot, sceneId);
      mkdirSync(jobDir, { recursive: true });
      const dialogue = { ...SAMPLE_DIALOGUE, topic: `Scene preview: ${sceneId}`, sceneId };
      const timeline: Timeline = writeTimeline(dialogue, jobDir, writeTestAudio(dialogue, jobDir));
      const server = await startServer(webDir, jobDir);
      try {
        const { page, info } = await openScenePage(browser, server.url, renderer);
        for (const lang of ['es', 'ko'] as const) {
          // Line 3 is mid-gesture; sample at 60% of the line.
          const l = timeline.lines.find((x) => x.lang === lang && x.lineNo === 3)!;
          const t = l.start + (l.end - l.start) * 0.6;
          const url = await page.evaluate((tt) => window.__short!.frame(tt), t);
          const file = join(outRoot, `${sceneId}-${lang}.png`);
          writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
          log(`${file} (renderer ${info.renderer}, t=${t.toFixed(2)}s)`);
        }
        await page.close();
      } finally {
        await server.close();
      }
    }
  } finally {
    await browser.close();
  }
});

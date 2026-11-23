// npm run render -- out/sample   → re-render short.mp4 from an existing job's timeline + audio.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isVocabTimeline, type AnyTimeline } from '../../shared/types';
import { assertRenderableScene, renderAndVerify } from '../pipeline';
import { parseArgs } from '../util/env';
import { runCli, UserFacingError } from '../util/errors';

runCli(async () => {
  const args = parseArgs();
  const jobDir = resolve(args._[0] ?? 'out/sample');
  const tl = join(jobDir, 'timeline.json');
  if (!existsSync(tl)) throw new UserFacingError(`${tl} not found.`, 'Run `npm run sample` or `npm run generate -- --topic ...` first.');
  const timeline = JSON.parse(readFileSync(tl, 'utf8')) as AnyTimeline;
  if (!isVocabTimeline(timeline)) assertRenderableScene(timeline.sceneId);
  const renderer = args.renderer === 'canvas' || args.renderer === 'webgl' ? args.renderer : undefined;
  await renderAndVerify(jobDir, { duration: timeline.duration, renderer, concurrency: args.concurrency ? Number(args.concurrency) : undefined });
});

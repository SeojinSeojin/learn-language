// npm run verify:video -- out/sample/short.mp4   → ffprobe delivery checks.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Timeline } from '../../shared/types';
import { checkFfmpeg, verifyVideo } from '../render/ffmpeg';
import { parseArgs } from '../util/env';
import { runCli, UserFacingError } from '../util/errors';

runCli(async () => {
  const args = parseArgs();
  const file = resolve(args._[0] ?? 'out/sample/short.mp4');
  if (!existsSync(file)) throw new UserFacingError(`${file} not found`);
  checkFfmpeg();
  const tlPath = join(dirname(file), 'timeline.json');
  const duration = existsSync(tlPath) ? (JSON.parse(readFileSync(tlPath, 'utf8')) as Timeline).duration : undefined;
  const { probe, checks } = verifyVideo(file, { duration });
  console.log(`ffprobe: ${file}`);
  for (const c of checks) console.log(`  ${c}`);
  console.log(JSON.stringify(probe, null, 2));
});

// npm run preview -- [out/sample]   → browser preview of the same PixiJS scene, synced to audio.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildWeb } from '../render/build-web';
import { startServer } from '../render/server';
import { parseArgs } from '../util/env';
import { runCli, UserFacingError } from '../util/errors';

runCli(async () => {
  const args = parseArgs();
  const jobDir = resolve(args._[0] ?? 'out/sample');
  if (!existsSync(join(jobDir, 'timeline.json'))) {
    throw new UserFacingError(`${jobDir}/timeline.json not found.`, 'Run `npm run sample` first (or pass a job directory from `npm run generate`).');
  }
  const webDir = await buildWeb();
  const port = args.port ? Number(args.port) : 5173;
  let server;
  try {
    server = await startServer(webDir, jobDir, port);
  } catch {
    server = await startServer(webDir, jobDir, 0);
  }
  console.log(`Preview: ${server.url}/index.html?mode=preview   (job: ${jobDir})`);
  console.log(`Render mode (what the video uses): ${server.url}/index.html?mode=render`);
  console.log('Press Ctrl+C to stop.');
});

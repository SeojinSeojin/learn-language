// npx tsx src/cli/check-prepared.ts --file out/prepared/<id>.json --episode <id> --mode dialogue|vocab --topic "..."
// Early check in the Short workflow: the prepared script exists and passes the dialogue / vocab validators
// for exactly this episode, before ffmpeg, Chromium or Edge TTS are set up. No network.
import { readPreparedScript } from '../prepared/script';
import { parseArgs } from '../util/env';
import { runCli, UserFacingError } from '../util/errors';

runCli(async () => {
  const args = parseArgs();
  const get = (k: string) => (typeof args[k] === 'string' ? (args[k] as string).trim() : '');
  const mode = get('mode');
  if (mode !== 'dialogue' && mode !== 'vocab') throw new UserFacingError(`--mode must be dialogue or vocab (got "${mode}").`);
  const { meta, script } = readPreparedScript(get('file'), { id: get('episode'), mode, topic: get('topic') });
  const size = meta.mode === 'dialogue' ? `${(script as { lines: unknown[] }).lines.length} lines` : `${(script as { words: unknown[] }).words.length} words`;
  console.log(`✓ Prepared ${meta.mode} script for ${meta.episodeId} is valid (${size}; ${meta.provider} ${meta.model}, ${meta.generatedAt}).`);
});

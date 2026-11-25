// Child-side loading of a prepared script (Short workflow, `prepared_script` input).
import type { SceneId } from '../../shared/scenes';
import { blockGeminiRequests } from '../gemini/client';
import type { parseArgs, TtsProvider } from '../util/env';
import { UserFacingError } from '../util/errors';
import { assertEpisodeId, readPreparedScript, type PreparedScript, type ScriptMode } from './script';

/**
 * Reads `--prepared <file> --episode <id>` and validates the script for this mode and topic before anything
 * else runs. With Edge TTS the run needs no Gemini at all, so every Gemini request is blocked from here on.
 * Returns undefined when no prepared file was given (normal Gemini path).
 */
export function loadPreparedForRun(
  args: ReturnType<typeof parseArgs>,
  run: { mode: ScriptMode; topic: string; scene?: SceneId | 'auto'; tts?: TtsProvider },
): PreparedScript | undefined {
  if (args.prepared === undefined || args.prepared === false) return undefined;
  const file = typeof args.prepared === 'string' ? args.prepared.trim() : '';
  const episode = typeof args.episode === 'string' ? args.episode.trim() : '';
  if (!file || !episode) throw new UserFacingError('--prepared needs a file path and --episode <id>.');
  const prepared = readPreparedScript(file, {
    id: assertEpisodeId(episode),
    mode: run.mode,
    topic: run.topic,
    scene: run.scene && run.scene !== 'auto' ? run.scene : undefined,
  });
  if (run.tts === 'edge') blockGeminiRequests('This Short uses a prepared script and Edge TTS, so it must not call Gemini.');
  return prepared;
}

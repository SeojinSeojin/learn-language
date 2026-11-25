// Prepared scripts: validated dialogue / word-list JSON generated once per Daily batch and handed to each
// child Short run through an Actions artifact (<dir>/<episodeId>.json). The child re-validates its file
// with the same validators before any TTS, so a missing, mismatched or invalid file stops the run early.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Dialogue, VocabList } from '../../shared/types';
import type { SceneId } from '../../shared/scenes';
import { normalizeTopic } from '../dialogue/gemini';
import { DialogueValidationError, validateDialogue } from '../dialogue/schema';
import { UserFacingError } from '../util/errors';
import { VocabValidationError, validateVocab } from '../vocab/schema';

export const PREPARED_VERSION = 1;
/** Stable curriculum IDs (d01-dialogue-1) and test IDs (smoke-vocab-1). Also a safe file name. */
export const EPISODE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type ScriptMode = 'dialogue' | 'vocab';
export interface EpisodeRef {
  id: string;
  mode: ScriptMode;
  topic: string;
}

const WrapperZ = z.object({
  version: z.literal(PREPARED_VERSION),
  episodeId: z.string().regex(EPISODE_ID_RE),
  mode: z.enum(['dialogue', 'vocab']),
  topic: z.string(),
  provider: z.enum(['gemini', 'ollama']),
  model: z.string(),
  generatedAt: z.string(),
  script: z.unknown(),
});
export type PreparedMeta = Omit<z.infer<typeof WrapperZ>, 'script'>;

export type PreparedScript =
  | { meta: PreparedMeta & { mode: 'dialogue' }; script: Dialogue }
  | { meta: PreparedMeta & { mode: 'vocab' }; script: VocabList };

export class PreparedScriptError extends UserFacingError {
  constructor(message: string, hint = 'Run the Daily workflow with action "retry" to prepare the script again.') {
    super(message, hint);
    this.name = 'PreparedScriptError';
  }
}

export function assertEpisodeId(id: string): string {
  if (!EPISODE_ID_RE.test(id)) throw new PreparedScriptError(`Invalid episode ID "${id}".`, 'Use lowercase letters, digits and hyphens.');
  return id;
}

export function preparedFile(dir: string, episodeId: string) {
  return join(dir, `${assertEpisodeId(episodeId)}.json`);
}

/** Validates `script` for the episode with the existing dialogue / vocab validators. */
function validateScript(mode: ScriptMode, script: unknown, topic: string, scene?: SceneId): Dialogue | VocabList {
  return mode === 'dialogue' ? validateDialogue(script, topic, scene ? { requiredScene: scene } : {}) : validateVocab(script, topic);
}

export function writePreparedScript(
  dir: string,
  episode: EpisodeRef,
  source: { provider: 'gemini' | 'ollama'; model: string },
  script: Dialogue | VocabList,
): string {
  const topic = normalizeTopic(episode.topic);
  const valid = validateScript(episode.mode, script, topic);
  mkdirSync(dir, { recursive: true });
  const file = preparedFile(dir, episode.id);
  const wrapper = {
    version: PREPARED_VERSION,
    episodeId: episode.id,
    mode: episode.mode,
    topic,
    provider: source.provider,
    model: source.model,
    generatedAt: new Date().toISOString(),
    script: valid,
  };
  writeFileSync(file, JSON.stringify(wrapper, null, 2) + '\n');
  return file;
}

/**
 * Reads and validates a prepared script for exactly this episode (ID, mode and topic must match).
 * Throws PreparedScriptError with a clear message for a missing, unreadable, mismatched or invalid file.
 */
export function readPreparedScript(file: string, expect: EpisodeRef & { scene?: SceneId }): PreparedScript {
  const label = `Prepared script for episode ${expect.id}`;
  if (!existsSync(file)) throw new PreparedScriptError(`${label} is missing (${file}).`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new PreparedScriptError(`${label} is not valid JSON (${file}): ${(err as Error).message}`);
  }
  const parsed = WrapperZ.safeParse(raw);
  if (!parsed.success) {
    throw new PreparedScriptError(`${label} has an invalid format (${file}): ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
  }
  const { script, ...meta } = parsed.data;
  const topic = normalizeTopic(expect.topic);
  const mismatch = [
    meta.episodeId !== expect.id && `episode ${meta.episodeId}`,
    meta.mode !== expect.mode && `mode ${meta.mode} (expected ${expect.mode})`,
    normalizeTopic(meta.topic) !== topic && 'a different topic',
  ].filter(Boolean);
  if (mismatch.length) throw new PreparedScriptError(`${label} belongs to ${mismatch.join(', ')} (${file}).`);
  try {
    const valid = validateScript(meta.mode, script, topic, expect.scene);
    return { meta, script: valid } as PreparedScript;
  } catch (err) {
    if (err instanceof DialogueValidationError || err instanceof VocabValidationError) {
      throw new PreparedScriptError(`${label} failed validation (${file}):\n${err.issues.map((i) => `  - ${i}`).join('\n')}`);
    }
    throw err;
  }
}

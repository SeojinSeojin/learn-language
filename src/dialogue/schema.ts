// Dialogue JSON schema (sent to Gemini as response_format) and strict local validation.
import { z } from 'zod';
import { GESTURES, SPEAKERS, type Dialogue, type DialogueLine } from '../../shared/types';
import { SCENES, SCENE_IDS, type SceneId } from '../../shared/scenes';
import { UserFacingError } from '../util/errors';

export const DIALOGUE_LINE_COUNT = 6;

export const DIALOGUE_LIMITS = {
  esMX: { min: 1, max: 80 },
  ko: { min: 1, max: 40 },
  koPronunciation: { min: 1, max: 90 },
} as const;

/**
 * JSON-schema subset for Gemini structured output. Kept deliberately simple (over-complex schemas
 * are rejected with 400). maxLength is not enforced by Gemini, so lengths are checked locally.
 * Pass `sceneIds` to narrow the scene enum (e.g. to a single user-chosen scene).
 */
export function dialogueJsonSchema(sceneIds: readonly string[] = SCENE_IDS) {
  return {
    type: 'object',
    properties: {
      sceneId: { type: 'string', enum: [...sceneIds], description: 'Scene where the dialogue takes place.' },
      lines: {
        type: 'array',
        minItems: DIALOGUE_LINE_COUNT,
        maxItems: DIALOGUE_LINE_COUNT,
        items: {
          type: 'object',
          properties: {
            speaker: { type: 'string', enum: [...SPEAKERS] },
            esMX: { type: 'string', description: `Mexican Spanish line, at most ${DIALOGUE_LIMITS.esMX.max} characters.` },
            ko: { type: 'string', description: `Korean line in Hangul only, at most ${DIALOGUE_LIMITS.ko.max} characters.` },
            koPronunciation: { type: 'string', description: 'English-friendly romanization of the Korean line, syllables joined by hyphens.' },
            gesture: { type: 'string', enum: [...GESTURES] },
          },
          required: ['speaker', 'esMX', 'ko', 'koPronunciation', 'gesture'],
        },
      },
      hashtags: {
        type: 'array',
        maxItems: HASHTAG_MAX,
        items: { type: 'string' },
        description: 'Up to 5 topic-specific YouTube hashtags without "#" (letters, digits, underscore; no spaces or hyphens).',
      },
    },
    required: ['sceneId', 'lines', 'hashtags'],
  };
}

export const HASHTAG_MAX = 5;
const HASHTAG_RE = /^[\p{L}\p{N}_]{2,30}$/u;

/**
 * Normalizes suggested hashtags: strips "#", drops spaces, hyphens and punctuation (YouTube ends a hashtag at
 * those), keeps letters/digits/underscore, dedupes case-insensitively, max HASHTAG_MAX. Invalid ones are
 * dropped instead of failing the episode, since hashtags are cosmetic.
 */
export function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const tag = v.normalize('NFC').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!HASHTAG_RE.test(tag) || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= HASHTAG_MAX) break;
  }
  return out;
}

export const DIALOGUE_JSON_SCHEMA = dialogueJsonSchema();

export class DialogueValidationError extends UserFacingError {
  constructor(readonly issues: string[], prefix = 'Generated dialogue failed validation') {
    super(`${prefix}:\n${issues.map((i) => `  - ${i}`).join('\n')}`, 'Try re-running, or rephrase the topic more concretely.');
    this.name = 'DialogueValidationError';
  }
}

const LineZ = z.object({
  speaker: z.enum(SPEAKERS),
  esMX: z.string().trim(),
  ko: z.string().trim(),
  koPronunciation: z.string().trim(),
  gesture: z.enum(GESTURES),
});
const DialogueZ = z.object({
  sceneId: z.enum(SCENE_IDS),
  lines: z.array(LineZ),
  hashtags: z.unknown().optional(),
});

const HANGUL = /\p{Script=Hangul}/u;
const LATIN = /\p{Script=Latin}/u;
const LATIN_G = /\p{Script=Latin}/gu;
const LETTER_G = /\p{L}/gu;
const len = (s: string) => Array.from(s).length;

export interface ValidateOptions {
  requiredScene?: SceneId;
}

/** Validates and normalizes (trims) a raw dialogue object. Throws DialogueValidationError. */
export function validateDialogue(raw: unknown, topic: string, opts: ValidateOptions = {}): Dialogue {
  const parsed = DialogueZ.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
    throw new DialogueValidationError(issues);
  }
  const { sceneId, lines, hashtags } = parsed.data;
  const issues: string[] = [];

  if (opts.requiredScene && sceneId !== opts.requiredScene) {
    issues.push(`sceneId must be "${opts.requiredScene}" but was "${sceneId}"`);
  }
  if (lines.length !== DIALOGUE_LINE_COUNT) {
    issues.push(`expected exactly ${DIALOGUE_LINE_COUNT} lines, got ${lines.length}`);
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].speaker === lines[i - 1].speaker) {
      issues.push(`lines ${i} and ${i + 1} are both spoken by ${lines[i].speaker}; speakers must alternate`);
    }
  }
  if (lines.length && !SPEAKERS.every((s) => lines.some((l) => l.speaker === s))) {
    issues.push(`both characters (${SPEAKERS.join(', ')}) must speak`);
  }

  lines.forEach((l, idx) => {
    const n = `line ${idx + 1}`;
    for (const key of ['esMX', 'ko', 'koPronunciation'] as const) {
      const { min, max } = DIALOGUE_LIMITS[key];
      const L = len(l[key]);
      if (L < min) issues.push(`${n} ${key} is empty`);
      else if (L > max) issues.push(`${n} ${key} is ${L} characters (max ${max}): "${l[key]}"`);
    }
    if (l.ko && !HANGUL.test(l.ko)) issues.push(`${n} ko must be written in Hangul: "${l.ko}"`);
    if (LATIN.test(l.ko)) issues.push(`${n} ko must not contain Latin letters (put romanization in koPronunciation): "${l.ko}"`);
    if (HANGUL.test(l.esMX)) issues.push(`${n} esMX must not contain Hangul: "${l.esMX}"`);
    if (HANGUL.test(l.koPronunciation)) issues.push(`${n} koPronunciation must not contain Hangul: "${l.koPronunciation}"`);
    else if (l.koPronunciation) {
      const letters = l.koPronunciation.match(LETTER_G)?.length ?? 0;
      const latin = l.koPronunciation.match(LATIN_G)?.length ?? 0;
      if (letters === 0 || latin / letters < 0.9) issues.push(`${n} koPronunciation must be Latin-letter romanization: "${l.koPronunciation}"`);
    }
  });

  if (issues.length) throw new DialogueValidationError(issues);
  return { topic, sceneId, lines: lines as DialogueLine[], hashtags: normalizeHashtags(hashtags) };
}

/** "id: description" list used in prompts. */
export function sceneCatalog(): string {
  return SCENES.map((s) => `- ${s.id}: ${s.description}`).join('\n');
}

// Vocabulary list JSON schema (sent to Gemini as response_format) and strict local validation.
import { z } from 'zod';
import type { VocabList, VocabWord } from '../../shared/types';
import { HASHTAG_MAX, normalizeHashtags } from '../dialogue/schema';
import { UserFacingError } from '../util/errors';

/** Gemini is asked for VOCAB_REQUEST_COUNT words; the list is accepted with VOCAB_MIN..VOCAB_MAX. */
export const VOCAB_REQUEST_COUNT = 12;
export const VOCAB_MIN = 8;
export const VOCAB_MAX = 15;

export const VOCAB_LIMITS = {
  esMX: { min: 1, max: 30 },
  ko: { min: 1, max: 14 },
  koPronunciation: { min: 1, max: 40 },
  en: { min: 1, max: 30 },
  wikiTitle: { min: 1, max: 80 },
  imageQuery: { min: 1, max: 50 },
} as const;

function vocabWordsArraySchema(minItems: number, maxItems: number) {
  return {
    type: 'array',
    minItems,
    maxItems,
    items: {
      type: 'object',
      properties: {
        esMX: { type: 'string', description: 'Mexican Spanish word; nouns with their definite article (el/la/los/las).' },
        ko: { type: 'string', description: 'The Korean word, Hangul only.' },
        koPronunciation: { type: 'string', description: 'English-friendly pronunciation guide of the Korean word, syllables joined by hyphens.' },
        en: { type: 'string', description: 'The English word (no article).' },
        wikiTitle: { type: 'string', description: 'Exact title of the English Wikipedia article whose main photo shows this thing.' },
        imageQuery: { type: 'string', description: '1 to 3 English words to search a photo of this thing.' },
      },
      required: ['esMX', 'ko', 'koPronunciation', 'en', 'wikiTitle', 'imageQuery'],
    },
  };
}

/** Full word-list schema. `count` narrows the list to exactly that many words (the Qwen first call uses VOCAB_MIN). */
export function vocabJsonSchema(count?: number) {
  return {
    type: 'object',
    properties: {
      words: vocabWordsArraySchema(count ?? VOCAB_MIN, count ?? VOCAB_MAX),
      hashtags: {
        type: 'array',
        maxItems: HASHTAG_MAX,
        items: { type: 'string' },
        description: 'Up to 5 topic-specific YouTube hashtags without "#" (letters, digits, underscore; no spaces or hyphens).',
      },
    },
    required: ['words', 'hashtags'],
  };
}

/** Schema for a follow-up that asks only for `count` missing words (no hashtags), so a short answer is valid. */
export function vocabMissingWordsJsonSchema(count: number) {
  return { type: 'object', properties: { words: vocabWordsArraySchema(count, count) }, required: ['words'] };
}

export class VocabValidationError extends UserFacingError {
  constructor(readonly issues: string[], prefix = 'Generated word list failed validation') {
    super(`${prefix}:\n${issues.map((i) => `  - ${i}`).join('\n')}`, 'Try re-running, or rephrase the topic more concretely (e.g. "Fruits", "In the kitchen").');
    this.name = 'VocabValidationError';
  }
}

const WordZ = z.object({
  esMX: z.string().trim(),
  ko: z.string().trim(),
  koPronunciation: z.string().trim(),
  en: z.string().trim(),
  wikiTitle: z.string().trim(),
  imageQuery: z.string().trim(),
});
const ListZ = z.object({ words: z.array(WordZ), hashtags: z.unknown().optional() });

const HANGUL = /\p{Script=Hangul}/u;
const LATIN = /\p{Script=Latin}/u;
const len = (s: string) => Array.from(s).length;
/** Normalized form used to detect a repeated Spanish or Korean word. */
export const vocabKey = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

/** Field-level issues for one (trimmed) word: lengths and script rules. Shared by the list validator. */
export function vocabWordIssues(w: VocabWord, n: string): string[] {
  const issues: string[] = [];
  for (const k of Object.keys(VOCAB_LIMITS) as (keyof typeof VOCAB_LIMITS)[]) {
    const { min, max } = VOCAB_LIMITS[k];
    const L = len(w[k]);
    if (L < min) issues.push(`${n} ${k} is empty`);
    else if (L > max) issues.push(`${n} ${k} is ${L} characters (max ${max}): "${w[k]}"`);
  }
  if (w.ko && !HANGUL.test(w.ko)) issues.push(`${n} ko must be written in Hangul: "${w.ko}"`);
  if (LATIN.test(w.ko)) issues.push(`${n} ko must not contain Latin letters: "${w.ko}"`);
  for (const k of ['esMX', 'en', 'koPronunciation', 'wikiTitle', 'imageQuery'] as const) {
    if (HANGUL.test(w[k])) issues.push(`${n} ${k} must not contain Hangul: "${w[k]}"`);
  }
  return issues;
}

/** One raw entry → a trimmed word if it has every field and passes the field checks, else undefined. */
export function parseVocabWord(raw: unknown): VocabWord | undefined {
  const parsed = WordZ.safeParse(raw);
  if (!parsed.success) return undefined;
  return vocabWordIssues(parsed.data, 'word').length ? undefined : parsed.data;
}

/** Validates and normalizes (trims) a raw word list. Throws VocabValidationError. */
export function validateVocab(raw: unknown, topic: string): VocabList {
  const parsed = ListZ.safeParse(raw);
  if (!parsed.success) {
    throw new VocabValidationError(parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`));
  }
  const { words, hashtags } = parsed.data;
  const issues: string[] = [];
  if (words.length < VOCAB_MIN || words.length > VOCAB_MAX) {
    issues.push(`expected ${VOCAB_MIN} to ${VOCAB_MAX} words, got ${words.length}`);
  }
  const seen = { esMX: new Set<string>(), ko: new Set<string>() };
  words.forEach((w, idx) => {
    const n = `word ${idx + 1}`;
    issues.push(...vocabWordIssues(w, n));
    for (const k of ['esMX', 'ko'] as const) {
      if (!w[k]) continue;
      if (seen[k].has(vocabKey(w[k]))) issues.push(`${n} repeats the word "${w[k]}"; every word must be different`);
      seen[k].add(vocabKey(w[k]));
    }
  });
  if (issues.length) throw new VocabValidationError(issues);
  return { topic, words: words as VocabWord[], hashtags: normalizeHashtags(hashtags) };
}

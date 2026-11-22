// Builds and sanitizes YouTube metadata for a generated Short. No network, no credentials.
import { CHARACTERS, type Dialogue } from '../../shared/types';
import { getScene } from '../../shared/scenes';
import { UserFacingError } from '../util/errors';

export type PrivacyStatus = 'private' | 'unlisted' | 'public';
export const PRIVACY_STATUSES: readonly PrivacyStatus[] = ['private', 'unlisted', 'public'];
export const DEFAULT_PRIVACY: PrivacyStatus = 'private';

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: PrivacyStatus;
  defaultLanguage?: string;
}

export const TITLE_MAX_CHARS = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
export const EDUCATION_CATEGORY_ID = '27';
const TITLE_SUFFIX = ' | Mexican Spanish & Korean #Shorts';
const HASHTAGS = '#Shorts #LearnSpanish #LearnKorean #MexicanSpanish #Korean';
const TAGS = ['Mexican Spanish', 'Korean', 'learn Spanish', 'learn Korean', 'Spanish conversation', 'Korean conversation', 'language learning', 'Shorts'];

/** Strict: only the exact lowercase strings are accepted. */
export function parsePrivacy(v: unknown): PrivacyStatus {
  if (typeof v === 'string' && (PRIVACY_STATUSES as readonly string[]).includes(v)) return v as PrivacyStatus;
  throw new UserFacingError(
    `Invalid YouTube privacy status ${JSON.stringify(v)}.`,
    `Use exactly one of: ${PRIVACY_STATUSES.join(', ')} (lowercase, no spaces).`,
  );
}

/** YouTube rejects '<' and '>' in titles/descriptions. Also strips control chars (keeps \n and \t). */
function sanitizeText(s: string): string {
  return s
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function truncateChars(s: string, max: number): string {
  const cps = Array.from(s);
  if (cps.length <= max) return s;
  return cps.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

function truncateBytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  const ellipsis = '…';
  const budget = maxBytes - Buffer.byteLength(ellipsis, 'utf8');
  let used = 0;
  let out = '';
  for (const cp of s) {
    const b = Buffer.byteLength(cp, 'utf8');
    if (used + b > budget) break;
    used += b;
    out += cp;
  }
  return out.trimEnd() + ellipsis;
}

export function sanitizeTitle(title: string): string {
  const t = sanitizeText(title).replace(/\s+/g, ' ').trim();
  if (!t) throw new UserFacingError('YouTube title is empty after sanitizing.');
  return truncateChars(t, TITLE_MAX_CHARS);
}

export function sanitizeDescription(description: string): string {
  return truncateBytes(sanitizeText(description).trim(), DESCRIPTION_MAX_BYTES);
}

function generateTitle(topic: string): string {
  const clean = sanitizeText(topic).replace(/\s+/g, ' ').trim() || 'Everyday conversation';
  const room = TITLE_MAX_CHARS - TITLE_SUFFIX.length;
  let t = clean;
  if (Array.from(t).length > room) {
    // Prefer cutting at a word boundary.
    const cut = Array.from(t).slice(0, room - 1).join('');
    const sp = cut.lastIndexOf(' ');
    t = (sp > room / 2 ? cut.slice(0, sp) : cut).replace(/[\s,.;:|-]+$/, '') + '…';
  }
  return t + TITLE_SUFFIX;
}

function generateDescription(dialogue: Dialogue): string {
  const topic = dialogue.topic.trim();
  const parts: string[] = [];
  parts.push(`Learn a short everyday conversation in Mexican Spanish 🇲🇽 and Korean 🇰🇷: ${topic}.`);
  parts.push('Watch it in Spanish first, then the same dialogue in Korean.');
  let sceneName: string | undefined;
  try {
    sceneName = dialogue.sceneId ? getScene(dialogue.sceneId).name : undefined;
  } catch {
    sceneName = undefined;
  }
  if (sceneName) parts.push(`Scene: ${sceneName}`);
  parts.push('');
  parts.push('— Dialogue —');
  dialogue.lines.forEach((l, i) => {
    parts.push('');
    const c = CHARACTERS[l.speaker] ?? { es: String(l.speaker), ko: String(l.speaker) };
    parts.push(`${i + 1}.`);
    parts.push(`🇲🇽 ${c.es}: ${l.esMX}`);
    parts.push(`🇰🇷 ${c.ko}: ${l.ko}`);
    parts.push(`≈ ${l.koPronunciation}`);
  });
  parts.push('');
  parts.push(
    'Note: the "≈" pronunciation hints are approximate, English-friendly guides to the Korean — not exact. Listen to the audio for real pronunciation.',
  );
  parts.push('Voices are AI-generated (Gemini TTS) and the script is AI-generated, so small mistakes are possible.');
  parts.push('');
  parts.push(HASHTAGS);
  return parts.join('\n');
}

export function buildYouTubeMetadata(
  dialogue: Dialogue,
  o: { title?: string; description?: string; privacyStatus: PrivacyStatus },
): YouTubeMetadata {
  const privacyStatus = parsePrivacy(o.privacyStatus);
  const title = o.title?.trim() ? sanitizeTitle(o.title) : sanitizeTitle(generateTitle(dialogue.topic));
  const description = o.description?.trim() ? sanitizeDescription(o.description) : sanitizeDescription(generateDescription(dialogue));
  return { title, description, tags: [...TAGS], categoryId: EDUCATION_CATEGORY_ID, privacyStatus };
}

/** Re-apply sanitization/limits to metadata loaded from disk (e.g. after manual edits or overrides). */
export function normalizeMetadata(m: unknown): YouTubeMetadata {
  if (!m || typeof m !== 'object') throw new UserFacingError('metadata.json is not an object.');
  const r = m as Record<string, unknown>;
  if (typeof r.title !== 'string' || typeof r.description !== 'string') {
    throw new UserFacingError('metadata.json must contain string "title" and "description".');
  }
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string').map((t) => sanitizeText(t).trim()).filter(Boolean) : [];
  const keptTags: string[] = [];
  let total = 0;
  for (const t of tags) {
    if (total + t.length + 1 > 400) break;
    keptTags.push(t);
    total += t.length + 1;
  }
  const out: YouTubeMetadata = {
    title: sanitizeTitle(r.title),
    description: sanitizeDescription(r.description),
    tags: keptTags,
    categoryId: typeof r.categoryId === 'string' && r.categoryId ? r.categoryId : EDUCATION_CATEGORY_ID,
    privacyStatus: parsePrivacy(r.privacyStatus),
  };
  if (typeof r.defaultLanguage === 'string' && r.defaultLanguage) out.defaultLanguage = r.defaultLanguage;
  return out;
}

export function formatMetadataForReview(m: YouTubeMetadata): string {
  const fence = m.description.includes('```') ? '~~~~' : '```';
  return [
    '### YouTube metadata (review before upload)',
    '',
    `**Title:** ${m.title.replace(/([\\`*_[\]|])/g, '\\$1')}`,
    '',
    `**Visibility:** \`${m.privacyStatus}\``,
    '',
    `**Category:** ${m.categoryId} · **Tags:** ${m.tags.join(', ')}`,
    '',
    '**Description:**',
    '',
    `${fence}text`,
    m.description,
    fence,
    '',
  ].join('\n');
}

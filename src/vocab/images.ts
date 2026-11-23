// Pictures for vocabulary words from Wikimedia (free, no API key):
//   1. the lead image of the English Wikipedia article named by `wikiTitle` (free-licensed images only;
//      one batched request for all words),
//   2. otherwise a Wikimedia Commons file search for `imageQuery` (then `en`).
// Only CC0, CC BY, CC BY-SA and public-domain pictures are used. Each picture is normalized with FFmpeg to a
// 720×720 JPEG (cover crop; very wide or tall pictures are fitted over a blurred copy of themselves). The
// author and license are kept for the on-screen credit and the YouTube description, as CC BY / BY-SA require.
// A missing picture never fails the video: the word is drawn on a text card instead.
// Wikimedia rate-limits anonymous API clients, so requests are paced and HTTP 429 Retry-After is honored.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { VocabWord } from '../../shared/types';
import { runFfmpeg } from '../render/ffmpeg';
import { optionalEnv } from '../util/env';

export const IMAGE_SIZE = 720;
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_AFTER_S = 65;

export interface WordImage {
  /** Absolute path of the normalized 720×720 JPEG. */
  file: string;
  /** Short credit drawn under the picture. */
  credit: string;
  /** Full attribution line for the YouTube description. */
  attribution: string;
}

/** Wikimedia asks API clients for a descriptive User-Agent. Override with WIKIMEDIA_USER_AGENT. */
const userAgent = () => optionalEnv('WIKIMEDIA_USER_AGENT') ?? 'learn-language-shorts/1.0 (educational YouTube Shorts generator; Node.js)';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface LookupOptions {
  fetch?: Fetcher;
  /** Minimum time between request starts (default 700 ms). */
  spacingMs?: number;
  /** Base wait before retrying a failed request when the server gives no Retry-After (default 2000 ms). */
  retryBaseMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Paced HTTP GET with retries: honors Retry-After on 429/503, backs off on other 5xx and network errors. */
class Client {
  private nextSlot = 0;
  readonly f: Fetcher;
  private spacing: number;
  private retryBase: number;

  constructor(o: LookupOptions = {}) {
    this.f = o.fetch ?? fetch;
    this.spacing = o.spacingMs ?? 700;
    this.retryBase = o.retryBaseMs ?? 2000;
  }

  async get(url: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const now = Date.now();
      const wait = Math.max(0, this.nextSlot - now);
      this.nextSlot = Math.max(now, this.nextSlot) + this.spacing;
      if (wait) await sleep(wait);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await this.f(url, { headers: { 'User-Agent': userAgent(), 'Api-User-Agent': userAgent() }, signal: controller.signal });
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS) throw err;
        await sleep(this.retryBase * attempt);
        continue;
      } finally {
        clearTimeout(timer);
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) return res;
      const after = Number(res.headers.get('retry-after'));
      const waitS = Number.isFinite(after) && after > 0 ? after : (this.retryBase * attempt) / 1000;
      if (waitS > MAX_RETRY_AFTER_S) return res;
      if (res.status === 429) console.log(`  … Wikimedia rate limit: waiting ${Math.ceil(waitS)} s as asked`);
      await res.body?.cancel().catch(() => undefined);
      await sleep(waitS * 1000);
      // Later requests wait too, instead of hitting the limit again.
      this.nextSlot = Math.max(this.nextSlot, Date.now());
    }
  }

  async query(api: string, params: Record<string, string>): Promise<any> {
    const url = new URL(api);
    for (const [k, v] of Object.entries({ action: 'query', format: 'json', formatversion: '2', ...params })) url.searchParams.set(k, v);
    const res = await this.get(url.href);
    if (!res.ok) throw new Error(`${url.host} answered HTTP ${res.status}`);
    return res.json();
  }
}

/** Maps each requested title to the final title after the API's normalization and redirects. */
function resolveTitles(q: any, titles: string[]): Map<string, string> {
  const step = new Map<string, string>();
  for (const n of q?.normalized ?? []) step.set(n.from, n.to);
  for (const r of q?.redirects ?? []) step.set(r.from, r.to);
  const out = new Map<string, string>();
  for (const t of titles) {
    let cur = t;
    for (let i = 0; i < 4 && step.has(cur); i++) cur = step.get(cur)!;
    out.set(t, cur);
  }
  return out;
}

/** Lead image file names (free licenses only) of English Wikipedia articles, keyed by requested title. */
export async function wikipediaLeadImages(titles: string[], c: Client): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(titles.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const j = await c.query(WIKIPEDIA_API, { titles: batch.join('|'), redirects: '1', prop: 'pageimages', piprop: 'name', pilicense: 'free', pilimit: '50' });
    const pages = new Map<string, any>((j?.query?.pages ?? []).map((p: any) => [p.title, p]));
    for (const [asked, final] of resolveTitles(j?.query, batch)) {
      const p = pages.get(final);
      if (p && !p.missing && typeof p.pageimage === 'string') out.set(asked, p.pageimage);
    }
  }
  return out;
}

/** Commons bitmap files matching the query, files whose name contains a query word first. */
export async function commonsSearch(query: string, c: Client | LookupOptions = {}): Promise<string[]> {
  const client = c instanceof Client ? c : new Client(c);
  const j = await client.query(COMMONS_API, { list: 'search', srnamespace: '6', srsearch: `${query} filetype:bitmap`, srlimit: '10' });
  const titles: string[] = (j?.query?.search ?? []).map((s: { title: string }) => s.title);
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const hit = (t: string) => words.some((w) => t.toLowerCase().includes(w.replace(/s$/, '')));
  return [...titles.filter(hit), ...titles.filter((t) => !hit(t))];
}

export interface ImageCandidate {
  title: string;
  url: string;
  width: number;
  height: number;
  license: string;
  artist: string;
  page: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ''), /^#x/i.test(e) ? 16 : 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Licenses a video can use with just a credit line: CC0, CC BY, CC BY-SA and public domain.
 * GFDL (needs the full license text shipped with the work), NC and ND licenses are refused.
 */
export function isUsableLicense(license: string): boolean {
  const l = license.trim();
  if (/GFDL|\bNC\b|\bND\b|non-?commercial|no-?deriv/i.test(l)) return false;
  return /^(CC0|CC[ -]BY(-SA)?([ -][\d.]+.*)?$|Public domain|PD\b|PDM)/i.test(l);
}

/** Usable picture URLs plus license/author for the given "File:..." titles, keyed by requested title. */
export async function imageCandidates(api: string, titles: string[], c: Client | LookupOptions = {}): Promise<Map<string, ImageCandidate>> {
  const client = c instanceof Client ? c : new Client(c);
  const out = new Map<string, ImageCandidate>();
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const j = await client.query(api, {
      titles: batch.join('|'),
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '960',
      iiextmetadatafilter: 'LicenseShortName|Artist|Credit',
    });
    const pages = new Map<string, any>((j?.query?.pages ?? []).map((p: any) => [p.title, p]));
    for (const [asked, final] of resolveTitles(j?.query, batch)) {
      const ii = pages.get(final)?.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|webp|gif|tiff)$/.test(ii.mime ?? '')) continue;
      if (Math.min(ii.width ?? 0, ii.height ?? 0) < 300) continue;
      const m = ii.extmetadata ?? {};
      const license = plainText(m.LicenseShortName?.value ?? '');
      if (!isUsableLicense(license)) continue; // never use a picture without a usable stated license
      const artist = plainText(m.Artist?.value ?? '') || plainText(m.Credit?.value ?? '') || 'Unknown author';
      out.set(asked, {
        title: asked,
        url: ii.thumburl ?? ii.url,
        width: ii.thumbwidth ?? ii.width,
        height: ii.thumbheight ?? ii.height,
        license,
        artist,
        page: ii.descriptionurl ?? '',
      });
    }
  }
  return out;
}

const fileTitle = (name: string) => (name.startsWith('File:') ? name : `File:${name}`);
const shorten = (s: string, max: number) => (Array.from(s).length > max ? Array.from(s).slice(0, max - 1).join('').trimEnd() + '…' : s);

/** Result per word: a picture, null (looked everywhere, nothing usable), or an Error (lookup failed). */
export type LookupResult = ImageCandidate | null | Error;

/**
 * Finds the best picture per word: Wikipedia lead images for all words in two batched requests, then a
 * Commons search for each word still missing one.
 */
export async function findWordImages(words: VocabWord[], o: LookupOptions = {}): Promise<LookupResult[]> {
  const c = new Client(o);
  const results: LookupResult[] = words.map(() => null);
  try {
    const leads = await wikipediaLeadImages(words.map((w) => w.wikiTitle), c);
    const files = [...new Set([...leads.values()].map(fileTitle))];
    const info = await imageCandidates(WIKIPEDIA_API, files, c);
    words.forEach((w, i) => {
      const lead = leads.get(w.wikiTitle);
      const cand = lead ? info.get(fileTitle(lead)) : undefined;
      if (cand) results[i] = cand;
    });
  } catch (err) {
    console.warn(`  ! Wikipedia lookup failed (${(err as Error).message}); searching Commons instead`);
  }
  for (const [i, w] of words.entries()) {
    if (results[i]) continue;
    try {
      for (const q of [...new Set([w.imageQuery, w.en])]) {
        const titles = (await commonsSearch(q, c)).slice(0, 6);
        const info = await imageCandidates(COMMONS_API, titles, c);
        const best = titles.map((t) => info.get(t)).find(Boolean);
        if (best) {
          results[i] = best;
          break;
        }
      }
    } catch (err) {
      results[i] = err as Error;
    }
  }
  return results;
}

/** Single-word convenience wrapper (returns undefined when nothing usable was found). */
export async function findWordImage(word: VocabWord, o: LookupOptions = {}): Promise<ImageCandidate | undefined> {
  const [r] = await findWordImages([word], o);
  if (r instanceof Error) throw r;
  return r ?? undefined;
}

/** FFmpeg filter that turns any picture into a SIZE×SIZE square. */
export function squareFilter(width: number, height: number, size = IMAGE_SIZE): string[] {
  const aspect = width / Math.max(1, height);
  const cover = `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size}`;
  if (aspect >= 0.75 && aspect <= 1.34) return ['-vf', `${cover},format=yuvj420p`];
  return [
    '-filter_complex',
    `[0:v]split[a][b];[a]${cover},boxblur=24:2[bg];[b]scale=${size}:${size}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuvj420p`,
  ];
}

const cacheDir = () => resolve(optionalEnv('IMAGE_CACHE_DIR') ?? '.cache/images');

/** Downloads and normalizes one candidate into the image cache; returns the cached JPEG path. */
async function downloadCandidate(cand: ImageCandidate, c: Client): Promise<string> {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const cached = join(dir, `${createHash('sha256').update(cand.url).digest('hex').slice(0, 32)}.jpg`);
  if (existsSync(cached)) return cached;
  const res = await c.get(cand.url);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const type = res.headers.get('content-type') ?? '';
  if (!/^image\//.test(type)) throw new Error(`not an image (${type || 'no content type'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error(`unexpected size (${buf.length} bytes)`);
  const tmp = mkdtempSync(join(tmpdir(), 'vocab-img-'));
  try {
    const src = join(tmp, 'source');
    writeFileSync(src, buf);
    const out = join(tmp, 'out.jpg');
    await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', src, ...squareFilter(cand.width, cand.height), '-frames:v', '1', '-q:v', '3', out]);
    renameSync(out, cached);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return cached;
}

/**
 * Looks up, downloads and normalizes a picture per word into jobDir/images/word-{n}.jpg.
 * Lookups are cached in .cache/images (IMAGE_CACHE_DIR), so re-runs make no new API requests. Only
 * definite answers are cached (a picture, or "nothing usable"); failed lookups are retried next run.
 */
export async function fetchVocabImages(words: VocabWord[], jobDir: string, o: LookupOptions = {}): Promise<(WordImage | undefined)[]> {
  mkdirSync(join(jobDir, 'images'), { recursive: true });
  const lookupDir = join(cacheDir(), 'lookups');
  mkdirSync(lookupDir, { recursive: true });
  const lookupFile = (w: VocabWord) => join(lookupDir, `${createHash('sha256').update(JSON.stringify([w.wikiTitle, w.imageQuery, w.en])).digest('hex').slice(0, 32)}.json`);

  const found: LookupResult[] = words.map((w) => (existsSync(lookupFile(w)) ? (JSON.parse(readFileSync(lookupFile(w), 'utf8')) as ImageCandidate | null) : new Error('not looked up')));
  const todo = words.flatMap((w, i) => (found[i] instanceof Error ? [i] : []));
  if (todo.length) {
    const fresh = await findWordImages(todo.map((i) => words[i]), o);
    todo.forEach((i, k) => {
      found[i] = fresh[k];
      if (!(fresh[k] instanceof Error)) writeFileSync(lookupFile(words[i]), JSON.stringify(fresh[k]));
    });
  }

  const c = new Client(o);
  const out: (WordImage | undefined)[] = [];
  for (const [i, w] of words.entries()) {
    const cand = found[i];
    if (cand instanceof Error) {
      console.warn(`  ! ${w.en}: picture lookup failed (${cand.message}); using a text card`);
      out.push(undefined);
      continue;
    }
    if (!cand) {
      console.warn(`  ! ${w.en}: no free picture found; using a text card`);
      out.push(undefined);
      continue;
    }
    const file = join(jobDir, 'images', `word-${i + 1}.jpg`);
    try {
      copyFileSync(await downloadCandidate(cand, c), file);
    } catch (err) {
      console.warn(`  ! ${w.en}: picture failed (${(err as Error).message}); using a text card`);
      out.push(undefined);
      continue;
    }
    const name = cand.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
    console.log(`  ✓ images/word-${i + 1}.jpg  ${w.en} ← ${cand.title} (${cand.license})`);
    out.push({
      file,
      credit: `${shorten(cand.artist, 38)} · ${cand.license} · Wikimedia Commons`,
      attribution: `${w.en}: "${shorten(name, 60)}" by ${shorten(cand.artist, 60)}, ${cand.license}${cand.page ? `, ${cand.page}` : ''}`,
    });
  }
  return out;
}

/** Sample mode: plain colored squares made locally (no network). */
export async function writeSampleImages(words: VocabWord[], jobDir: string): Promise<WordImage[]> {
  mkdirSync(join(jobDir, 'images'), { recursive: true });
  const colors = ['0xf2a65a', '0xf6d55c', '0x7fc8a9', '0x6ab0de', '0xc39bd3', '0xf08a8a'];
  const out: WordImage[] = [];
  for (const [i] of words.entries()) {
    const file = join(jobDir, 'images', `word-${i + 1}.jpg`);
    await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${colors[i % colors.length]}:s=${IMAGE_SIZE}x${IMAGE_SIZE}`, '-frames:v', '1', '-q:v', '3', file]);
    out.push({ file, credit: 'Sample picture (solid color)', attribution: '' });
  }
  return out;
}

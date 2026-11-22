// YouTube Data API v3 videos.insert via the resumable upload protocol.
import { readFile } from 'node:fs/promises';
import { QuotaExhaustedError, UserFacingError } from '../util/errors';
import { parsePrivacy, type PrivacyStatus, type YouTubeMetadata } from './metadata';

export const YOUTUBE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const MAX_PUT_ATTEMPTS = 3;

type FetchLike = typeof fetch;

export interface UploadResult {
  videoId: string;
  url: string;
  privacyStatus: PrivacyStatus;
}

export interface UploadOptions {
  accessToken: string;
  videoPath: string;
  metadata: YouTubeMetadata;
  privacyStatus: PrivacyStatus;
  fetchImpl?: FetchLike;
  /** Delay between PUT retries (ms). Tests pass 0. */
  retryDelayMs?: number;
}

/** The exact JSON body sent to videos.insert. */
export function buildInsertBody(metadata: YouTubeMetadata, privacyStatus: PrivacyStatus) {
  const snippet: Record<string, unknown> = {
    title: metadata.title,
    description: metadata.description,
    tags: metadata.tags,
    categoryId: metadata.categoryId,
  };
  if (metadata.defaultLanguage) snippet.defaultLanguage = metadata.defaultLanguage;
  return { snippet, status: { privacyStatus, selfDeclaredMadeForKids: false } };
}

interface GoogleError {
  status: number;
  message: string;
  reasons: string[];
}

async function readGoogleError(res: Response): Promise<GoogleError> {
  const text = await res.text().catch(() => '');
  let message = text.slice(0, 500) || res.statusText;
  let reasons: string[] = [];
  try {
    const j = JSON.parse(text);
    if (j?.error?.message) message = j.error.message;
    if (Array.isArray(j?.error?.errors)) reasons = j.error.errors.map((e: { reason?: string }) => e.reason).filter(Boolean);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, message, reasons };
}

function mapError(e: GoogleError, phase: string): Error {
  if (e.status === 403 && e.reasons.some((r) => r === 'quotaExceeded' || r === 'uploadLimitExceeded' || r === 'dailyLimitExceeded')) {
    return new QuotaExhaustedError(
      'YouTube Data API',
      `${e.message} (${e.reasons.join(', ')}).`,
      'The default quota is 10,000 units/day and each upload costs ~1,600 units (≈6 uploads/day); there is also a per-channel upload limit. Quota resets at midnight Pacific Time — try again then.',
    );
  }
  if (e.status === 401) {
    return new UserFacingError(
      `YouTube rejected the access token during ${phase} (HTTP 401): ${e.message}`,
      'The token may be invalid or lack the youtube.upload scope. Re-run `npm run youtube:authorize` and update YOUTUBE_REFRESH_TOKEN.',
    );
  }
  return new UserFacingError(`YouTube ${phase} failed (HTTP ${e.status}): ${e.message}${e.reasons.length ? ` [${e.reasons.join(', ')}]` : ''}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadVideo(o: UploadOptions): Promise<UploadResult> {
  const f = o.fetchImpl ?? fetch;
  // SAFETY: the explicit argument is the single source of truth and must match what was reviewed.
  const requested = parsePrivacy(o.privacyStatus);
  const reviewed = parsePrivacy(o.metadata.privacyStatus);
  if (requested !== reviewed) {
    throw new UserFacingError(`Refusing to upload: metadata was reviewed with visibility "${reviewed}" but upload requested "${requested}".`);
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(o.videoPath);
  } catch {
    throw new UserFacingError(`Cannot read video file ${o.videoPath}.`);
  }
  if (bytes.length === 0) throw new UserFacingError(`Video file ${o.videoPath} is empty.`);
  const size = bytes.length;
  const auth = `Bearer ${o.accessToken}`;

  // 1) Initiate the resumable session.
  let init: Response;
  try {
    init = await f(YOUTUBE_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify(buildInsertBody(o.metadata, requested)),
    });
  } catch (e) {
    throw new UserFacingError(`Network error starting YouTube upload: ${(e as Error).message}`);
  }
  if (!init.ok) throw mapError(await readGoogleError(init), 'upload initiation');
  const location = init.headers.get('location');
  if (!location) throw new UserFacingError('YouTube did not return a resumable upload URL (Location header).');

  // 2) Upload bytes, resuming on 5xx / network errors.
  let offset = 0;
  let final: Response | undefined;
  for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS && !final; attempt++) {
    let res: Response | undefined;
    let transient = '';
    try {
      const chunk = bytes.subarray(offset) as Uint8Array<ArrayBuffer>;
      const headers: Record<string, string> = { Authorization: auth, 'Content-Type': 'video/mp4', 'Content-Length': String(chunk.length) };
      if (offset > 0) headers['Content-Range'] = `bytes ${offset}-${size - 1}/${size}`;
      res = await f(location, { method: 'PUT', headers, body: chunk });
    } catch (e) {
      transient = `network error: ${(e as Error).message}`;
    }
    if (res) {
      if (res.status === 200 || res.status === 201) {
        final = res;
        break;
      }
      if (res.status < 500 && res.status !== 308) throw mapError(await readGoogleError(res), 'upload');
      transient = `HTTP ${res.status}`;
      await res.text().catch(() => '');
    }
    if (attempt === MAX_PUT_ATTEMPTS) throw new UserFacingError(`YouTube upload failed after ${MAX_PUT_ATTEMPTS} attempts (${transient}).`, 'This is usually transient — re-run the upload job.');
    await sleep(o.retryDelayMs ?? 1000 * 2 ** (attempt - 1));
    // Ask the server how much it has and resume from there.
    try {
      const st = await f(location, { method: 'PUT', headers: { Authorization: auth, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
      if (st.status === 200 || st.status === 201) {
        final = st;
        break;
      }
      if (st.status === 308) {
        const range = st.headers.get('range');
        const m = range?.match(/bytes=0-(\d+)/);
        offset = m ? Number(m[1]) + 1 : 0;
        await st.text().catch(() => '');
      } else if (st.status === 404 || st.status === 410) {
        throw new UserFacingError('YouTube upload session expired.', 'Re-run the upload job.');
      } else {
        offset = 0;
        await st.text().catch(() => '');
      }
    } catch (e) {
      if (e instanceof UserFacingError) throw e;
      offset = 0;
    }
  }
  if (!final) throw new UserFacingError('YouTube upload did not complete.');

  const json = (await final.json().catch(() => ({}))) as { id?: string; status?: { privacyStatus?: string; uploadStatus?: string } };
  if (!json.id) throw new UserFacingError('YouTube upload response did not include a video id.');
  const url = `https://youtube.com/shorts/${json.id}`;
  const actual = json.status?.privacyStatus;
  if (actual !== requested) {
    throw new UserFacingError(
      `YouTube set the video's visibility to "${actual ?? 'unknown'}" instead of the requested "${requested}". Video: ${url}`,
      'API projects that have not passed a YouTube API compliance audit (unverified projects created after July 28, 2020) have all uploads forced to private. ' +
        'Change visibility manually in YouTube Studio, or request an audit for the Google Cloud project.',
    );
  }
  return { videoId: json.id, url, privacyStatus: requested };
}

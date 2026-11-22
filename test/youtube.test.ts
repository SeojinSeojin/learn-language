import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLE_DIALOGUE } from '../src/dialogue/sample';
import { QuotaExhaustedError, UserFacingError } from '../src/util/errors';
import { normalizeHashtags } from '../src/dialogue/schema';
import { buildYouTubeMetadata, episodeHashtags, formatMetadataForReview, normalizeMetadata, parsePrivacy, type YouTubeMetadata } from '../src/youtube/metadata';
import { GOOGLE_TOKEN_ENDPOINT, authorizeInteractive, loadClientSecret, refreshAccessToken, saveTokenFile } from '../src/youtube/oauth';
import { YOUTUBE_UPLOAD_ENDPOINT, uploadVideo } from '../src/youtube/upload';

const tmp = mkdtempSync(join(tmpdir(), 'yt-test-'));
const videoPath = join(tmp, 'short.mp4');
writeFileSync(videoPath, Buffer.alloc(2048, 7));

function meta(privacyStatus: YouTubeMetadata['privacyStatus'] = 'private') {
  return buildYouTubeMetadata(SAMPLE_DIALOGUE, { privacyStatus });
}

const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// ---------- metadata ----------

test('generated title is ≤100 chars, sanitized, and Shorts-tagged', () => {
  const m = buildYouTubeMetadata({ ...SAMPLE_DIALOGUE, topic: '<b>' + 'Very long topic about ordering '.repeat(10) + '</b>' }, { privacyStatus: 'private' });
  assert.ok(Array.from(m.title).length <= 100, m.title);
  assert.ok(!/[<>]/.test(m.title));
  assert.match(m.title, /Mexican Spanish & Korean #Shorts$/);
  assert.equal(m.categoryId, '27');
  assert.ok(m.tags.join(',').length < 400);
  assert.equal(meta().title, 'Ordering iced coffee at a café | Mexican Spanish & Korean #Shorts');
});

test('description has character labels, Hangul, ≈ hints, approximate note, AI disclosure, hashtags', () => {
  const m = meta();
  assert.match(m.description, /[가-힣]/);
  assert.match(m.description, /≈ an-nyeong-ha-se-yo/);
  assert.match(m.description, /🇲🇽 Lupita: ¡Hola!/);
  assert.match(m.description, /🇰🇷 루피타: 안녕하세요/);
  assert.match(m.description, /지수:/);
  assert.match(m.description, /Scene: Café/);
  assert.match(m.description, /approximate/i);
  assert.match(m.description, /AI-generated \(Gemini TTS\) and the script is AI-generated \(Gemini\)/);
  assert.match(m.description, /#Shorts #LearnKorean #LearnSpanish #Korean #Spanish #Mexico #MexicanSpanish #KorMex #IcedCoffee #Cafe #OrderingCoffee$/);
  assert.ok(m.tags.includes('IcedCoffee'));
  assert.ok(Buffer.byteLength(m.description) <= 5000);
});

test('hashtags: normalized, deduped against the base set, capped at 15', () => {
  assert.deepEqual(normalizeHashtags(['#tacos', 'kor-mex', 'cena en casa', 'x', '#Tacos', 'a'.repeat(31), 42, '요리']), ['tacos', 'kormex', 'cenaencasa', '요리']);
  assert.deepEqual(normalizeHashtags(undefined), []);
  const tags = episodeHashtags({ ...SAMPLE_DIALOGUE, hashtags: ['korean', 'Tacos', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'] });
  assert.equal(tags.length, 15);
  assert.equal(tags.filter((t) => t.toLowerCase() === 'korean').length, 1);
  assert.equal(tags[8], 'Tacos');
});

test('overrides apply and are sanitized; long description truncated to 5000 bytes', () => {
  const m = buildYouTubeMetadata(SAMPLE_DIALOGUE, { title: 'My <title>', description: '한'.repeat(3000) + '<x>', privacyStatus: 'unlisted' });
  assert.equal(m.title, 'My ‹title›');
  assert.ok(Buffer.byteLength(m.description, 'utf8') <= 5000);
  assert.ok(m.description.endsWith('…'));
  assert.equal(m.privacyStatus, 'unlisted');
  const blank = buildYouTubeMetadata(SAMPLE_DIALOGUE, { title: '  ', description: '', privacyStatus: 'private' });
  assert.match(blank.title, /#Shorts/);
  const md = formatMetadataForReview(m);
  assert.match(md, /Visibility:\*\* `unlisted`/);
  assert.match(md, /```text/);
});

test('parsePrivacy is strict', () => {
  assert.equal(parsePrivacy('public'), 'public');
  for (const bad of ['Public ', 'PUBLIC', 'public ', '', undefined, null, true, 'draft']) {
    assert.throws(() => parsePrivacy(bad), UserFacingError, String(bad));
  }
  assert.throws(() => normalizeMetadata({ title: 't', description: 'd' }), UserFacingError);
});

// ---------- upload ----------

test('uploadVideo throws before any fetch when privacy mismatches', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response('');
  }) as typeof fetch;
  await assert.rejects(
    uploadVideo({ accessToken: 'x', videoPath, metadata: meta('private'), privacyStatus: 'public', fetchImpl }),
    /reviewed with visibility "private" but upload requested "public"/,
  );
  assert.equal(calls, 0);
});

function uploadMock(opts: { returnedPrivacy?: string; putFailures?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  let failures = opts.putFailures ?? 0;
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === YOUTUBE_UPLOAD_ENDPOINT) return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session/1' } });
    const h = init.headers as Record<string, string>;
    if (h['Content-Range']?.startsWith('bytes */')) return new Response(null, { status: 308, headers: { Range: 'bytes=0-1023' } });
    if (failures-- > 0) return new Response('oops', { status: 503 });
    return jsonRes(200, { id: 'abc123', status: { privacyStatus: opts.returnedPrivacy ?? 'unlisted', uploadStatus: 'uploaded' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test('uploadVideo happy path: resumable init + PUT returns id and shorts URL', async () => {
  const { calls, fetchImpl } = uploadMock();
  const r = await uploadVideo({ accessToken: 'tok', videoPath, metadata: meta('unlisted'), privacyStatus: 'unlisted', fetchImpl });
  assert.deepEqual(r, { videoId: 'abc123', url: 'https://youtube.com/shorts/abc123', privacyStatus: 'unlisted' });
  assert.equal(calls.length, 2);
  const init = calls[0].init;
  const h = init.headers as Record<string, string>;
  assert.equal(init.method, 'POST');
  assert.equal(h.Authorization, 'Bearer tok');
  assert.equal(h['X-Upload-Content-Type'], 'video/mp4');
  assert.equal(h['X-Upload-Content-Length'], '2048');
  const body = JSON.parse(String(init.body));
  assert.equal(body.status.privacyStatus, 'unlisted');
  assert.equal(body.status.selfDeclaredMadeForKids, false);
  assert.equal(body.snippet.categoryId, '27');
  assert.equal(calls[1].url, 'https://upload.example/session/1');
  assert.equal(calls[1].init.method, 'PUT');
  assert.equal((calls[1].init.headers as Record<string, string>)['Content-Length'], '2048');
});

test('uploadVideo resumes after a 5xx using the server-reported Range', async () => {
  const { calls, fetchImpl } = uploadMock({ putFailures: 1 });
  const r = await uploadVideo({ accessToken: 'tok', videoPath, metadata: meta('unlisted'), privacyStatus: 'unlisted', fetchImpl, retryDelayMs: 0 });
  assert.equal(r.videoId, 'abc123');
  const last = calls.at(-1)!.init.headers as Record<string, string>;
  assert.equal(last['Content-Range'], 'bytes 1024-2047/2048');
  assert.equal(last['Content-Length'], '1024');
});

test('uploadVideo errors when YouTube returns a different privacy (audit restriction)', async () => {
  const { fetchImpl } = uploadMock({ returnedPrivacy: 'private' });
  await assert.rejects(uploadVideo({ accessToken: 'tok', videoPath, metadata: meta('public'), privacyStatus: 'public', fetchImpl }), (e: Error) => {
    assert.ok(e instanceof UserFacingError);
    assert.match(e.message, /"private" instead of the requested "public"/);
    assert.match(e.message, /youtube\.com\/shorts\/abc123/);
    assert.match((e as UserFacingError).hint ?? '', /audit/);
    return true;
  });
});

test('quotaExceeded maps to QuotaExhaustedError; 401 maps to token error', async () => {
  const quota = (async () =>
    jsonRes(403, { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } })) as unknown as typeof fetch;
  await assert.rejects(uploadVideo({ accessToken: 't', videoPath, metadata: meta(), privacyStatus: 'private', fetchImpl: quota }), (e: Error) => {
    assert.ok(e instanceof QuotaExhaustedError);
    assert.match((e as QuotaExhaustedError).hint ?? '', /midnight Pacific/);
    return true;
  });
  const unauth = (async () => jsonRes(401, { error: { code: 401, message: 'Invalid Credentials' } })) as unknown as typeof fetch;
  await assert.rejects(uploadVideo({ accessToken: 't', videoPath, metadata: meta(), privacyStatus: 'private', fetchImpl: unauth }), /HTTP 401/);
});

// ---------- oauth ----------

test('saveTokenFile writes 0600 file without access token', () => {
  const p = join(tmp, 'nested', 'dir', 'youtube-token.json');
  saveTokenFile(p, { refreshToken: 'r1', scope: 's', tokenType: 'Bearer', clientId: 'cid' });
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(statSync(join(tmp, 'nested', 'dir')).mode & 0o777, 0o700);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(j.refresh_token, 'r1');
  assert.equal(j.client_id, 'cid');
  assert.ok(j.created_at);
  assert.equal(j.access_token, undefined);
});

test('loadClientSecret requires a Desktop (installed) client', () => {
  const good = join(tmp, 'cs.json');
  writeFileSync(good, JSON.stringify({ installed: { client_id: 'id', client_secret: 'sec' } }));
  assert.deepEqual(loadClientSecret(good), { clientId: 'id', clientSecret: 'sec' });
  const web = join(tmp, 'cs-web.json');
  writeFileSync(web, JSON.stringify({ web: { client_id: 'id', client_secret: 'sec' } }));
  assert.throws(() => loadClientSecret(web), /Desktop app/);
});

test('refreshAccessToken maps invalid_grant to a helpful error and masks in Actions', async () => {
  const bad = (async () => jsonRes(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })) as unknown as typeof fetch;
  await assert.rejects(refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetchImpl: bad }), (e: Error) => {
    assert.match((e as UserFacingError).hint ?? '', /7 days/);
    return true;
  });
  let body = '';
  const ok = (async (_u: unknown, init: RequestInit) => {
    body = String(init.body);
    return jsonRes(200, { access_token: 'AT', expires_in: 3600 });
  }) as unknown as typeof fetch;
  const prev = process.env.GITHUB_ACTIONS;
  const logs: string[] = [];
  const origLog = console.log;
  process.env.GITHUB_ACTIONS = 'true';
  console.log = (...a: unknown[]) => void logs.push(a.join(' '));
  try {
    assert.equal(await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetchImpl: ok }), 'AT');
  } finally {
    console.log = origLog;
    if (prev === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = prev;
  }
  assert.deepEqual(logs, ['::add-mask::AT']);
  assert.equal(new URLSearchParams(body).get('grant_type'), 'refresh_token');
});

function quietLog<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = () => {};
  return fn().finally(() => (console.log = orig));
}

test('loopback flow: correct state + code → token exchange with PKCE', async () => {
  const realFetch = globalThis.fetch;
  let tokenBody: URLSearchParams | undefined;
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    assert.equal(String(url), GOOGLE_TOKEN_ENDPOINT);
    tokenBody = new URLSearchParams(String(init.body));
    return jsonRes(200, { access_token: 'AT', refresh_token: 'RT', scope: 'https://www.googleapis.com/auth/youtube.upload', token_type: 'Bearer' });
  }) as typeof fetch;

  let authUrl!: URL;
  let browserRes: Promise<Response> | undefined;
  const result = await quietLog(() =>
    authorizeInteractive({
      clientId: 'cid',
      clientSecret: 'csec',
      openBrowser: false,
      timeoutMs: 10_000,
      fetchImpl,
      onAuthUrl: (u) => {
        authUrl = new URL(u);
        const redirect = authUrl.searchParams.get('redirect_uri')!;
        // Simulate the browser: a favicon request (ignored) then the redirect.
        browserRes = realFetch(`${redirect}/favicon.ico`).then((fav) => {
          assert.equal(fav.status, 404);
          return realFetch(`${redirect}/?state=${encodeURIComponent(authUrl.searchParams.get('state')!)}&code=CODE123&scope=x`);
        });
      },
    }),
  );
  const res = await browserRes!;
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Authorization complete/);

  const p = authUrl.searchParams;
  assert.equal(authUrl.origin + authUrl.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.match(p.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('scope'), 'https://www.googleapis.com/auth/youtube.upload');
  assert.equal(p.get('access_type'), 'offline');
  assert.equal(p.get('prompt'), 'consent');
  assert.equal(p.get('include_granted_scopes'), 'true');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.ok(p.get('code_challenge'));

  assert.deepEqual(result, { refreshToken: 'RT', scope: 'https://www.googleapis.com/auth/youtube.upload', tokenType: 'Bearer', clientId: 'cid' });
  assert.equal(tokenBody!.get('code'), 'CODE123');
  assert.equal(tokenBody!.get('grant_type'), 'authorization_code');
  assert.equal(tokenBody!.get('redirect_uri'), p.get('redirect_uri'));
  assert.equal(tokenBody!.get('client_secret'), 'csec');
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(tokenBody!.get('code_verifier')!).digest('base64url'), p.get('code_challenge'));

  // Server is closed afterwards.
  await assert.rejects(realFetch(p.get('redirect_uri')!));
});

test('loopback flow: wrong state is rejected and no token exchange happens', async () => {
  const realFetch = globalThis.fetch;
  let tokenCalls = 0;
  const fetchImpl = (async () => {
    tokenCalls++;
    return jsonRes(200, {});
  }) as unknown as typeof fetch;
  let browserRes: Promise<Response> | undefined;
  await assert.rejects(
    quietLog(() =>
      authorizeInteractive({
        clientId: 'cid',
        clientSecret: 'csec',
        openBrowser: false,
        timeoutMs: 10_000,
        fetchImpl,
        onAuthUrl: (u) => {
          const redirect = new URL(u).searchParams.get('redirect_uri')!;
          browserRes = realFetch(`${redirect}/?state=attacker&code=EVIL`);
        },
      }),
    ),
    /state mismatch/i,
  );
  assert.equal((await browserRes!).status, 400);
  assert.equal(tokenCalls, 0);
});

test('loopback flow: missing refresh_token explains re-consent', async () => {
  const realFetch = globalThis.fetch;
  const fetchImpl = (async () => jsonRes(200, { access_token: 'AT' })) as unknown as typeof fetch;
  await assert.rejects(
    quietLog(() =>
      authorizeInteractive({
        clientId: 'cid',
        clientSecret: 'csec',
        openBrowser: false,
        fetchImpl,
        onAuthUrl: (u) => {
          const url = new URL(u);
          void realFetch(`${url.searchParams.get('redirect_uri')}/?state=${encodeURIComponent(url.searchParams.get('state')!)}&code=C`).then((r) => r.text());
        },
      }),
    ),
    (e: Error) => {
      assert.match(e.message, /refresh token/);
      assert.match((e as UserFacingError).hint ?? '', /myaccount\.google\.com\/permissions/);
      return true;
    },
  );
});

// OAuth 2.0 for installed (Desktop) apps: loopback-IP redirect + PKCE, and refresh-token exchange.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { UserFacingError } from '../util/errors';

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const DEFAULT_TOKEN_PATH = '.secrets/youtube-token.json';
const PERMISSIONS_URL = 'https://myaccount.google.com/permissions';

type FetchLike = typeof fetch;

export interface ClientSecret {
  clientId: string;
  clientSecret: string;
}

export function loadClientSecret(path: string): ClientSecret {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new UserFacingError(`Cannot read OAuth client file ${path}.`, 'Download it from Google Cloud Console → APIs & Services → Credentials (OAuth client ID, type "Desktop app").');
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new UserFacingError(`OAuth client file ${path} is not valid JSON.`);
  }
  const installed = json.installed as Record<string, unknown> | undefined;
  if (!installed) {
    if (json.web) {
      throw new UserFacingError(
        `OAuth client file ${path} is for a "Web application" client, but a "Desktop app" client is required.`,
        'In Google Cloud Console → Credentials, create an OAuth client ID with Application type "Desktop app" and download its JSON.',
      );
    }
    throw new UserFacingError(`OAuth client file ${path} has no "installed" section.`, 'Use the JSON downloaded for an OAuth client of type "Desktop app".');
  }
  const clientId = installed.client_id;
  const clientSecret = installed.client_secret;
  if (typeof clientId !== 'string' || !clientId || typeof clientSecret !== 'string' || !clientSecret) {
    throw new UserFacingError(`OAuth client file ${path} is missing client_id or client_secret.`);
  }
  return { clientId, clientSecret };
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

function openInBrowser(url: string) {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') [cmd, args] = ['open', [url]];
  else if (process.platform === 'win32') [cmd, args] = ['cmd', ['/c', 'start', '""', url]];
  else [cmd, args] = ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', () => console.log('(Could not open a browser automatically — open the URL above manually.)'));
    child.unref();
  } catch {
    console.log('(Could not open a browser automatically — open the URL above manually.)');
  }
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface AuthorizeResult {
  refreshToken: string;
  scope: string;
  tokenType: string;
  clientId: string;
}

export interface AuthorizeOptions {
  clientId: string;
  clientSecret: string;
  openBrowser?: boolean;
  timeoutMs?: number;
  /** Called with the consent URL once the loopback server is listening (tests / custom UIs). */
  onAuthUrl?: (url: string) => void;
  fetchImpl?: FetchLike;
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto"><h1>${title}</h1><p>${body}</p></body></html>`;

export async function authorizeInteractive(opts: AuthorizeOptions): Promise<AuthorizeResult> {
  const { clientId, clientSecret, openBrowser = true, timeoutMs = 5 * 60_000, onAuthUrl, fetchImpl = fetch } = opts;
  const codeVerifier = base64url(randomBytes(64));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  const state = base64url(randomBytes(32));

  let server: Server | undefined;
  try {
    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let redirectUri = '';
      let settled = false;
      const finish = (err: Error | null, code?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve({ code: code!, redirectUri });
      };
      const timer = setTimeout(
        () => finish(new UserFacingError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the Google consent redirect.`, 'Re-run the command and complete consent in the browser.')),
        timeoutMs,
      );

      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (req.method !== 'GET' || url.pathname !== '/' || (!url.searchParams.has('code') && !url.searchParams.has('error') && !url.searchParams.has('state'))) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
          return;
        }
        const send = (status: number, title: string, body: string) =>
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(PAGE(title, body));
        const gotState = url.searchParams.get('state') ?? '';
        if (!safeEqual(gotState, state)) {
          send(400, 'Authorization failed', 'State mismatch. Close this tab and re-run the command.');
          finish(new UserFacingError('OAuth state mismatch on the redirect — possible CSRF or a stale browser tab. Authorization aborted.', 'Re-run the authorize command.'));
          return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          send(400, 'Authorization failed', 'Google returned an error. You can close this tab.');
          finish(new UserFacingError(`Google authorization was not granted: ${error}.`, 'Re-run the command and click "Allow" on the consent screen.'));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          send(400, 'Authorization failed', 'No authorization code received.');
          finish(new UserFacingError('Google redirect did not include an authorization code.'));
          return;
        }
        send(200, 'Authorization complete', 'You can close this tab and return to the terminal.');
        finish(null, code);
      });
      server.on('error', (e) => finish(e));
      server.listen(0, '127.0.0.1', () => {
        const port = (server!.address() as AddressInfo).port;
        redirectUri = `http://127.0.0.1:${port}`;
        const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
        const p = authUrl.searchParams;
        p.set('client_id', clientId);
        p.set('redirect_uri', redirectUri);
        p.set('response_type', 'code');
        p.set('scope', YOUTUBE_UPLOAD_SCOPE);
        p.set('access_type', 'offline');
        p.set('prompt', 'consent');
        p.set('include_granted_scopes', 'true');
        p.set('state', state);
        p.set('code_challenge', codeChallenge);
        p.set('code_challenge_method', 'S256');
        const href = authUrl.toString();
        console.log(`\nOpen this URL to authorize YouTube uploads:\n\n${href}\n`);
        onAuthUrl?.(href);
        if (openBrowser) openInBrowser(href);
      });
    });

    const res = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || json.error) {
      throw new UserFacingError(`Token exchange failed (HTTP ${res.status}): ${json.error ?? 'unknown_error'}${json.error_description ? ` — ${json.error_description}` : ''}.`);
    }
    if (!json.refresh_token) {
      throw new UserFacingError(
        'Google did not return a refresh token.',
        `Revoke this app's access at ${PERMISSIONS_URL} and re-run the command so Google shows the consent screen again.`,
      );
    }
    return { refreshToken: json.refresh_token, scope: json.scope ?? YOUTUBE_UPLOAD_SCOPE, tokenType: json.token_type ?? 'Bearer', clientId };
  } finally {
    const s = server as Server | undefined;
    if (s) {
      s.closeAllConnections?.();
      await new Promise<void>((r) => s.close(() => r()));
    }
  }
}

export interface TokenFile {
  refresh_token: string;
  scope: string;
  token_type: string;
  client_id: string;
  created_at: string;
}

/** Writes the refresh token (never the access token) with owner-only permissions. */
export function saveTokenFile(path: string, data: AuthorizeResult | TokenFile) {
  const file: TokenFile =
    'refreshToken' in data
      ? { refresh_token: data.refreshToken, scope: data.scope, token_type: data.tokenType, client_id: data.clientId, created_at: new Date().toISOString() }
      : { refresh_token: data.refresh_token, scope: data.scope, token_type: data.token_type, client_id: data.client_id, created_at: data.created_at };
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function loadTokenFile(path: string): TokenFile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return typeof j?.refresh_token === 'string' && j.refresh_token ? (j as TokenFile) : undefined;
  } catch {
    throw new UserFacingError(`Token file ${path} is not valid JSON.`, 'Re-run `npm run youtube:authorize`.');
  }
}

export async function refreshAccessToken(o: { clientId: string; clientSecret: string; refreshToken: string; fetchImpl?: FetchLike }): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, refresh_token: o.refreshToken, grant_type: 'refresh_token' }).toString(),
    });
  } catch (e) {
    throw new UserFacingError(`Network error contacting Google's token endpoint: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (json.error === 'invalid_grant') {
    throw new UserFacingError(
      'YouTube refresh token was rejected (invalid_grant): it has been revoked or has expired.',
      'OAuth apps whose consent screen is in "Testing" publishing status issue refresh tokens that expire after 7 days. ' +
        'Set the OAuth consent screen to "In production" (unverified is fine for personal use), or re-run `npm run youtube:authorize` and update the YOUTUBE_REFRESH_TOKEN secret.',
    );
  }
  if (json.error === 'invalid_client' || json.error === 'unauthorized_client') {
    throw new UserFacingError(`Google rejected the OAuth client (${json.error}).`, 'Check YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET match the client used to create the refresh token.');
  }
  if (!res.ok || !json.access_token) {
    throw new UserFacingError(`Refreshing the YouTube access token failed (HTTP ${res.status}): ${json.error ?? 'no access_token in response'}${json.error_description ? ` — ${json.error_description}` : ''}.`);
  }
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${json.access_token}`);
  return json.access_token;
}

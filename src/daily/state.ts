export const STATE_BRANCH = 'daily-publish-state';
const STATE_FILE = 'daily-publish.json';

export interface EpisodeState {
  date: string;
  status: 'dispatched' | 'uploading' | 'published' | 'failed';
  controller: string;
  runId?: number;
  videoId?: string;
  visibility?: 'public';
}

export interface Ledger {
  startDate: string;
  episodes: Record<string, EpisodeState>;
}

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const github = {
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const { GITHUB_API_URL, GITHUB_REPOSITORY, GH_TOKEN } = process.env;
    if (!GITHUB_REPOSITORY || !GH_TOKEN) throw new Error('GitHub repository and token are required.');
    const response = await fetch(`${GITHUB_API_URL ?? 'https://api.github.com'}/repos/${GITHUB_REPOSITORY}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new GitHubError(response.status, `GitHub ${method} ${path}: HTTP ${response.status}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  },
};

export async function readLedger(): Promise<{ data: Ledger; sha: string } | undefined> {
  let file;
  try {
    file = await github.request<{ sha: string; content: string }>(`/contents/${STATE_FILE}?ref=${STATE_BRANCH}`);
  } catch (error) {
    if (!(error instanceof GitHubError && error.status === 404)) throw error;
    try {
      await github.request(`/git/ref/heads/${STATE_BRANCH}`);
    } catch (branchError) {
      if (branchError instanceof GitHubError && branchError.status === 404) return undefined;
      throw branchError;
    }
    throw new Error(`${STATE_FILE} is missing from ${STATE_BRANCH}. Restore the ledger before continuing.`);
  }
  const data: Ledger = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  if (!data.startDate || !data.episodes || Array.isArray(data.episodes)) throw new Error('Invalid daily publishing ledger.');
  return { data, sha: file.sha };
}

export async function writeLedger(data: Ledger, message: string, sha?: string) {
  await github.request(`/contents/${STATE_FILE}`, 'PUT', {
    branch: STATE_BRANCH,
    message,
    sha,
    content: Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64'),
  });
}

export async function startLedger(date: string) {
  const data: Ledger = { startDate: date, episodes: {} };
  await github.request('/git/refs', 'POST', {
    ref: `refs/heads/${STATE_BRANCH}`,
    sha: process.env.GITHUB_SHA,
  });
  await writeLedger(data, `Start daily publishing on ${date}`);
}

export async function updateEpisode(id: string, update: (current?: EpisodeState) => EpisodeState) {
  const ledger = await readLedger();
  if (!ledger) throw new Error('Daily publishing ledger has not been initialized.');
  const next = update(ledger.data.episodes[id]);
  ledger.data.episodes[id] = next;
  await writeLedger(ledger.data, `Daily Short ${id}: ${next.status}`, ledger.sha);
}

export async function dailyUpload(id: string, visibility: string) {
  const runId = Number(process.env.GITHUB_RUN_ID);
  if (process.env.GITHUB_RUN_ATTEMPT !== '1' || !runId || visibility !== 'public') {
    throw new Error('Daily uploads require the original controller-dispatched run and public visibility.');
  }

  function requireRun(current: EpisodeState | undefined, status: EpisodeState['status']) {
    if (!current || current.runId !== runId || current.status !== status) {
      throw new Error(`Run ${runId} is not authorized to upload daily episode ${id} in state ${status}.`);
    }
    return current;
  }

  const ledger = await readLedger();
  requireRun(ledger?.data.episodes[id], 'dispatched');
  return {
    beforeUploadBytes: () => updateEpisode(id, (current) => ({
      ...requireRun(current, 'dispatched'),
      status: 'uploading',
    })),
    onUploadRejected: () => updateEpisode(id, (current) => ({
      ...requireRun(current, 'uploading'),
      status: 'dispatched',
    })),
    confirm: (result: { videoId: string; privacyStatus: string }) => updateEpisode(id, (current) => {
      if (!/^[\w-]{11}$/.test(result.videoId) || result.privacyStatus !== 'public') {
        throw new Error(`YouTube did not confirm a public video ID for ${id}.`);
      }
      return { ...requireRun(current, 'uploading'), status: 'published', videoId: result.videoId, visibility: 'public' };
    }),
  };
}

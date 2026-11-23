import assert from 'node:assert/strict';
import { test } from 'node:test';
import curriculum from '../curriculum/daily.json';
import { nyDate, validateCurriculum } from '../src/daily/plan';
import { publishDaily } from '../src/daily/publish';
import { GitHubError, github, type Ledger } from '../src/daily/state';

const date = '2025-01-01';
const episodes = curriculum[0].episodes;

test('daily curriculum has 14 days and 84 unique episodes; dates use New York', () => {
  assert.ok(validateCurriculum(curriculum).length >= 14);
  assert.equal(new Set(curriculum.slice(0, 14).flatMap(({ episodes }) => episodes.map(({ id }) => id))).size, 84);
  assert.equal(nyDate(new Date('2025-07-02T03:30:00Z')), '2025-07-01');
  assert.throws(() => validateCurriculum([{ ...curriculum[0], episodes: episodes.slice(1) }]), /three dialogue and three vocab/);
});

test('daily preview, failure recovery, quota and reconciliation use mocked workflows', async (t) => {
  let ledger: Ledger = { startDate: date, episodes: {} };
  let sha = 0;
  let failure: 'render' | 'quota' | 'ambiguous' | undefined;
  const dispatched: string[] = [];
  const runs = new Map<number, { id: string; failure?: typeof failure }>();
  let writes = 0;
  t.mock.method(github, 'request', async (path: string, method = 'GET', body?: unknown) => {
    if (path === '/contents/daily-publish.json?ref=daily-publish-state' && method === 'GET') {
      return { sha: String(sha), content: Buffer.from(JSON.stringify(ledger)).toString('base64') };
    } else if (path === '/contents/daily-publish.json' && method === 'PUT') {
      const file = body as { branch: string; sha: string; content: string };
      assert.equal(file.branch, 'daily-publish-state');
      assert.equal(file.sha, String(sha++));
      writes++;
      ledger = JSON.parse(Buffer.from(file.content, 'base64').toString());
      return {};
    } else if (path === '/actions/workflows/short.yml/dispatches' && method === 'POST') {
      const request = body as { inputs: { daily_episode: string } };
      const id = request.inputs.daily_episode;
      const episode = episodes.find((episode) => episode.id === id);
      assert.ok(episode);
      assert.deepEqual(request, {
        ref: 'main', return_run_details: true,
        inputs: { daily_episode: id, topic: episode.topic, mode: episode.mode, upload: 'true',
          visibility: 'public', scene: 'auto', tts_provider: 'edge' },
      });
      const run = runs.size + 1;
      runs.set(run, { id, failure: id === episodes[1].id ? failure : undefined });
      dispatched.push(id);
      return { workflow_run_id: run };
    } else if (path?.match(/^\/actions\/runs\/\d+$/)) {
      const runId = Number(path.split('/').at(-1));
      const run = runs.get(runId);
      assert.ok(run);
      const entry = ledger.episodes[run.id];
      assert.equal(entry.runId, runId);
      if (!run.failure) {
        Object.assign(entry, { status: 'published', visibility: 'public', videoId: String(runId).padStart(11, '0') });
        sha++;
      }
      if (run.failure === 'ambiguous') entry.status = 'uploading';
      return { status: 'completed' };
    } else if (path?.match(/^\/actions\/runs\/\d+\/attempts\/1\/jobs\?per_page=100$/)) {
      const run = runs.get(Number(path.split('/')[3]));
      return { jobs: [{ steps: run?.failure === 'quota' ? [{ name: 'Provider quota stop', conclusion: 'success' }] : [] }] };
    } else {
      throw new GitHubError(404, `Unexpected request: ${method} ${path}`);
    }
  });
  const logs: string[] = [];
  t.mock.method(console, 'log', (message: string) => { logs.push(message); });
  const settings = {
    DEFAULT_BRANCH: 'main', GITHUB_STEP_SUMMARY: '',
    GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '1', DAILY_DATE: date, DAILY_MODE: 'preview',
  };
  const before = { ...process.env };
  Object.assign(process.env, settings);
  t.after(() => {
    for (const key of Object.keys(settings)) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });

  await publishDaily();
  const planned = logs.join('\n').split('\n').filter((line) => line.startsWith('- `')).map((line) => JSON.parse(line.slice(3, -1)));
  assert.deepEqual(planned.map((inputs) => inputs.daily_episode), episodes.map(({ id }) => id));
  assert.deepEqual(planned.map((inputs) => inputs.mode), ['dialogue', 'dialogue', 'dialogue', 'vocab', 'vocab', 'vocab']);
  assert.equal(writes, 0);
  assert.equal(dispatched.length, 0);

  process.env.DAILY_MODE = 'retry';
  failure = 'render';
  await assert.rejects(publishDaily(), /1 episode\(s\) remain/);
  assert.equal(dispatched.length, 6);
  failure = undefined;
  await publishDaily();
  assert.deepEqual(dispatched.slice(6), [episodes[1].id]);
  assert.ok(Object.values(ledger.episodes).every(({ status }) => status === 'published'));

  for (const kind of ['quota', 'ambiguous'] as const) {
    ledger = { startDate: date, episodes: {} };
    dispatched.length = 0;
    failure = kind;
    await assert.rejects(publishDaily(), kind === 'quota' ? /Provider quota exhausted/ : /Reconcile d01-dialogue-2/);
    assert.deepEqual(dispatched, episodes.slice(0, 2).map(({ id }) => id));
    assert.equal(ledger.episodes[episodes[0].id].status, 'published');
  }
  await assert.rejects(publishDaily(), /Reconcile d01-dialogue-2/);
  assert.equal(dispatched.length, 2);
});

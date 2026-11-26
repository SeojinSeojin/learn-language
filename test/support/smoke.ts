// Assertions and run summary for .github/workflows/qwen-fallback-smoke.yml.
//   npx tsx test/support/smoke.ts outage  --state <state.json> --log <gemini-requests.jsonl>
//   npx tsx test/support/smoke.ts healthy --state <state.json> --log <gemini-requests.jsonl>
//   npx tsx test/support/smoke.ts qwen    --state <state.json> --dir <scripts dir> --starts <ollama-starts.log> --pid <pid>
//   npx tsx test/support/smoke.ts summary --state <state.json> [--title <heading>]
//   npx tsx test/support/smoke.ts seed --episodes <file> --id <episode> --dir <scripts dir>   (a "restored" valid file)
//   npx tsx test/support/smoke.ts quota --state <state.json> --log <gemini-requests.jsonl> --dir <scripts dir>
//   npx tsx test/support/smoke.ts quota-final --state <state.json> --dir <scripts dir> --starts <log> --pid <pid>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { checkPrepared, type BatchState } from '../../src/daily/prepare';
import { preparedFile, writePreparedScript, type EpisodeRef } from '../../src/prepared/script';
import { SAMPLE_VOCAB } from '../../src/vocab/sample';
import { parseArgs } from '../../src/util/env';

const args = parseArgs();
const arg = (k: string) => {
  const v = args[k];
  if (typeof v !== 'string' || !v) throw new Error(`--${k} is required`);
  return v;
};
const readState = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as BatchState;
const readLog = (file: string) =>
  existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { kind: string; model: string }) : [];
const summary = (md: string) => {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
};
const count = (cmd: string, cmdArgs: string[]) => {
  try {
    return Number(execFileSync(cmd, cmdArgs, { encoding: 'utf8' }).trim());
  } catch {
    return 0;
  }
};

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** One Ollama server for the job, still the original process, and the model never reloaded. */
function assertSingleOllama(state: BatchState) {
  const starts = readFileSync(arg('starts'), 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(starts.length, 1, `Ollama must start exactly once (got ${starts.length})`);
  const pid = Number(arg('pid'));
  assert.ok(pid > 0);
  process.kill(pid, 0); // throws if the original server is gone (i.e. it was restarted)
  assert.equal(count('pgrep', ['-c', '-f', 'ollama serve']), 1, 'exactly one ollama serve process');
  for (const [id, r] of Object.entries(state.results)) {
    // Ollama reports load_duration per request; a reload of an 8B model takes several seconds.
    if (r.provider === 'ollama' && !r.reused) assert.ok((r.loadSeconds ?? 0) < 2, `${id}: model was reloaded (load ${r.loadSeconds} s)`);
  }
  return pid;
}

const PRODUCTION_DAILY_QUOTA = 'Rate limit exceeded for model gemini-3.6-flash (limit: 20 requests per day on Free Tier). Please retry in 5h39m1s or upgrade your tier';

const command = args._[0];
if (command === 'outage') {
  const state = readState(arg('state'));
  const requests = readLog(arg('log'));
  assert.deepEqual(state.fallback.map((f) => [f.id, f.reason, f.status ?? null]), [
    ['smoke-dialogue-1', 'http', 503],
    ['smoke-vocab-1', 'timeout', null],
  ]);
  assert.equal(state.fallback[1].message, 'Gemini (gemini-3.6-flash): request timed out after 120 s.');
  assert.match(state.fallback[0].message, /^Gemini \(gemini-3\.6-flash\): API error 503 UNAVAILABLE/);
  assert.equal(requests.filter((r) => r.kind === 'dialogue').length, 3, 'persistent 503: 1 request + 2 bounded retries');
  assert.equal(requests.filter((r) => r.kind === 'vocab').length, 1, 'timeout: not retried');
  assert.deepEqual(state.results, {}, 'no script came from Gemini');
  console.log('✓ Gemini outage classified: dialogue → persistent HTTP 503 after retries, vocab → 120 s timeout. Both queued for Qwen.');
} else if (command === 'healthy') {
  const state = readState(arg('state'));
  assert.deepEqual(state.fallback, []);
  assert.ok(state.episodes.every((e) => state.results[e.id]?.provider === 'gemini'));
  assert.equal(readLog(arg('log')).length, 2);
  console.log('✓ Healthy Gemini: both scripts from Gemini, fallback_needed=false.');
} else if (command === 'qwen') {
  const state = readState(arg('state'));
  const dir = arg('dir');
  checkPrepared(dir, state);
  assert.ok(state.episodes.every((e) => state.results[e.id]?.provider === 'ollama'), 'both scripts came from Qwen');
  const pid = assertSingleOllama(state);
  console.log(`✓ Qwen produced valid scripts for ${state.episodes.length} episodes; one Ollama server (pid ${pid}), model loaded once.`);
} else if (command === 'seed') {
  // Simulates a valid script restored from an earlier daily-scripts artifact.
  const episodes = JSON.parse(readFileSync(arg('episodes'), 'utf8')) as EpisodeRef[];
  const episode = episodes.find((e) => e.id === arg('id'));
  assert.ok(episode && episode.mode === 'vocab', 'seed expects a vocab episode');
  const file = writePreparedScript(arg('dir'), episode, { provider: 'gemini', model: 'gemini-3.6-flash' }, { ...SAMPLE_VOCAB, topic: episode.topic });
  writeFileSync(`${file}.sha256`, sha(file));
  console.log(`Seeded ${file} (as if restored from an earlier artifact).`);
} else if (command === 'quota') {
  const state = readState(arg('state'));
  const requests = readLog(arg('log'));
  const dir = arg('dir');
  assert.equal(requests.length, 2, `Gemini must not be called after the daily-quota error (got ${requests.length} requests)`);
  assert.deepEqual(requests.map((r) => r.kind), ['dialogue', 'vocab']);
  assert.equal(state.geminiDailyQuota?.episodeId, 'quota-vocab-1');
  assert.ok(state.geminiDailyQuota?.message.includes(PRODUCTION_DAILY_QUOTA), state.geminiDailyQuota?.message);
  assert.deepEqual(state.fallback.map((f) => [f.id, f.reason, f.geminiCalled]), [
    ['quota-vocab-1', 'daily-quota', true],
    ['quota-dialogue-2', 'daily-quota', false],
  ]);
  assert.equal(state.results['quota-dialogue-1']?.provider, 'gemini');
  assert.equal(state.results['quota-vocab-2']?.reused, true);
  writeFileSync(`${preparedFile(dir, 'quota-dialogue-1')}.sha256`, sha(preparedFile(dir, 'quota-dialogue-1')));
  console.log('✓ Gemini daily quota: Gemini called twice (1 success, 1 daily-quota 429), then never again; restored file reused; 2 episodes queued for Qwen.');
} else if (command === 'quota-final') {
  const state = readState(arg('state'));
  const dir = arg('dir');
  checkPrepared(dir, state);
  const sources = state.episodes.map((e) => [e.id, state.results[e.id]?.provider, Boolean(state.results[e.id]?.reused)]);
  assert.deepEqual(sources, [
    ['quota-dialogue-1', 'gemini', false],
    ['quota-vocab-1', 'ollama', false],
    ['quota-dialogue-2', 'ollama', false],
    ['quota-vocab-2', 'gemini', true],
  ]);
  for (const id of ['quota-dialogue-1', 'quota-vocab-2']) {
    const file = preparedFile(dir, id);
    assert.equal(sha(file), readFileSync(`${file}.sha256`, 'utf8'), `${id} JSON changed`);
  }
  const pid = assertSingleOllama(state);
  console.log(`✓ Qwen generated a word list and a dialogue on one Ollama server (pid ${pid}); Gemini and restored JSON unchanged.`);
} else if (command === 'summary') {
  const state = readState(arg('state'));
  const o = state.ollama;
  const title = typeof args.title === 'string' ? args.title : 'Qwen fallback smoke test';
  const lines = [
    `## ${title}`,
    '',
    '### Measured on this runner (real Ollama + Qwen)',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Model | \`${o?.model ?? 'n/a'}\` (Ollama ${o?.version ?? 'n/a'}, 127.0.0.1) |`,
    `| Model cache | ${o?.cacheHit === 'true' ? 'hit' : o?.cacheHit === 'false' ? 'miss' : 'n/a'} |`,
    `| Model cache restore | ${o?.restoreSeconds ? `${o.restoreSeconds} s` : 'n/a'} |`,
    `| Model download | ${o?.downloadSeconds ? `${o.downloadSeconds} s` : 'not needed (cache hit)'} |`,
    `| Model load | ${o?.loadSeconds ?? 'n/a'} s |`,
    ...state.episodes.map((e) => {
      const r = state.results[e.id];
      if (r?.provider !== 'ollama') return `| \`${e.id}\` (${e.mode}) | ${r?.reused ? 'reused (no provider call)' : r ? `Gemini (mock), not Qwen` : 'failed'} |`;
      return `| Generation \`${e.id}\` (${e.mode}) | ${r.seconds} s, ${r.requests} request(s) |`;
    }),
    '',
    '### Mocked checks (no real Gemini, no credentials)',
    '',
    ...(state.geminiDailyQuota
      ? [
          '- Loopback mock Gemini: the first dialogue succeeded, then the word list got the production HTTP 429 from run 45741747083 (`… limit: 20 requests per day on Free Tier …`). Classified as a Gemini daily quota; Gemini received no further request (2 in total).',
          '- `quota-vocab-2` was seeded as a valid script (as if restored from an earlier artifact) and reused without calling either provider; it and the Gemini dialogue were byte-for-byte unchanged afterwards.',
          '- Unit tests (`npm test`): structured QuotaFailure vs message classification, a bare 429 never falls back, a transient per-minute 429 keeps its bounded retries.',
        ]
      : [
          '- Loopback mock Gemini: dialogue → persistent HTTP 503 (1 request + 2 retries), word list → hung request → `Gemini (gemini-3.6-flash): request timed out after 120 s.` Both classified by error type and sent to Qwen.',
          '- Loopback mock Gemini (healthy): both scripts from Gemini, all Ollama setup steps skipped, no Ollama binary, model files or process on the runner.',
          '- Unit tests (`npm test`): fallback classification, Ollama request shape (thinking off, `format` = JSON schema), invalid Qwen output stops the batch with no file written, prepared-file validation, child CLI exits before TTS on a missing/invalid file.',
        ]),
    '',
  ];
  summary(lines.join('\n'));
} else {
  throw new Error('Usage: smoke.ts outage|healthy|qwen|summary ...');
}

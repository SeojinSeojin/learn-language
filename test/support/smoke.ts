// Assertions and run summary for .github/workflows/qwen-fallback-smoke.yml.
//   npx tsx test/support/smoke.ts outage  --state <state.json> --log <gemini-requests.jsonl>
//   npx tsx test/support/smoke.ts healthy --state <state.json> --log <gemini-requests.jsonl>
//   npx tsx test/support/smoke.ts qwen    --state <state.json> --dir <scripts dir> --starts <ollama-starts.log> --pid <pid>
//   npx tsx test/support/smoke.ts summary --state <state.json> [--healthy-state <state.json>]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { checkPrepared, type BatchState } from '../../src/daily/prepare';
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
  const starts = readFileSync(arg('starts'), 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(starts.length, 1, `Ollama must start exactly once (got ${starts.length})`);
  const pid = Number(arg('pid'));
  assert.ok(pid > 0);
  process.kill(pid, 0); // throws if the original server is gone (i.e. it was restarted)
  assert.equal(count('pgrep', ['-c', '-f', 'ollama serve']), 1, 'exactly one ollama serve process');
  for (const e of state.episodes) {
    const r = state.results[e.id];
    // Ollama reports load_duration per request; a reload of an 8B model takes several seconds.
    assert.ok((r.loadSeconds ?? 0) < 2, `${e.id}: model was reloaded (load ${r.loadSeconds} s)`);
  }
  console.log(`✓ Qwen produced valid scripts for ${state.episodes.length} episodes; one Ollama server (pid ${pid}), model loaded once.`);
} else if (command === 'summary') {
  const state = readState(arg('state'));
  const o = state.ollama;
  const lines = [
    '## Qwen fallback smoke test',
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
      return `| Generation \`${e.id}\` (${e.mode}) | ${r ? `${r.seconds} s, ${r.requests} request(s)` : 'failed'} |`;
    }),
    '',
    '### Mocked checks (no real Gemini, no credentials)',
    '',
    '- Loopback mock Gemini: dialogue → persistent HTTP 503 (1 request + 2 retries), word list → hung request → `Gemini (gemini-3.6-flash): request timed out after 120 s.` Both classified by error type and sent to Qwen.',
    '- Loopback mock Gemini (healthy): both scripts from Gemini, all Ollama setup steps skipped, no Ollama binary, model files or process on the runner.',
    '- Unit tests (`npm test`): fallback classification, Ollama request shape (thinking off, `format` = JSON schema), invalid Qwen output stops the batch with no file written, prepared-file validation, child CLI exits before TTS on a missing/invalid file.',
    '',
  ];
  summary(lines.join('\n'));
} else {
  throw new Error('Usage: smoke.ts outage|healthy|qwen|summary ...');
}

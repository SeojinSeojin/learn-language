// Mocked checks for the keyless Qwen fallback: error classification, the Gemini → Ollama batch phases,
// the Ollama request shape, prepared-script validation and the child's prepared-script path.
// No network, no model: every HTTP call is answered by a fetch mock.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockGeminiRequests, callInteraction, interactionsUrl } from '../src/gemini/client';
import { geminiTextGenerator, isGeminiFallbackEligible } from '../src/text/provider';
import { ollamaBaseUrl, ollamaModel, DEFAULT_OLLAMA_MODEL } from '../src/ollama/client';
import { checkPrepared, prepareWithGemini, prepareWithOllama, type BatchState } from '../src/daily/prepare';
import { PreparedScriptError, preparedFile, readPreparedScript, writePreparedScript, type EpisodeRef } from '../src/prepared/script';
import { SAMPLE_DIALOGUE } from '../src/dialogue/sample';
import { SAMPLE_VOCAB } from '../src/vocab/sample';
import { DialogueValidationError, dialogueJsonSchema } from '../src/dialogue/schema';
import { ProviderUnavailableError, QuotaExhaustedError, UserFacingError } from '../src/util/errors';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OLLAMA_MODEL;
});

interface Call { url: string; body: any }
function mockFetch(responder: (call: Call, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return responder(call, init);
  }) as typeof fetch;
  return calls;
}
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const textInteraction = (text: string) => ({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] });
/** Never answers; rejects when the client aborts (like a hung Gemini request). */
const hang = (init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
const unavailable = () => json({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } }, 503);

const dialogueRaw = { sceneId: 'park', lines: SAMPLE_DIALOGUE.lines, hashtags: ['park'] };
const vocabRaw = { words: SAMPLE_VOCAB.words, hashtags: ['fruits'] };
const EPISODES: EpisodeRef[] = [
  { id: 'smoke-dialogue-1', mode: 'dialogue', topic: 'Greeting a neighbor at the park' },
  { id: 'smoke-vocab-1', mode: 'vocab', topic: 'Fruits at the market' },
];
const isOllama = (url: string) => url.startsWith('http://127.0.0.1:11434');
const tmp = () => mkdtempSync(join(tmpdir(), 'fallback-'));
const gemini = (timeoutMs = 50) => () => geminiTextGenerator({ apiKey: 'test-key', model: 'gemini-3.6-flash', retryBaseMs: 0, timeoutMs });

test('run 45698283703 path: a 120 s Gemini timeout is a typed, fallback-eligible error with the same message', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = mockFetch((_c, init) => hang(init));
  const pending = callInteraction({ model: 'gemini-3.6-flash', input: 'x' }, { apiKey: 'k' });
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(120_000);
  await assert.rejects(pending, (err: unknown) => {
    assert.ok(err instanceof ProviderUnavailableError);
    assert.equal(err.reason, 'timeout');
    assert.equal(err.status, undefined);
    assert.equal(err.message, 'Gemini (gemini-3.6-flash): request timed out after 120 s.');
    assert.ok(isGeminiFallbackEligible(err));
    return true;
  });
  assert.equal(calls.length, 1, 'timeouts are not retried');
});

test('persistent 503 falls back only after the bounded retries; 500, 429, 400 and 401 never fall back', async () => {
  let calls = mockFetch(() => unavailable());
  await assert.rejects(callInteraction({ model: 'm' }, { apiKey: 'k', retryBaseMs: 0 }), (err: unknown) => {
    assert.ok(err instanceof ProviderUnavailableError && err.status === 503 && err.reason === 'http');
    return isGeminiFallbackEligible(err);
  });
  assert.equal(calls.length, 3, '1 request + 2 retries');

  calls = mockFetch((_c) => (calls.length === 1 ? unavailable() : json(textInteraction('{}'))));
  await callInteraction({ model: 'm' }, { apiKey: 'k', retryBaseMs: 0 });
  assert.equal(calls.length, 2, 'a transient 503 recovers inside Gemini’s own retry policy');

  const cases: [number, unknown][] = [
    [500, { error: { message: 'internal' } }],
    [429, { error: { message: 'Quota exceeded for requests per day', status: 'RESOURCE_EXHAUSTED' } }],
    [400, { error: { message: 'bad' } }],
    [401, { error: { message: 'bad key' } }],
  ];
  for (const [status, body] of cases) {
    mockFetch(() => json(body, status));
    await assert.rejects(callInteraction({ model: 'm' }, { apiKey: 'k', retryBaseMs: 0 }), (err: unknown) => {
      assert.ok(err instanceof UserFacingError);
      assert.equal(isGeminiFallbackEligible(err), false, `HTTP ${status} must not fall back`);
      if (status === 429) assert.ok(err instanceof QuotaExhaustedError);
      return true;
    });
  }
  assert.equal(isGeminiFallbackEligible(new Error('timed out after 120 s')), false, 'classification is by type, not message');
});

test('Gemini success: the batch is prepared without any Ollama request or setup', async () => {
  const dir = tmp();
  const stateFile = join(dir, 'state', 'state.json');
  const calls = mockFetch((c) => {
    assert.ok(!isOllama(c.url));
    return json(textInteraction(JSON.stringify(/bilingual dialogues/.test(c.body.input) ? dialogueRaw : vocabRaw)));
  });
  const state = await prepareWithGemini({ dir, stateFile, date: 'test', episodes: EPISODES, gemini: gemini() });
  assert.deepEqual(state.fallback, []);
  assert.equal(calls.length, 2);
  for (const e of EPISODES) {
    assert.equal(readPreparedScript(preparedFile(dir, e.id), e).meta.provider, 'gemini');
  }
  // The fallback phase is a no-op that never contacts Ollama.
  const after = await prepareWithOllama({ dir, stateFile });
  assert.equal(after.ollama, undefined);
  assert.equal(calls.filter((c) => isOllama(c.url)).length, 0);
  checkPrepared(dir, after);
});

function ollamaMock(chat: (body: any, n: number) => unknown) {
  let chats = 0;
  return mockFetch((c, init) => {
    // Gemini: persistent 503 for the dialogue, a hung request (client timeout) for the word list.
    if (c.url.endsWith('/v1beta/interactions')) return /bilingual dialogues/.test(c.body.input) ? unavailable() : hang(init);
    if (c.url === 'http://127.0.0.1:11434/api/version') return json({ version: '0.40.18' });
    if (c.url === 'http://127.0.0.1:11434/api/generate') return json({ done: true, done_reason: 'load', load_duration: 4_200_000_000, total_duration: 4_300_000_000 });
    if (c.url === 'http://127.0.0.1:11434/api/chat') {
      return json({ message: { role: 'assistant', content: JSON.stringify(chat(c.body, ++chats)) }, done: true, load_duration: 20_000_000, eval_count: 500 });
    }
    throw new Error(`unexpected ${c.url}`);
  });
}

test('Gemini 503 + timeout → one Ollama load, Qwen generates both scripts with thinking off and schema-constrained JSON', async () => {
  const dir = tmp();
  const stateFile = join(dir, 'state.json');
  const calls = ollamaMock((body) => (body.format.properties.sceneId ? dialogueRaw : vocabRaw));
  const state = await prepareWithGemini({ dir, stateFile, date: 'test', episodes: EPISODES, gemini: gemini(10) });
  assert.deepEqual(state.fallback.map((f) => [f.id, f.reason, f.status]), [
    ['smoke-dialogue-1', 'http', 503],
    ['smoke-vocab-1', 'timeout', undefined],
  ]);
  assert.equal(calls.filter((c) => isOllama(c.url)).length, 0, 'phase 1 never touches Ollama');
  assert.equal(calls.filter((c) => c.url.endsWith('/interactions')).length, 4, '503: 1 + 2 retries; timeout: 1');

  const done = await prepareWithOllama({ dir, stateFile });
  checkPrepared(dir, done);
  assert.equal(calls.filter((c) => c.url.endsWith('/api/version')).length, 1);
  assert.equal(calls.filter((c) => c.url.endsWith('/api/generate')).length, 1, 'model loaded once for the batch');
  const chats = calls.filter((c) => c.url.endsWith('/api/chat'));
  assert.equal(chats.length, 2);
  for (const c of chats) {
    assert.equal(c.body.model, DEFAULT_OLLAMA_MODEL);
    assert.equal(c.body.think, false);
    assert.equal(c.body.stream, false);
    assert.equal(c.body.format.type, 'object');
    assert.match(c.body.messages[0].content, /<topic>.*<\/topic>/);
  }
  assert.deepEqual(chats[0].body.format, dialogueJsonSchema());
  assert.equal(done.results['smoke-vocab-1'].provider, 'ollama');
  assert.equal(done.ollama?.loadSeconds !== undefined, true);
  const file = JSON.parse(readFileSync(preparedFile(dir, 'smoke-dialogue-1'), 'utf8'));
  assert.equal(file.provider, 'ollama');
  assert.equal(file.model, 'qwen3:8b');
});

test('OLLAMA_MODEL selects qwen3:4b; only loopback Ollama / Gemini mock hosts are accepted', () => {
  process.env.OLLAMA_MODEL = 'qwen3:4b';
  assert.equal(ollamaModel(), 'qwen3:4b');
  assert.equal(ollamaBaseUrl('127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.throws(() => ollamaBaseUrl('http://example.com:11434'), /loopback/);
  assert.throws(() => ollamaModel('qwen3:8b; rm -rf /'), /valid model/);
  assert.equal(interactionsUrl('http://127.0.0.1:8787/v1beta/interactions'), 'http://127.0.0.1:8787/v1beta/interactions');
  assert.throws(() => interactionsUrl('https://evil.example/v1beta/interactions'), /loopback/);
});

test('invalid Qwen output stops the batch: no file is written for the episode', async () => {
  const dir = tmp();
  const stateFile = join(dir, 'state.json');
  const bad = { ...dialogueRaw, lines: dialogueRaw.lines.map((l) => ({ ...l, ko: 'annyeong' })) };
  const state: BatchState = { date: 'test', episodes: [EPISODES[0]], results: {}, fallback: [{ id: EPISODES[0].id, reason: 'timeout', message: 'x' }] };
  writeFileSync(stateFile, JSON.stringify(state));
  const calls = ollamaMock(() => bad);
  await assert.rejects(prepareWithOllama({ dir, stateFile }), (err: unknown) => {
    assert.ok(err instanceof DialogueValidationError);
    assert.match(err.message, /Qwen \(qwen3:8b via Ollama\) did not produce a valid dialogue after 2 attempts/);
    return true;
  });
  assert.equal(calls.filter((c) => c.url.endsWith('/api/chat')).length, 2, 'one retry with the validation issues');
  assert.match(calls.filter((c) => c.url.endsWith('/api/chat'))[1].body.messages[0].content, /previous answer was rejected/);
  assert.equal(existsSync(preparedFile(dir, EPISODES[0].id)), false);
  assert.throws(() => checkPrepared(dir, state), PreparedScriptError);
});

test('prepared scripts: round trip, and clear errors for missing, broken, mismatched or invalid files', () => {
  const dir = tmp();
  const [d, v] = EPISODES;
  const file = writePreparedScript(dir, d, { provider: 'ollama', model: 'qwen3:8b' }, { topic: d.topic, ...dialogueRaw } as never);
  const ok = readPreparedScript(file, d);
  assert.equal(ok.meta.mode, 'dialogue');
  assert.equal(ok.script.topic, d.topic);

  assert.throws(() => readPreparedScript(join(dir, 'nope.json'), d), (e: unknown) => e instanceof PreparedScriptError && /smoke-dialogue-1 is missing/.test(e.message) && /retry/.test(e.hint ?? ''));
  writeFileSync(join(dir, 'broken.json'), '{');
  assert.throws(() => readPreparedScript(join(dir, 'broken.json'), d), /not valid JSON/);
  assert.throws(() => readPreparedScript(file, { ...v, id: d.id }), /belongs to mode dialogue \(expected vocab\), a different topic/);
  assert.throws(() => readPreparedScript(file, { ...d, id: 'other-episode' }), /belongs to episode smoke-dialogue-1/);
  const tampered = JSON.parse(readFileSync(file, 'utf8'));
  tampered.script.lines[0].ko = 'hello';
  writeFileSync(file, JSON.stringify(tampered));
  assert.throws(() => readPreparedScript(file, d), (e: unknown) => e instanceof PreparedScriptError && /failed validation/.test(e.message) && /Latin/.test(e.message));
  assert.throws(() => preparedFile(dir, '../escape'), PreparedScriptError);
});

/** Runs the real generate CLI (child Short entry point) without Gemini credentials. */
function runChild(args: string[]) {
  const env = { ...process.env, TTS_PROVIDER: 'edge', GEMINI_API_KEY: '', GITHUB_ACTIONS: '' };
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/generate.ts', ...args], { encoding: 'utf8', env, cwd: process.cwd() });
}

test('child prepared path: a missing or invalid file fails clearly before TTS (exit 2, no audio)', () => {
  const dir = tmp();
  const out = join(dir, 'job');
  const [d, v] = EPISODES;
  let r = runChild(['--mode', 'dialogue', '--topic', d.topic, '--prepared', join(dir, `${d.id}.json`), '--episode', d.id, '--out', out]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Prepared script for episode smoke-dialogue-1 is missing/);
  assert.equal(existsSync(join(out, 'audio')), false);

  const list = { topic: v.topic, ...vocabRaw };
  const file = writePreparedScript(dir, v, { provider: 'ollama', model: 'qwen3:8b' }, list as never);
  const broken = JSON.parse(readFileSync(file, 'utf8'));
  broken.script.words = broken.script.words.slice(0, 3);
  writeFileSync(file, JSON.stringify(broken));
  r = runChild(['--mode', 'vocab', '--topic', v.topic, '--prepared', file, '--episode', v.id, '--out', out]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Prepared script for episode smoke-vocab-1 failed validation/);
  assert.match(r.stderr, /expected 8 to 15 words, got 3/);
  assert.equal(existsSync(out), false, 'nothing is synthesized or rendered');
});

test('a prepared Edge TTS run blocks every Gemini request before it reaches the network', async () => {
  const calls = mockFetch(() => json(textInteraction('{}')));
  blockGeminiRequests('Prepared script + Edge TTS.');
  try {
    await assert.rejects(callInteraction({ model: 'gemini-3.6-flash' }, { apiKey: '' }), /request blocked\. Prepared script/);
    assert.equal(calls.length, 0);
  } finally {
    blockGeminiRequests(undefined);
  }
});

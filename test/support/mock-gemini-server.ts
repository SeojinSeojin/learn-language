// Loopback stand-in for the Gemini Interactions API, used by the Actions smoke test (no key, no network).
//   npx tsx test/support/mock-gemini-server.ts --port 8787 --mode outage|healthy|daily-quota --log out/smoke/gemini-requests.jsonl
// outage:  dialogue requests get HTTP 503 UNAVAILABLE every time; word-list requests never get an answer
//          (the client times out after 120 s, like the first attempt of run 45698283703).
// healthy: both get a valid structured answer from the fixed samples.
// daily-quota: the first request gets a valid answer; every later one gets the HTTP 429 that production run
//          45741747083 received when the free-tier requests-per-day limit was used up.
// Every request is logged as one JSON line (kind, model, whether a key header was present).
import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { SAMPLE_DIALOGUE } from '../../src/dialogue/sample';
import { SAMPLE_VOCAB } from '../../src/vocab/sample';
import { parseArgs } from '../../src/util/env';

const args = parseArgs();
const port = Number(args.port ?? 8787);
const mode = String(args.mode ?? 'outage');
const log = String(args.log ?? 'out/smoke/gemini-requests.jsonl');
if (!['outage', 'healthy', 'daily-quota'].includes(mode)) throw new Error(`--mode must be outage, healthy or daily-quota (got ${mode})`);
const PRODUCTION_DAILY_QUOTA_MESSAGE =
  'Rate limit exceeded for model gemini-3.6-flash (limit: 20 requests per day on Free Tier). Please retry in 5h39m1s or upgrade your tier at https://ai.dev/rate-limit.';
let requests = 0;
mkdirSync(dirname(log), { recursive: true });

const answers = {
  dialogue: { sceneId: SAMPLE_DIALOGUE.sceneId, lines: SAMPLE_DIALOGUE.lines, hashtags: ['park'] },
  vocab: { words: SAMPLE_VOCAB.words, hashtags: ['vocabulary'] },
};

createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(204).end(); // readiness probe, not logged
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let input = '';
    let model = '';
    try {
      const parsed = JSON.parse(body);
      input = typeof parsed.input === 'string' ? parsed.input : '';
      model = String(parsed.model ?? '');
    } catch {
      /* logged as unknown */
    }
    const kind = /bilingual dialogues/.test(input) ? 'dialogue' : /basic vocabulary/.test(input) ? 'vocab' : 'unknown';
    requests++;
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), mode, kind, model, keyHeader: Boolean(req.headers['x-goog-api-key']) }) + '\n');
    if (kind === 'unknown') {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 400, message: 'unknown request' } }));
    } else if (mode === 'daily-quota' && requests > 1) {
      res.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 429, message: PRODUCTION_DAILY_QUOTA_MESSAGE, status: 'RESOURCE_EXHAUSTED' } }));
    } else if (mode === 'healthy' || mode === 'daily-quota') {
      const text = JSON.stringify(answers[kind]);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] }));
    } else if (kind === 'dialogue') {
      res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }));
    }
    // outage + vocab: never respond; the client aborts at its timeout.
  });
}).listen(port, '127.0.0.1', () => console.log(`mock Gemini (${mode}) on http://127.0.0.1:${port}`));

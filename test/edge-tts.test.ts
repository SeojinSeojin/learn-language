import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWav } from '../src/audio/wav';
import {
  EDGE_VOICES,
  edgeCacheKey,
  parseVoiceList,
  resolveEdgeVoices,
  synthesizeEdgeLine,
  verifyEdgeVoices,
  type Runner,
} from '../src/tts/edge-tts';
import { UserFacingError } from '../src/util/errors';
import { ttsProvider } from '../src/util/env';

const LIST = `Name                              Gender    ContentCategories      VoicePersonalities
--------------------------------  --------  ---------------------  ------------------
es-MX-DaliaNeural                 Female    General                Friendly, Positive
es-MX-JorgeNeural                 Male      General                Friendly, Positive
ko-KR-InJoonNeural                Male      General                Friendly, Positive
ko-KR-SunHiNeural                 Female    General                Friendly, Positive
`;
const listRunner: Runner = async () => ({ code: 0, stdout: LIST, stderr: '' });

test('TTS_PROVIDER: edge by default, gemini selectable, anything else rejected', () => {
  assert.equal(ttsProvider(undefined), 'edge');
  assert.equal(ttsProvider('Gemini'), 'gemini');
  assert.throws(() => ttsProvider('azure'), UserFacingError);
});

test('edge voices: defaults and EDGE_TTS_VOICE_* overrides', () => {
  assert.deepEqual(resolveEdgeVoices(() => undefined), EDGE_VOICES);
  const v = resolveEdgeVoices((k) => (k === 'EDGE_TTS_VOICE_JISOO_KO' ? 'ko-KR-HyunsuMultilingualNeural' : undefined));
  assert.equal(v.jisoo.ko, 'ko-KR-HyunsuMultilingualNeural');
  assert.equal(v.lupita.es, 'es-MX-DaliaNeural');
});

test('voice list parsing and verification against it', async () => {
  assert.deepEqual(parseVoiceList(LIST), ['es-MX-DaliaNeural', 'es-MX-JorgeNeural', 'ko-KR-InJoonNeural', 'ko-KR-SunHiNeural']);
  await verifyEdgeVoices(EDGE_VOICES, listRunner);
  const missing = { ...EDGE_VOICES, jisoo: { es: 'es-MX-BeatrizNeural', ko: 'ko-KR-JiMinNeural' } };
  await assert.rejects(verifyEdgeVoices(missing, listRunner), (e: Error) => /BeatrizNeural.*not in Edge's voice list/.test(e.message) && /JiMinNeural/.test(e.message));
  const wrongLocale = { ...EDGE_VOICES, lupita: { es: 'ko-KR-SunHiNeural', ko: 'ko-KR-SunHiNeural' } };
  await assert.rejects(verifyEdgeVoices(wrongLocale, listRunner), /not a es-MX voice/);
  await assert.rejects(verifyEdgeVoices(EDGE_VOICES, async () => ({ code: 1, stdout: '', stderr: 'boom 403' })), /boom 403/);
});

test('cache key depends on provider, voice and exact text', () => {
  assert.equal(edgeCacheKey('es-MX-DaliaNeural', 'Hola'), edgeCacheKey('es-MX-DaliaNeural', 'Hola'));
  assert.notEqual(edgeCacheKey('es-MX-DaliaNeural', 'Hola'), edgeCacheKey('es-MX-DaliaNeural', 'Hola.'));
  assert.notEqual(edgeCacheKey('es-MX-DaliaNeural', 'Hola'), edgeCacheKey('es-MX-JorgeNeural', 'Hola'));
});

test('cached line is reused without calling the provider', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'edge-cache-'));
  process.env.TTS_CACHE_DIR = dir;
  try {
    mkdirSync(join(dir, 'edge'), { recursive: true });
    writeWav(join(dir, 'edge', `${edgeCacheKey('es-MX-DaliaNeural', 'Hola')}.wav`), { sampleRate: 24000, channels: 1, samples: new Float32Array(24000) });
    let calls = 0;
    const r = await synthesizeEdgeLine({ text: 'Hola', voice: 'es-MX-DaliaNeural', outPath: join(dir, 'out.wav') }, async () => {
      calls++;
      return { code: 1, stdout: '', stderr: '' };
    });
    assert.equal(calls, 0);
    assert.equal(r.cached, true);
    assert.equal(r.duration, 1);
  } finally {
    delete process.env.TTS_CACHE_DIR;
  }
});

test('provider failure: bounded retries, provider error reported, nothing cached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'edge-fail-'));
  process.env.TTS_CACHE_DIR = dir;
  try {
    let calls = 0;
    await assert.rejects(
      synthesizeEdgeLine({ text: 'Hola', voice: 'es-MX-DaliaNeural', outPath: join(dir, 'out.wav'), attempts: 2 }, async () => {
        calls++;
        return { code: 1, stdout: '', stderr: 'WSServerHandshakeError: 403, message=Invalid response status' };
      }),
      (e: Error) => e instanceof UserFacingError && /403/.test(e.message) && /es-MX-DaliaNeural/.test(e.message),
    );
    assert.equal(calls, 2);
    assert.equal(existsSync(join(dir, 'out.wav')), false);
    assert.deepEqual(readdirSync(join(dir, 'edge')), []);
  } finally {
    delete process.env.TTS_CACHE_DIR;
  }
});

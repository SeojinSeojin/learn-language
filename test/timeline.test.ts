import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { buildTimeline, FPS } from '../src/timeline/build';
import { synthTestSpeech } from '../src/tts/test-audio';
import { durationOf, encodeWav, parseWav, pcm16ToWav } from '../src/audio/wav';
import { SAMPLE_DIALOGUE, SAMPLE_DIALOGUE_PARK } from '../src/dialogue/sample';
import { SCENE_IDS, SCENES, isSceneId } from '../shared/scenes';
import { CharacterAnimator, overlayAt } from '../shared/animation';

const audioFor = (d = SAMPLE_DIALOGUE) => ({
  es: d.lines.map((l) => synthTestSpeech(l.esMX, 'es', l.speaker)),
  ko: d.lines.map((l) => synthTestSpeech(l.ko, 'ko', l.speaker)),
});

test('timeline uses measured WAV durations, Spanish first then Korean', () => {
  const audio = audioFor();
  const { timeline, master } = buildTimeline(SAMPLE_DIALOGUE, audio);
  assert.equal(timeline.lines.length, 12);
  assert.deepEqual(timeline.lines.map((l) => l.lang), [...Array(6).fill('es'), ...Array(6).fill('ko')]);
  timeline.lines.forEach((l, i) => {
    const clip = l.lang === 'es' ? audio.es[i % 6] : audio.ko[i % 6];
    assert.ok(Math.abs(l.end - l.start - durationOf(clip)) < 0.002, `line ${i} duration`);
    if (i > 0) assert.ok(l.start >= timeline.lines[i - 1].end, 'no overlap');
    assert.equal(l.speaker, SAMPLE_DIALOGUE.lines[i % 6].speaker, 'same character speaks the equivalent line');
    assert.equal(l.envelope.length, Math.ceil(durationOf(clip) * timeline.envelopeRate));
  });
  assert.ok(timeline.lines.slice(6).every((l) => l.pronunciation && /[가-힣]/.test(l.text)));
  assert.ok(timeline.lines.slice(0, 6).every((l) => l.pronunciation === undefined));
  assert.equal(timeline.frameCount, Math.round(timeline.duration * FPS));
  assert.ok(Math.abs(master.samples.length / master.sampleRate - timeline.duration) < 0.001);
  assert.equal(timeline.sceneId, 'cafe');
});

test('only the active speaker moves their mouth', () => {
  const { timeline } = buildTimeline(SAMPLE_DIALOGUE, audioFor());
  const lupita = new CharacterAnimator(timeline, 'lupita', 1);
  const jisoo = new CharacterAnimator(timeline, 'jisoo', -1);
  for (const l of timeline.lines) {
    let speakerMax = 0;
    for (let t = l.start; t < l.end; t += 1 / 30) {
      const [s, other] = l.speaker === 'lupita' ? [lupita, jisoo] : [jisoo, lupita];
      speakerMax = Math.max(speakerMax, s.mouthAt(t));
      assert.equal(other.mouthAt(t), 0);
    }
    assert.ok(speakerMax > 0.3, `mouth opens on line ${l.index}`);
  }
});

test('subtitle overlay shows the active line', () => {
  const { timeline } = buildTimeline(SAMPLE_DIALOGUE_PARK, audioFor(SAMPLE_DIALOGUE_PARK));
  for (const l of timeline.lines) assert.equal(overlayAt(timeline, (l.start + l.end) / 2).line?.index, l.index);
  assert.ok(overlayAt(timeline, 0.5).card?.kind === 'intro');
  assert.equal(timeline.sceneId, 'park');
});

test('WAV round trip and raw PCM wrapping', () => {
  const a = synthTestSpeech('hola', 'es', 'lupita');
  const b = parseWav(encodeWav(a));
  assert.equal(b.sampleRate, 24000);
  assert.equal(b.samples.length, a.samples.length);
  const raw = Buffer.alloc(4800);
  assert.equal(durationOf(parseWav(pcm16ToWav(raw, 24000))), 0.1);
});

test('scene registry: ids unique, every id has an implemented preset', () => {
  assert.equal(new Set(SCENE_IDS).size, SCENE_IDS.length);
  assert.deepEqual([...SCENE_IDS].sort(), ['cafe', 'home', 'office', 'park', 'school']);
  const index = readFileSync('web/scene/presets/index.ts', 'utf8');
  for (const s of SCENES) {
    assert.ok(s.description.length > 20);
    assert.ok(existsSync(`web/scene/presets/${s.id}.ts`), `${s.id} preset file`);
    assert.ok(!readFileSync(`web/scene/presets/${s.id}.ts`, 'utf8').includes('PLACEHOLDER'), `${s.id} implemented`);
    assert.match(index, new RegExp(`\\b${s.id}: \\w+Preset`));
    assert.ok(s.characters.lupita.x < s.characters.jisoo.x);
  }
  assert.equal(isSceneId('beach'), false);
});

test('workflow scene choices match the registry', () => {
  const yml = readFileSync('.github/workflows/short.yml', 'utf8');
  const block = yml.slice(yml.indexOf('scene:'), yml.indexOf('default: auto'));
  const opts = [...block.matchAll(/- (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(opts, ['auto', ...SCENE_IDS]);
});

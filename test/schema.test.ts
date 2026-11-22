import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIALOGUE_JSON_SCHEMA, DialogueValidationError, dialogueJsonSchema, validateDialogue } from '../src/dialogue/schema';
import { SAMPLE_DIALOGUE } from '../src/dialogue/sample';
import { SCENE_IDS } from '../shared/scenes';

const clone = () => structuredClone({ sceneId: SAMPLE_DIALOGUE.sceneId, lines: SAMPLE_DIALOGUE.lines });

function rejects(raw: unknown, re: RegExp, opts?: Parameters<typeof validateDialogue>[2]) {
  assert.throws(() => validateDialogue(raw, 't', opts), (err: unknown) => {
    assert.ok(err instanceof DialogueValidationError);
    assert.ok(err.issues.some((i) => re.test(i)), `issues: ${err.issues.join(' | ')}`);
    return true;
  });
}

test('accepts SAMPLE_DIALOGUE', () => {
  const d = validateDialogue(clone(), SAMPLE_DIALOGUE.topic);
  assert.equal(d.lines.length, 6);
  assert.equal(d.sceneId, 'cafe');
  assert.equal(d.topic, SAMPLE_DIALOGUE.topic);
});

test('trims strings and allows jisoo to speak first', () => {
  const raw = clone();
  raw.lines.forEach((l) => (l.speaker = l.speaker === 'lupita' ? 'jisoo' : 'lupita'));
  raw.lines[0].esMX = '  ' + raw.lines[0].esMX + '  ';
  const d = validateDialogue(raw, 't');
  assert.equal(d.lines[0].speaker, 'jisoo');
  assert.equal(d.lines[0].esMX, SAMPLE_DIALOGUE.lines[0].esMX);
});

test('rejects non-alternating speakers', () => {
  const raw = clone();
  raw.lines[1].speaker = 'lupita';
  rejects(raw, /alternate/);
});

test('rejects 5 lines', () => {
  const raw = clone();
  raw.lines.pop();
  rejects(raw, /exactly 6/);
});

test('rejects Hangul in esMX', () => {
  const raw = clone();
  raw.lines[2].esMX = 'Hola 안녕';
  rejects(raw, /esMX must not contain Hangul/);
});

test('rejects too-long ko and Latin in ko', () => {
  const raw = clone();
  raw.lines[0].ko = '가'.repeat(41);
  rejects(raw, /line 1 ko is 41 characters/);
  const raw2 = clone();
  raw2.lines[0].ko = '커피 coffee 주세요';
  rejects(raw2, /Latin/);
});

test('rejects Hangul in koPronunciation, bad gesture, unknown speaker, bad scene', () => {
  const raw = clone();
  raw.lines[0].koPronunciation = '안녕';
  rejects(raw, /koPronunciation must not contain Hangul/);
  rejects({ ...clone(), lines: clone().lines.map((l, i) => (i === 0 ? { ...l, gesture: 'dance' } : l)) }, /gesture/);
  rejects({ ...clone(), lines: clone().lines.map((l, i) => (i === 0 ? { ...l, speaker: 'A' } : l)) }, /speaker/);
  rejects({ ...clone(), sceneId: 'moon' }, /sceneId/);
  rejects(clone(), /sceneId must be "park"/, { requiredScene: 'park' });
});

test('JSON schema has scene enum from SCENE_IDS and 6 fixed items', () => {
  const s = DIALOGUE_JSON_SCHEMA;
  assert.deepEqual(s.properties.sceneId.enum, [...SCENE_IDS]);
  assert.equal(s.properties.lines.minItems, 6);
  assert.equal(s.properties.lines.maxItems, 6);
  assert.deepEqual(s.required, ['sceneId', 'lines']);
  assert.deepEqual(dialogueJsonSchema(['park']).properties.sceneId.enum, ['park']);
});

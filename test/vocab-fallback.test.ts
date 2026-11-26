// Qwen (Ollama) word-list repair, with a scripted text generator (no network, no model).
// Production run 45830722075: Qwen returned 12 entries with only 6 distinct Spanish/Korean pairs for
// "Everyday things at the park entrance, featuring la entrada." twice, and the episode failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VocabWord } from '../shared/types';
import type { TextGenerator } from '../src/text/provider';
import { generateVocab } from '../src/vocab/gemini';
import { VocabValidationError, VOCAB_MIN, vocabJsonSchema } from '../src/vocab/schema';

const TOPIC = 'Everyday things at the park entrance, featuring la entrada.';
const w = (esMX: string, ko: string, koPronunciation: string, en: string, wikiTitle = en, imageQuery = en): VocabWord =>
  ({ esMX, ko, koPronunciation, en, wikiTitle, imageQuery });

// The six distinct pairs, then the repeats in the production order (words 7–12).
const SIX = [
  w('la entrada', '입구', 'ip-kku', 'entrance', 'Entrance'),
  w('el toldo', '천막', 'cheon-mak', 'awning', 'Awning'),
  w('el camino', '길', 'gil', 'path', 'Path'),
  w('la señal', '표지판', 'pyo-ji-pan', 'sign', 'Sign'),
  w('la reja', '울타리', 'ul-ta-ri', 'fence', 'Fence'),
  w('la banca', '벤치', 'ben-chi', 'bench', 'Bench (furniture)'),
];
const PRODUCTION_12 = [...SIX, SIX[1], SIX[0], SIX[2], SIX[3], SIX[0], SIX[1]];
const REPLACEMENTS = [w('el bote de basura', '쓰레기통', 'sseu-re-gi-tong', 'trash can', 'Waste container'), w('el árbol', '나무', 'na-mu', 'tree', 'Tree')];

interface Call { prompt: string; schema: any }
function scripted(provider: 'ollama' | 'gemini', answers: unknown[]): TextGenerator & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    label: provider === 'ollama' ? 'Qwen (qwen3:8b via Ollama)' : 'Gemini',
    provider,
    model: provider === 'ollama' ? 'qwen3:8b' : 'gemini-test',
    calls,
    async generate(prompt, schema) {
      calls.push({ prompt, schema });
      const a = answers[calls.length - 1];
      if (a === undefined) throw new Error(`unexpected call ${calls.length}`);
      return typeof a === 'string' ? a : JSON.stringify(a);
    },
  };
}

test('production pattern: 12 entries with 6 unique pairs keep those 6 unchanged, and one follow-up asks only for the missing 2', async () => {
  const gen = scripted('ollama', [{ words: PRODUCTION_12, hashtags: ['parque', 'park'] }, { words: REPLACEMENTS }]);
  const list = await generateVocab(TOPIC, { generator: gen });

  assert.equal(gen.calls.length, 2);
  // First call: exactly VOCAB_MIN words, same fields and rules as the full list.
  assert.equal(VOCAB_MIN, 8);
  assert.match(gen.calls[0].prompt, /Exactly 8 different words/);
  assert.equal(gen.calls[0].schema.properties.words.minItems, 8);
  assert.equal(gen.calls[0].schema.properties.words.maxItems, 8);
  assert.deepEqual(gen.calls[0].schema.properties.words.items, vocabJsonSchema().properties.words.items);
  // Follow-up: exactly 2 new words, every accepted Spanish and Korean term excluded, a 2-item schema.
  const follow = gen.calls[1];
  assert.match(follow.prompt, /Exactly 2 NEW different words for the same topic/);
  assert.ok(follow.prompt.includes(`<topic>${TOPIC}</topic>`));
  for (const s of SIX) {
    assert.ok(follow.prompt.includes(`"${s.esMX}"`), `excludes ${s.esMX}`);
    assert.ok(follow.prompt.includes(`"${s.ko}"`), `excludes ${s.ko}`);
  }
  assert.equal(follow.schema.properties.words.minItems, 2);
  assert.equal(follow.schema.properties.words.maxItems, 2);
  assert.deepEqual(follow.schema.required, ['words']);
  assert.deepEqual(follow.schema.properties.words.items, vocabJsonSchema().properties.words.items);

  assert.equal(list.words.length, 8);
  assert.deepEqual(list.words.slice(0, 6), SIX, 'first 6 survive unchanged, in order');
  assert.deepEqual(list.words.slice(6), REPLACEMENTS);
  assert.deepEqual(list.hashtags, ['parque', 'park']);
  assert.equal(list.topic, TOPIC);
});

for (const [what, repeat] of [
  ['a Spanish term (different case and spacing)', w('La  Entrada', '정문', 'jeong-mun', 'main gate', 'Gate')],
  ['a Korean term', w('la puerta', '입구', 'ip-kku', 'door', 'Door')],
] as const) {
  test(`a follow-up that repeats ${what} cannot pass with fewer than 8 unique entries`, async () => {
    const gen = scripted('ollama', [{ words: PRODUCTION_12, hashtags: [] }, { words: [repeat, REPLACEMENTS[0]] }]);
    await assert.rejects(generateVocab(TOPIC, { generator: gen }), (err: unknown) => {
      assert.ok(err instanceof VocabValidationError);
      assert.match(err.message, new RegExp(`did not produce enough distinct words for "${TOPIC.replace(/[.]/g, '\\.')}"`));
      assert.deepEqual(err.issues, [
        'only 7 unique valid words, need at least 8',
        'call 1: 6 unique valid of 12 entries',
        'follow-up for 2: 1 unique valid of 2 entries',
        `follow-up entry 1 repeats ${repeat.esMX === 'la puerta' ? 'Korean "입구"' : 'Spanish "La  Entrada"'}`,
      ]);
      assert.match(err.hint ?? '', /re-running/, 'retryable');
      return true;
    });
    assert.equal(gen.calls.length, 2, 'only one follow-up');
  });
}

test('individually invalid entries are dropped in place; a partial list is kept for the follow-up', async () => {
  const bad = { ...SIX[2], ko: 'gil' }; // Latin letters in the Korean word
  const gen = scripted('ollama', [
    { words: [SIX[0], SIX[1], bad, SIX[3], { esMX: 'el kiosco' }, SIX[4], SIX[5], SIX[0]], hashtags: [] },
    { words: [SIX[2], ...REPLACEMENTS].slice(0, 3) },
  ]);
  const list = await generateVocab(TOPIC, { generator: gen });
  assert.match(gen.calls[1].prompt, /Exactly 3 NEW different words/);
  assert.ok(!gen.calls[1].prompt.includes('"el camino"'), 'the rejected entry is not an exclusion');
  assert.deepEqual(list.words.map((x) => x.esMX), ['la entrada', 'el toldo', 'la señal', 'la reja', 'la banca', 'el camino', 'el bote de basura', 'el árbol']);
});

test('a first answer that is not JSON still gets exactly one follow-up for all 8 words', async () => {
  const gen = scripted('ollama', ['not json', { words: [...SIX, ...REPLACEMENTS] }]);
  const list = await generateVocab(TOPIC, { generator: gen });
  assert.match(gen.calls[1].prompt, /Exactly 8 NEW/);
  assert.equal(list.words.length, 8);
  assert.deepEqual(list.hashtags, []);
});

test('Gemini word lists are unchanged: 12 requested, 8–15 schema, no partial repair', async () => {
  const gen = scripted('gemini', [{ words: PRODUCTION_12, hashtags: [] }, { words: PRODUCTION_12, hashtags: [] }]);
  await assert.rejects(generateVocab(TOPIC, { generator: gen }), /Gemini did not produce a valid word list after 2 attempts/);
  assert.match(gen.calls[0].prompt, /Exactly 12 different words/);
  assert.deepEqual(gen.calls[0].schema, vocabJsonSchema());
  assert.match(gen.calls[1].prompt, /previous answer was rejected/);
});

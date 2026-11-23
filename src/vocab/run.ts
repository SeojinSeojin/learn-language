// Vocabulary mode: topic → basic words (Gemini) → speech (×2 Spanish, ×2 Korean per word) → pictures
// (Wikimedia) → timeline → render. Started by `npm run generate -- --mode vocab --topic "..."`
// (alias `npm run vocab`) or, without credentials, `npm run sample:vocab`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VocabList } from '../../shared/types';
import { readWav, writeWav } from '../audio/wav';
import { log, openingMusicEnabled, renderAndVerify } from '../pipeline';
import { checkFfmpeg } from '../render/ffmpeg';
import { resolveEdgeVoices, verifyEdgeVoices } from '../tts/edge-tts';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_TTS_MODEL, optionalEnv, parseArgs, requireEnv, ttsProvider } from '../util/env';
import { UserFacingError } from '../util/errors';
import { buildVocabMetadata, formatMetadataForReview, parsePrivacy } from '../youtube/metadata';
import { generateVocab } from './gemini';
import { fetchVocabImages, writeSampleImages, type WordImage } from './images';
import { SAMPLE_VOCAB } from './sample';
import { validateVocab } from './schema';
import { fitWordCount, buildVocabTimeline, VOCAB_MAX_SECONDS, type VocabClips } from './timeline';
import { synthesizeVocabEdge, synthesizeVocabGemini, writeVocabTestAudio, type VocabAudioPaths } from './tts';

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v.trim() : '');

function slug(s: string) {
  return s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40) || 'words';
}

export async function runVocab(args: ReturnType<typeof parseArgs>) {
  const sample = args.sample !== undefined && args.sample !== false;
  const privacy = parsePrivacy(str(args.privacy) || 'private');
  const provider = sample ? undefined : ttsProvider();
  const imagesOff = /^(off|0|false|no)$/i.test(str(args.images));

  let list: VocabList;
  let jobDir: string;
  let audioPaths: VocabAudioPaths;

  if (sample) {
    // No API, no credentials, no network: fixed word list, local test audio, solid-color pictures.
    list = validateVocab(SAMPLE_VOCAB, SAMPLE_VOCAB.topic);
    jobDir = resolve(str(args.out) || 'out/sample-vocab');
    mkdirSync(jobDir, { recursive: true });
    checkFfmpeg();
    log(`SAMPLE MODE (no credentials): fixed "${list.topic}" word list, local test audio (not real speech), solid-color pictures`);
    writeFileSync(join(jobDir, 'script.json'), JSON.stringify(list, null, 2));
    audioPaths = writeVocabTestAudio(list.words, jobDir);
  } else {
    const topic = str(args.topic) || str(args._[0]);
    if (!topic) throw new UserFacingError('Missing --topic. Example: npm run vocab -- --topic "Fruits"', 'For the no-credentials demo, run: npm run sample:vocab');
    const apiKey = requireEnv('GEMINI_API_KEY', 'Create a free key at https://aistudio.google.com/apikey (or run `npm run sample:vocab` for the no-credentials demo).');
    checkFfmpeg();
    const model = optionalEnv('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;
    const ttsModel = optionalEnv('GEMINI_TTS_MODEL') ?? DEFAULT_GEMINI_TTS_MODEL;
    const edgeVoices = provider === 'edge' ? resolveEdgeVoices() : undefined;
    if (edgeVoices) {
      await verifyEdgeVoices(edgeVoices); // before spending any Gemini quota
      log(`TTS provider: edge (voices verified: ${Object.entries(edgeVoices).map(([s, v]) => `${s} ${v.es}/${v.ko}`).join(', ')})`);
    } else {
      log(`TTS provider: gemini (${ttsModel})`);
    }
    jobDir = resolve(str(args.out) || `out/vocab-${slug(topic)}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
    mkdirSync(jobDir, { recursive: true });

    const scriptPath = join(jobDir, 'script.json');
    const resume = args.resume === true && existsSync(scriptPath);
    if (resume) {
      list = validateVocab(JSON.parse(readFileSync(scriptPath, 'utf8')), topic);
      log(`Resuming with existing script.json (${list.words.length} words)`);
    } else {
      log(`Choosing basic words with ${model}`);
      list = await generateVocab(topic, { apiKey, model });
      writeFileSync(scriptPath, JSON.stringify(list, null, 2));
      log(`Word list OK → script.json (${list.words.length} words)`);
    }
    list.words.forEach((w, i) => log(`  ${i + 1}. ${w.esMX} | ${w.ko} (≈ ${w.koPronunciation}) | ${w.en}`));

    const clipCount = list.words.length * 4;
    if (edgeVoices) {
      log(`Synthesizing ${clipCount} clips with Edge TTS (cached per clip)`);
      audioPaths = await synthesizeVocabEdge(list.words, jobDir, { voices: edgeVoices });
    } else {
      log(`Synthesizing ${clipCount} clips with ${ttsModel} (4 requests)`);
      audioPaths = await synthesizeVocabGemini(list.words, jobDir, { apiKey, model: ttsModel, reuseExisting: resume });
    }
  }

  // Keep as many words as fit in a Short.
  let clips: VocabClips = audioPaths.map((p) => ({ es: p.es.map((f) => readWav(f)), ko: p.ko.map((f) => readWav(f)) }));
  const keep = fitWordCount(clips, VOCAB_MAX_SECONDS);
  if (keep < list.words.length) {
    log(`Keeping the first ${keep} of ${list.words.length} words so the video stays under ${VOCAB_MAX_SECONDS} s`);
    list = { ...list, words: list.words.slice(0, keep) };
    clips = clips.slice(0, keep);
  }

  let images: (WordImage | undefined)[];
  if (sample) images = await writeSampleImages(list.words, jobDir);
  else if (imagesOff) images = list.words.map(() => undefined);
  else {
    log(`Finding pictures on Wikimedia for ${list.words.length} words`);
    images = await fetchVocabImages(list.words, jobDir);
    const found = images.filter(Boolean).length;
    log(`Pictures: ${found}/${list.words.length} found${found < list.words.length ? ' (the rest use a text card)' : ''}`);
  }

  const { timeline, master } = buildVocabTimeline(list, clips, {
    music: openingMusicEnabled(),
    images: images.map((img, i) => (img ? { url: `images/word-${i + 1}.jpg`, credit: img.credit } : undefined)),
  });
  writeWav(join(jobDir, timeline.audio), master);
  writeFileSync(join(jobDir, 'timeline.json'), JSON.stringify(timeline, null, 1));
  log(`Timeline: ${timeline.duration.toFixed(2)} s, ${timeline.frameCount} frames, ${timeline.words.length} words`);

  const metadata = buildVocabMetadata(list, {
    title: str(args.title),
    description: str(args.description),
    privacyStatus: privacy,
    ttsProvider: provider,
    attributions: images.flatMap((img) => (img?.attribution ? [img.attribution] : [])),
  });
  writeFileSync(join(jobDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  const concurrency = args.concurrency ? Number(args.concurrency) : undefined;
  const renderer = str(args.renderer) === 'canvas' ? 'canvas' : str(args.renderer) === 'webgl' ? 'webgl' : undefined;
  const r = await renderAndVerify(jobDir, { concurrency, renderer, duration: timeline.duration });
  console.log('\n' + formatMetadataForReview(metadata));
  log(`Done: ${r.outFile}`);
}

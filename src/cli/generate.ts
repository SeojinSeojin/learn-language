// npm run generate -- --topic "Ordering iced coffee at a café" [--scene auto|cafe|park|...] [--out dir]
//                     [--privacy private|unlisted|public] [--title ...] [--description ...] [--resume]
// --resume (with --out of a failed run) reuses its script.json and finished WAVs instead of spending quota again.
// npm run sample                 (explicit no-credentials mode: fixed dialogue + local test audio)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Dialogue } from '../../shared/types';
import { isSceneId, SCENE_IDS, type SceneId } from '../../shared/scenes';
import { SAMPLES } from '../dialogue/sample';
import { validateDialogue } from '../dialogue/schema';
import { generateDialogue } from '../dialogue/gemini';
import { synthesizeDialogue } from '../tts/gemini-tts';
import { resolveEdgeVoices, synthesizeDialogueEdge, verifyEdgeVoices } from '../tts/edge-tts';
import { buildYouTubeMetadata, formatMetadataForReview, parsePrivacy } from '../youtube/metadata';
import { assertRenderableScene, log, renderAndVerify, writeTestAudio, writeTimeline } from '../pipeline';
import { checkFfmpeg } from '../render/ffmpeg';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_TTS_MODEL, optionalEnv, parseArgs, requireEnv, ttsProvider } from '../util/env';
import { runCli, UserFacingError } from '../util/errors';

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v.trim() : '');

function slug(s: string) {
  return s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40) || 'short';
}

runCli(async () => {
  const args = parseArgs();
  const sampleArg = args.sample;
  const sample = sampleArg !== undefined && sampleArg !== false;
  const privacy = parsePrivacy(str(args.privacy) || 'private');
  const sceneArg = str(args.scene) || 'auto';
  if (sceneArg !== 'auto' && !isSceneId(sceneArg)) {
    throw new UserFacingError(`--scene must be auto or one of: ${SCENE_IDS.join(', ')} (got "${sceneArg}")`);
  }
  const scene = sceneArg as SceneId | 'auto';
  const provider = sample ? undefined : ttsProvider();

  let dialogue: Dialogue;
  let jobDir: string;
  let audioPaths: { es: string[]; ko: string[] };

  if (sample) {
    // Explicit sample mode: never touches any API or credential.
    const key = typeof sampleArg === 'string' ? sampleArg : scene === 'auto' ? 'cafe' : scene;
    const base = SAMPLES[key];
    if (!base) throw new UserFacingError(`No fixed sample for "${key}". Available: ${Object.keys(SAMPLES).join(', ')}`);
    dialogue = validateDialogue(base, base.topic);
    jobDir = resolve(str(args.out) || `out/sample-${key}`);
    mkdirSync(jobDir, { recursive: true });
    log(`SAMPLE MODE (no credentials): fixed "${dialogue.topic}" dialogue in scene "${dialogue.sceneId}", local test audio (not real speech)`);
    writeFileSync(join(jobDir, 'script.json'), JSON.stringify(dialogue, null, 2));
    audioPaths = writeTestAudio(dialogue, jobDir);
  } else {
    const topic = str(args.topic) || str(args._[0]);
    if (!topic) throw new UserFacingError('Missing --topic. Example: npm run generate -- --topic "Ordering iced coffee at a café"', 'For the no-credentials demo, run: npm run sample');
    // Fail fast before spending any quota.
    const apiKey = requireEnv('GEMINI_API_KEY', 'Create a free key at https://aistudio.google.com/apikey (or run `npm run sample` for the no-credentials demo).');
    checkFfmpeg();
    const model = optionalEnv('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;
    const ttsModel = optionalEnv('GEMINI_TTS_MODEL') ?? DEFAULT_GEMINI_TTS_MODEL;
    const edgeVoices = provider === 'edge' ? resolveEdgeVoices() : undefined;
    if (edgeVoices) {
      // Check the voice ids against Edge's current list before spending any Gemini quota.
      await verifyEdgeVoices(edgeVoices);
      log(`TTS provider: edge (voices verified: ${Object.entries(edgeVoices).map(([s, v]) => `${s} ${v.es}/${v.ko}`).join(', ')})`);
    } else {
      log(`TTS provider: gemini (${ttsModel})`);
    }
    jobDir = resolve(str(args.out) || `out/${slug(topic)}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
    mkdirSync(jobDir, { recursive: true });

    const scriptPath = join(jobDir, 'script.json');
    const resume = args.resume === true && existsSync(scriptPath);
    if (resume) {
      // Resume after a rate-limit/quota stop: reuse the saved script and any finished WAVs.
      dialogue = validateDialogue(JSON.parse(readFileSync(scriptPath, 'utf8')), topic, scene === 'auto' ? {} : { requiredScene: scene });
      log(`Resuming with existing script.json (scene "${dialogue.sceneId}")`);
    } else {
      log(`Generating dialogue with ${model} (scene: ${scene})`);
      dialogue = await generateDialogue(topic, { apiKey, model, scene });
      writeFileSync(scriptPath, JSON.stringify(dialogue, null, 2));
      log(`Dialogue OK → script.json (scene "${dialogue.sceneId}")`);
    }
    dialogue.lines.forEach((l, i) => log(`  ${i + 1}. ${l.speaker}: ${l.esMX} | ${l.ko} | ≈ ${l.koPronunciation} [${l.gesture}]`));

    // Validate everything (incl. the scene) again right before speech synthesis.
    dialogue = validateDialogue(dialogue, topic, scene === 'auto' ? {} : { requiredScene: scene });
    assertRenderableScene(dialogue.sceneId);

    if (edgeVoices) {
      log('Synthesizing 12 lines with Edge TTS (sequential, cached per line)');
      audioPaths = await synthesizeDialogueEdge(dialogue, jobDir, { voices: edgeVoices, voicesVerified: true });
    } else {
      log(`Synthesizing 12 lines with ${ttsModel}`);
      audioPaths = await synthesizeDialogue(dialogue, jobDir, { apiKey, model: ttsModel, reuseExisting: resume });
    }
  }
  assertRenderableScene(dialogue.sceneId);

  const timeline = writeTimeline(dialogue, jobDir, audioPaths);
  log(`Timeline: ${timeline.duration.toFixed(2)} s, ${timeline.frameCount} frames, scene "${timeline.sceneId}"`);

  const metadata = buildYouTubeMetadata(dialogue, { title: str(args.title), description: str(args.description), privacyStatus: privacy, ttsProvider: provider });
  writeFileSync(join(jobDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  const concurrency = args.concurrency ? Number(args.concurrency) : undefined;
  const renderer = str(args.renderer) === 'canvas' ? 'canvas' : str(args.renderer) === 'webgl' ? 'webgl' : undefined;
  const r = await renderAndVerify(jobDir, { concurrency, renderer, duration: timeline.duration });

  console.log('\n' + formatMetadataForReview(metadata));
  log(`Done: ${r.outFile}`);
});

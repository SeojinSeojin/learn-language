// npm run tts:smoke -- [--out out/tts-smoke] [--es "text"] [--ko "text"] [--speaker lupita|jisoo]
// Uses TTS_PROVIDER (edge by default, or gemini). Writes one Spanish and one Korean WAV.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SPEAKERS, type Lang, type Speaker } from '../../shared/types';
import { durationOf } from '../audio/wav';
import { SAMPLE_DIALOGUE } from '../dialogue/sample';
import { synthesizeLineDetailed, resolveVoices } from '../tts/gemini-tts';
import { resolveEdgeVoices, synthesizeEdgeLine, verifyEdgeVoices } from '../tts/edge-tts';
import { readWav } from '../audio/wav';
import { checkFfmpeg } from '../render/ffmpeg';
import { DEFAULT_GEMINI_TTS_MODEL, optionalEnv, parseArgs, requireEnv, ttsProvider } from '../util/env';
import { UserFacingError, runCli } from '../util/errors';

runCli(async () => {
  const args = parseArgs();
  const provider = ttsProvider();
  const apiKey = provider === 'gemini' ? requireEnv('GEMINI_API_KEY', 'Get a free key at https://aistudio.google.com/apikey and put it in .env.') : '';
  const model = optionalEnv('GEMINI_TTS_MODEL') ?? DEFAULT_GEMINI_TTS_MODEL;
  const outDir = resolve(typeof args.out === 'string' ? args.out : 'out/tts-smoke');
  let speakerArg: Speaker | undefined;
  if (args.speaker !== undefined) {
    if (typeof args.speaker !== 'string' || !(SPEAKERS as readonly string[]).includes(args.speaker)) {
      throw new UserFacingError(`--speaker must be one of: ${SPEAKERS.join(', ')}`);
    }
    speakerArg = args.speaker as Speaker;
  }
  const texts: Record<Lang, string> = {
    es: typeof args.es === 'string' ? args.es : SAMPLE_DIALOGUE.lines[0].esMX,
    ko: typeof args.ko === 'string' ? args.ko : SAMPLE_DIALOGUE.lines[0].ko,
  };
  const defaultSpeaker: Record<Lang, Speaker> = { es: 'lupita', ko: 'jisoo' };
  mkdirSync(outDir, { recursive: true });

  if (provider === 'edge') {
    checkFfmpeg();
    const edgeVoices = resolveEdgeVoices();
    await verifyEdgeVoices(edgeVoices);
    console.log('Edge TTS smoke test — voices verified against the current Edge voice list');
    const written: string[] = [];
    for (const lang of ['es', 'ko'] as Lang[]) {
      const speaker = speakerArg ?? defaultSpeaker[lang];
      const voice = edgeVoices[speaker][lang];
      const path = join(outDir, `${lang}-smoke.wav`);
      // Never read the cache here: the smoke test must prove the provider works right now.
      const r = await synthesizeEdgeLine({ text: texts[lang], voice, outPath: path, readCache: false });
      const audio = readWav(path);
      if (r.duration < 0.3) throw new UserFacingError(`Edge TTS returned only ${r.duration.toFixed(2)} s of audio for ${lang}.`);
      written.push(path);
      console.log(`\n[${lang}] "${texts[lang]}"`);
      console.log(`  speaker:     ${speaker}`);
      console.log(`  voice:       ${voice}`);
      console.log(`  file:        ${path}`);
      console.log(`  duration:    ${r.duration.toFixed(2)} s`);
      console.log(`  sample rate: ${audio.sampleRate} Hz`);
    }
    console.log(`\nListen: on macOS run \`afplay "${written[0]}"\` and \`afplay "${written[1]}"\`.`);
    return;
  }

  const voices = resolveVoices();
  console.log(`Gemini TTS smoke test — model: ${model}`);
  const written: string[] = [];
  for (const lang of ['es', 'ko'] as Lang[]) {
    const speaker = speakerArg ?? defaultSpeaker[lang];
    const { wav, audio, voice } = await synthesizeLineDetailed({ text: texts[lang], lang, speaker, apiKey, model, voices });
    const path = join(outDir, `${lang}-smoke.wav`);
    writeFileSync(path, wav);
    written.push(path);
    console.log(`\n[${lang}] "${texts[lang]}"`);
    console.log(`  speaker:     ${speaker}`);
    console.log(`  voice:       ${voice}`);
    console.log(`  file:        ${path}`);
    console.log(`  duration:    ${durationOf(audio).toFixed(2)} s`);
    console.log(`  sample rate: ${audio.sampleRate} Hz`);
  }
  console.log(`\nListen: on macOS run \`afplay "${written[0]}"\` and \`afplay "${written[1]}"\`, or open the files in any audio player.`);
});

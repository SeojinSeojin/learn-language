// npm run frames -- out/sample   → extracts representative PNG frames from the MP4
// (intro, Spanish lines, language switch, Korean lines) into <job>/frames/ for inspection.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isVocabTimeline, type AnyTimeline } from '../../shared/types';
import { checkFfmpeg, runFfmpeg } from '../render/ffmpeg';
import { parseArgs } from '../util/env';
import { runCli, UserFacingError } from '../util/errors';

runCli(async () => {
  const args = parseArgs();
  const jobDir = resolve(args._[0] ?? 'out/sample');
  const mp4 = join(jobDir, 'short.mp4');
  if (!existsSync(mp4)) throw new UserFacingError(`${mp4} not found`);
  checkFfmpeg();
  const tl = JSON.parse(readFileSync(join(jobDir, 'timeline.json'), 'utf8')) as AnyTimeline;
  const outDir = join(jobDir, 'frames');
  mkdirSync(outDir, { recursive: true });
  const picks: [string, number][] = [];
  if (isVocabTimeline(tl)) {
    // Intro, then each word while its first Korean clip plays, then the outro.
    for (const c of tl.cards) picks.push([`${c.kind === 'intro' ? '00' : '99'}-${c.kind}`, (c.start + c.end) / 2]);
    for (const w of tl.words) {
      const ko = w.clips.find((c) => c.lang === 'ko')!;
      picks.push([`word-${String(w.index + 1).padStart(2, '0')}`, (ko.start + ko.end) / 2]);
    }
  } else {
    const intro = tl.cards.find((c) => c.kind === 'intro');
    const sw = tl.cards.find((c) => c.kind === 'switch');
    if (intro) picks.push(['00-intro', (intro.start + intro.end) / 2]);
    for (const l of tl.lines) {
      if ([1, 4, 6].includes(l.lineNo)) picks.push([`${l.lang}-line${l.lineNo}-${l.speaker}`, l.start + (l.end - l.start) * 0.55]);
    }
    if (sw) picks.push(['05-switch', (sw.start + sw.end) / 2]);
  }
  for (const [name, t] of picks) {
    const file = join(outDir, `${name}.png`);
    await runFfmpeg(['-y', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', mp4, '-frames:v', '1', file]);
    console.log(`${file}  (t=${t.toFixed(2)}s)`);
  }
});

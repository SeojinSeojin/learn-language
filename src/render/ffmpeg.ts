import { spawn, spawnSync } from 'node:child_process';
import { UserFacingError } from '../util/errors';
import { optionalEnv } from '../util/env';

export const ffmpegPath = () => optionalEnv('FFMPEG_PATH') ?? 'ffmpeg';
export const ffprobePath = () => optionalEnv('FFPROBE_PATH') ?? 'ffprobe';

export function checkFfmpeg() {
  for (const bin of [ffmpegPath(), ffprobePath()]) {
    const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new UserFacingError(
        `${bin} is not runnable (${(r.stderr || r.error?.message || 'not found').split('\n')[0].slice(0, 200)}).`,
        'Install FFmpeg (Ubuntu: sudo apt-get install -y ffmpeg; macOS: brew install ffmpeg, or `brew reinstall ffmpeg` if a library is missing), or set FFMPEG_PATH/FFPROBE_PATH.',
      );
    }
  }
}

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  pixFmt: string;
  audioCodec?: string;
  audioRate?: number;
  audioChannels?: number;
  duration: number;
  frames?: number;
}

export function probe(file: string): ProbeResult {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '-count_packets', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new UserFacingError(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  const a = j.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
  if (!v) throw new UserFacingError(`${file} has no video stream`);
  const [n, d] = String(v.r_frame_rate).split('/').map(Number);
  return {
    width: v.width,
    height: v.height,
    fps: d ? n / d : n,
    videoCodec: v.codec_name,
    pixFmt: v.pix_fmt,
    audioCodec: a?.codec_name,
    audioRate: a ? Number(a.sample_rate) : undefined,
    audioChannels: a?.channels,
    duration: Number(j.format.duration),
    frames: v.nb_read_packets ? Number(v.nb_read_packets) : undefined,
  };
}

export interface VerifyExpect {
  duration?: number;
}

/** Checks the delivery spec: 1080×1920, 30 fps, H.264 yuv420p, AAC audio, expected duration. */
export function verifyVideo(file: string, expect: VerifyExpect = {}): { probe: ProbeResult; checks: string[] } {
  const p = probe(file);
  const problems: string[] = [];
  const checks: string[] = [];
  const check = (ok: boolean, label: string) => (ok ? checks.push(`✔ ${label}`) : problems.push(`✖ ${label}`));
  check(p.width === 1080 && p.height === 1920, `dimensions ${p.width}×${p.height} (want 1080×1920)`);
  check(Math.abs(p.fps - 30) < 0.01, `frame rate ${p.fps} fps (want 30)`);
  check(p.videoCodec === 'h264', `video codec ${p.videoCodec} (want h264)`);
  check(p.pixFmt === 'yuv420p', `pixel format ${p.pixFmt} (want yuv420p)`);
  check(p.audioCodec === 'aac', `audio stream ${p.audioCodec ?? 'missing'} ${p.audioRate ?? ''} Hz ${p.audioChannels ?? ''}ch (want aac)`);
  check(p.duration > 5 && p.duration <= 180, `duration ${p.duration.toFixed(2)} s (Shorts ≤ 180 s)`);
  if (expect.duration !== undefined) {
    check(Math.abs(p.duration - expect.duration) < 0.15, `duration matches timeline ${expect.duration.toFixed(2)} s`);
  }
  if (p.frames !== undefined && expect.duration !== undefined) {
    check(Math.abs(p.frames - Math.round(expect.duration * 30)) <= 1, `video frames ${p.frames} (want ${Math.round(expect.duration * 30)})`);
  }
  if (problems.length) throw new UserFacingError(`Video verification failed for ${file}:\n  ${[...problems, ...checks].join('\n  ')}`);
  return { probe: p, checks };
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}: ${err}`))));
  });
}

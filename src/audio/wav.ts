// Minimal PCM WAV utilities (16-bit little-endian), no dependencies.
import { readFileSync, writeFileSync } from 'node:fs';

export interface PcmAudio {
  sampleRate: number;
  channels: number;
  /** Mono float samples in -1..1 (multi-channel input is downmixed). */
  samples: Float32Array;
}

export function parseWav(buf: Buffer): PcmAudio {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }
  let off = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    // Streaming encoders sometimes write 0 or 0xFFFFFFFF as the data size.
    if (id === 'data' && (size === 0 || size === 0xffffffff || body + size > buf.length)) size = buf.length - body;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV is missing fmt or data chunk');
  if (fmt.format !== 1 && fmt.format !== 0xfffe) throw new Error(`Unsupported WAV format ${fmt.format} (need PCM)`);
  if (fmt.bits !== 16) throw new Error(`Unsupported WAV bit depth ${fmt.bits} (need 16-bit)`);
  const frames = Math.floor(data.length / (2 * fmt.channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2);
    samples[i] = s / fmt.channels / 32768;
  }
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples };
}

export function readWav(path: string): PcmAudio {
  return parseWav(readFileSync(path));
}

/** Wraps raw signed 16-bit little-endian PCM in a WAV header. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function encodeWav(audio: PcmAudio): Buffer {
  const pcm = Buffer.alloc(audio.samples.length * 2);
  for (let i = 0; i < audio.samples.length; i++) {
    const s = Math.max(-1, Math.min(1, audio.samples[i]));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return pcm16ToWav(pcm, audio.sampleRate, 1);
}

export function writeWav(path: string, audio: PcmAudio) {
  writeFileSync(path, encodeWav(audio));
}

export function durationOf(audio: PcmAudio): number {
  return audio.samples.length / audio.sampleRate;
}

/** Linear-interpolation resampler (adequate for speech at 24 kHz ↔ 48 kHz). */
export function resample(audio: PcmAudio, rate: number): PcmAudio {
  if (audio.sampleRate === rate) return audio;
  const ratio = audio.sampleRate / rate;
  const n = Math.floor(audio.samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const a = audio.samples[j] ?? 0;
    const b = audio.samples[j + 1] ?? a;
    out[i] = a + (b - a) * (pos - j);
  }
  return { sampleRate: rate, channels: 1, samples: out };
}

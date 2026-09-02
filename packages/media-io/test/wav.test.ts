import { describe, expect, it } from 'vitest';
import { bytesSource } from '../src/source.js';
import { isWav, readWav, streamWavMono } from '../src/wav.js';
import { makeWav, noiseBurst } from './fixtures.js';

async function decodeMono(bytes: Uint8Array): Promise<Float64Array> {
  const src = bytesSource(bytes, 'fixture.wav');
  const wav = await readWav(src);
  const parts: Float64Array[] = [];
  await streamWavMono(src, wav, (block) => {
    parts.push(block);
  }, 997); // an awkward block size, to exercise the block boundaries
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('readWav', () => {
  it('reads format and duration', async () => {
    const bytes = makeWav({ sampleRate: 48000, channels: 2, frames: 24000 });
    const wav = await readWav(bytesSource(bytes));
    expect(wav.format.sampleRate).toBe(48000);
    expect(wav.format.channels).toBe(2);
    expect(wav.format.bitsPerSample).toBe(16);
    expect(wav.frameCount).toBe(24000);
    expect(wav.durationSeconds).toBeCloseTo(0.5, 6);
    expect(wav.rf64).toBe(false);
  });

  it('recognises a WAV without reading the samples', async () => {
    expect(await isWav(bytesSource(makeWav()))).toBe(true);
    expect(await isWav(bytesSource(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])))).toBe(
      false,
    );
  });

  it('reads RF64, where the 32-bit sizes are all -1', async () => {
    // The format a recorder switches to past 4 GB. A reader that trusts the
    // 32-bit field sees a file of length 0xFFFFFFFF and reads off the end.
    const bytes = makeWav({ rf64: true, frames: 8000, sampleRate: 48000 });
    const wav = await readWav(bytesSource(bytes));
    expect(wav.rf64).toBe(true);
    expect(wav.frameCount).toBe(8000);
    expect(wav.dataLength).toBe(16000);
  });

  it('rejects a file that is not RIFF/WAVE', async () => {
    const notWav = new Uint8Array(64);
    await expect(readWav(bytesSource(notWav, 'x.wav'))).rejects.toThrow(/not a RIFF/);
  });

  it('trusts the file length over a data size that overruns it', async () => {
    // What a card pulled mid-take actually looks like.
    const bytes = makeWav({ frames: 4000, sampleRate: 8000 });
    const truncated = bytes.subarray(0, bytes.length - 2000);
    const wav = await readWav(bytesSource(truncated));
    expect(wav.dataLength).toBeLessThanOrEqual(truncated.length - wav.dataOffset);
    const mono = await decodeMono(truncated);
    expect(mono.length).toBe(wav.frameCount);
  });
});

describe('streamWavMono', () => {
  it('round-trips a signal at every supported bit depth', async () => {
    const frames = 5000;
    const signal = noiseBurst(frames, 7);
    // 8-bit is excluded from the tight tolerance below: its quantisation step
    // is 1/128, so it gets its own looser assertion.
    for (const bits of [16, 24, 32]) {
      const mono = await decodeMono(makeWav({ bitsPerSample: bits, signals: [signal], frames }));
      expect(mono.length, `${bits}-bit length`).toBe(frames);
      let worst = 0;
      for (let i = 0; i < frames; i++) worst = Math.max(worst, Math.abs(mono[i] - signal[i]));
      expect(worst, `${bits}-bit error`).toBeLessThan(1 / 32000);
    }
  });

  it('round-trips float samples exactly enough to be lossless in practice', async () => {
    const frames = 3000;
    const signal = noiseBurst(frames, 11);
    for (const bits of [32, 64]) {
      const mono = await decodeMono(
        makeWav({ bitsPerSample: bits, isFloat: true, signals: [signal], frames }),
      );
      let worst = 0;
      for (let i = 0; i < frames; i++) worst = Math.max(worst, Math.abs(mono[i] - signal[i]));
      expect(worst, `float${bits}`).toBeLessThan(1e-7);
    }
  });

  it('handles 8-bit, which is unsigned and biased by 128 unlike every other depth', async () => {
    const frames = 2000;
    const signal = noiseBurst(frames, 3);
    const mono = await decodeMono(makeWav({ bitsPerSample: 8, signals: [signal], frames }));
    let worst = 0;
    for (let i = 0; i < frames; i++) worst = Math.max(worst, Math.abs(mono[i] - signal[i]));
    expect(worst).toBeLessThan(1 / 100);
  });

  it('averages channels rather than summing them', async () => {
    // Summing would make a stereo file twice the level of the same mono
    // material, which the RMS normalisation would then have to undo.
    const frames = 1000;
    const left = new Float64Array(frames).fill(0.5);
    const right = new Float64Array(frames).fill(-0.1);
    const mono = await decodeMono(makeWav({ channels: 2, signals: [left, right], frames }));
    expect(mono[500]).toBeCloseTo(0.2, 4);
  });

  it('decodes a poly-WAV: four channels, 24-bit, as a recorder writes it', async () => {
    const frames = 4000;
    const signals = [0, 1, 2, 3].map((c) => noiseBurst(frames, c + 1));
    const mono = await decodeMono(
      makeWav({ channels: 4, bitsPerSample: 24, signals, frames, sampleRate: 48000 }),
    );
    expect(mono.length).toBe(frames);
    let worst = 0;
    for (let i = 0; i < frames; i++) {
      const expected = (signals[0][i] + signals[1][i] + signals[2][i] + signals[3][i]) / 4;
      worst = Math.max(worst, Math.abs(mono[i] - expected));
    }
    expect(worst).toBeLessThan(1 / 32000);
  });

  it('reads WAVE_FORMAT_EXTENSIBLE, which multi-channel recorders write', async () => {
    // Hand-patch the format tag to 0xFFFE and extend fmt with a SubFormat GUID
    // whose first two bytes carry the real tag.
    const base = makeWav({ channels: 2, frames: 100 });
    const patched = new Uint8Array(base.length + 24);
    patched.set(base.subarray(0, 16), 0);
    const view = new DataView(patched.buffer);
    view.setUint32(16, 40, true); // fmt chunk size 16 -> 40
    patched.set(base.subarray(20, 36), 20); // the 16 fmt bytes
    view.setUint16(20, 0xfffe, true); // wFormatTag = EXTENSIBLE
    view.setUint16(36, 22, true); // cbSize
    view.setUint16(38, 16, true); // valid bits
    view.setUint32(40, 3, true); // channel mask
    view.setUint16(44, 1, true); // SubFormat GUID: PCM
    patched.set(base.subarray(36), 60); // data chunk onwards
    view.setUint32(4, patched.length - 8, true); // fix RIFF size

    const wav = await readWav(bytesSource(patched));
    expect(wav.format.channels).toBe(2);
    expect(wav.format.isFloat).toBe(false);
  });
});

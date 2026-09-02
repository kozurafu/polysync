import { describe, expect, it } from 'vitest';
import { decimate } from '@polysync/sync-core';
import { StreamingDecimator, chooseWorkingRate } from '../src/derive.js';

/** A signal with transients and tones — the structure decimation must preserve. */
function testSignal(n: number): Float64Array {
  const x = new Float64Array(n);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    x[i] = 0.4 * Math.sin((2 * Math.PI * 120 * i) / 48000) + 0.1 * rand();
    if (i % 7000 === 0) x[i] += 1.5; // transients: the thing correlation locks onto
  }
  return x;
}

function runStreaming(x: Float64Array, factor: number, blockSize: number): Float64Array {
  const dec = new StreamingDecimator(factor);
  const parts: Float64Array[] = [];
  for (let p = 0; p < x.length; p += blockSize) {
    parts.push(dec.push(x.subarray(p, Math.min(p + blockSize, x.length))));
  }
  parts.push(dec.flush());
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('StreamingDecimator', () => {
  it('matches whole-array decimate() exactly, whatever the block size', () => {
    const x = testSignal(50_000);
    for (const factor of [2, 3, 24]) {
      const reference = decimate(x, factor);
      for (const blockSize of [997, 4096, 50_000]) {
        const streamed = runStreaming(x, factor, blockSize);
        expect(streamed.length, `factor ${factor} block ${blockSize}`).toBe(reference.length);
        let worst = 0;
        for (let i = 0; i < reference.length; i++) {
          worst = Math.max(worst, Math.abs(streamed[i] - reference[i]));
        }
        // Same filter, same taps, same arithmetic — only float summation order
        // can differ, and it does not here.
        expect(worst, `factor ${factor} block ${blockSize}`).toBeLessThan(1e-12);
      }
    }
  });

  it('is a pass-through at factor 1', () => {
    const x = testSignal(1000);
    const out = runStreaming(x, 1, 128);
    expect(Array.from(out)).toEqual(Array.from(x));
  });

  it('reports the output length it will produce', () => {
    const dec = new StreamingDecimator(24);
    dec.push(new Float64Array(48_000));
    expect(dec.outputLength).toBe(2000);
  });

  it('holds only a bounded window regardless of how much is pushed', () => {
    const dec = new StreamingDecimator(24);
    const block = new Float64Array(100_000);
    for (let i = 0; i < 20; i++) dec.push(block);
    // 2 million samples in; the retained buffer must stay near the filter length.
    expect(dec.retainedSamples).toBeLessThan(2000);
  });
});

describe('chooseWorkingRate', () => {
  it('prefers 16 kHz — 62 µs resolution, a fraction of a frame', () => {
    expect(chooseWorkingRate(48000, 48000 * 600)).toBe(16000);
  });

  it('never upsamples a source that is already below the preference', () => {
    expect(chooseWorkingRate(8000, 8000 * 60)).toBe(8000);
  });

  it('decimates harder rather than blowing the memory budget on a long clip', () => {
    const fourHours = 48000 * 3600 * 4;
    const rate = chooseWorkingRate(48000, fourHours);
    expect(rate).toBeLessThan(16000);
    expect((fourHours / 48000) * rate).toBeLessThanOrEqual(120e6);
  });
});

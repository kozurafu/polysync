import { describe, expect, it } from 'vitest';
import { DEFAULT_DRIFT_OPTIONS, estimateDrift } from '../src/drift.js';
import type { AudioClip } from '../src/types.js';
import { asScratchAudio, makeSourceAudio, resample, slice } from './fixtures.js';

const SR = 16000;
const OPTS = { ...DEFAULT_DRIFT_OPTIONS, rate: SR, windows: 10, windowSeconds: 3 };

function clip(id: string, samples: Float64Array): AudioClip {
  return { id, samples, sampleRate: SR, name: id };
}

describe('estimateDrift', () => {
  const take = makeSourceAudio(150, SR, 314);

  it('reports no drift for two devices on the same clock', () => {
    const a = clip('a', slice(take, 0, 120, SR));
    const b = clip('b', asScratchAudio(slice(take, 5, 100, SR), SR));
    const d = estimateDrift(a, b, 5, OPTS);
    expect(Math.abs(d.ppm)).toBeLessThan(30);
  });

  it('recovers a known clock error and its sign', () => {
    // b's clock ran slow, so its material is stretched by 1000 ppm: matching
    // content sits progressively later inside b, and b must be sped up by
    // 1000 ppm to hold sync. Real hardware is 5-50 ppm; the estimator is
    // linear, so an exaggerated value proves the maths in a short fixture.
    const ppm = 1000;
    const stretched = resample(slice(take, 3, 110, SR), 1 + ppm / 1e6);
    const a = clip('a', slice(take, 0, 120, SR));
    const b = clip('b', asScratchAudio(stretched, SR));

    const d = estimateDrift(a, b, 3, OPTS);

    expect(d.r2).toBeGreaterThan(0.9);
    expect(d.ppm).toBeCloseTo(ppm, -2); // within ~50 ppm
    expect(d.ppm).toBeGreaterThan(0);
  });

  it('recovers a negative clock error', () => {
    const ppm = -800;
    const squeezed = resample(slice(take, 2, 110, SR), 1 + ppm / 1e6);
    const a = clip('a', slice(take, 0, 120, SR));
    const b = clip('b', asScratchAudio(squeezed, SR));

    const d = estimateDrift(a, b, 2, OPTS);

    expect(d.r2).toBeGreaterThan(0.9);
    expect(d.ppm).toBeLessThan(0);
    expect(d.ppm).toBeCloseTo(ppm, -2);
  });

  it('refuses to guess when there are too few usable windows', () => {
    const a = clip('a', slice(take, 0, 5, SR));
    const b = clip('b', slice(take, 0, 5, SR));
    const d = estimateDrift(a, b, 0, OPTS);
    expect(d.r2).toBe(0);
    expect(d.ppm).toBe(0);
  });
});

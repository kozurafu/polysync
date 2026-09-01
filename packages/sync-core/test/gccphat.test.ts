import { describe, expect, it } from 'vitest';
import { gccPhat, overlapCorrelation } from '../src/gccphat.js';
import { removeDc } from '../src/dsp.js';
import { makeSourceAudio, slice } from './fixtures.js';

const SR = 8000;

describe('gccPhat sign convention', () => {
  const source = makeSourceAudio(20, SR, 42);

  it('returns a positive offset when b starts later than a', () => {
    // a covers 0-10 s of the take, b covers 2-10 s. On a timeline anchored to
    // a's start, b begins at +2 s.
    const a = removeDc(slice(source, 0, 10, SR));
    const b = removeDc(slice(source, 2, 8, SR));
    const { offset } = gccPhat(a, b);
    expect(offset / SR).toBeCloseTo(2, 3);
  });

  it('returns a negative offset when b starts earlier than a', () => {
    const a = removeDc(slice(source, 5, 10, SR));
    const b = removeDc(slice(source, 1.5, 12, SR));
    const { offset } = gccPhat(a, b);
    expect(offset / SR).toBeCloseTo(-3.5, 3);
  });

  it('recovers a sub-sample offset by interpolation', () => {
    const a = removeDc(slice(source, 0, 8, SR));
    // Shift by a non-integer number of samples via fractional slicing.
    const shiftSamples = 100.5;
    const b = new Float64Array(a.length - 200);
    for (let i = 0; i < b.length; i++) {
      const pos = i + shiftSamples;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      b[i] = a[i0] * (1 - frac) + a[i0 + 1] * frac;
    }
    const { offset } = gccPhat(a, removeDc(b));
    expect(offset).toBeCloseTo(shiftSamples, 0);
  });

  it('reports a high peak-to-sidelobe ratio for a true match and a low one for noise', () => {
    const a = removeDc(slice(source, 0, 10, SR));
    const b = removeDc(slice(source, 3, 7, SR));
    const match = gccPhat(a, b);

    const unrelated = removeDc(makeSourceAudio(7, SR, 999));
    const noMatch = gccPhat(a, unrelated);

    expect(match.psr).toBeGreaterThan(20);
    expect(noMatch.psr).toBeLessThan(match.psr / 2);
  });
});

describe('overlapCorrelation', () => {
  it('is 1 for a signal against itself at zero offset', () => {
    const a = removeDc(makeSourceAudio(3, SR, 5));
    expect(overlapCorrelation(a, a, 0).r).toBeCloseTo(1, 6);
  });

  it('reports the true overlap length', () => {
    const a = new Float64Array(1000);
    const b = new Float64Array(1000);
    expect(overlapCorrelation(a, b, 400).overlapSamples).toBe(600);
  });
});

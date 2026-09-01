import { describe, expect, it } from 'vitest';
import { DEFAULT_ALIGN_OPTIONS, alignPair, prepareClip } from '../src/align.js';
import type { AudioClip } from '../src/types.js';
import { asScratchAudio, makeSourceAudio, slice } from './fixtures.js';

const SR = 16000;

// Keep the refinement cheap enough for CI; production defaults use the native
// rate and a longer segment.
const OPTS = { ...DEFAULT_ALIGN_OPTIONS, fineRate: SR, fineSegmentSeconds: 4 };

function clip(id: string, samples: Float64Array, trackId?: string): AudioClip {
  return { id, samples, sampleRate: SR, trackId, name: id };
}

describe('alignPair', () => {
  const take = makeSourceAudio(90, SR, 2024);

  it('syncs a clean recorder feed to a degraded camera scratch mic', () => {
    // Recorder rolls from 0, camera from 12.5 s. Camera audio is 26 dB down,
    // band-limited, reverberant and noisy — i.e. the case built-in NLE sync
    // tools are documented to fail on.
    const recorder = clip('recorder', slice(take, 0, 60, SR), 'REC');
    const camera = clip('camA', asScratchAudio(slice(take, 12.5, 40, SR), SR), 'CAM_A');

    const result = alignPair(prepareClip(recorder, OPTS), prepareClip(camera, OPTS), OPTS);

    expect(result.accepted).toBe(true);
    expect(result.offsetSeconds).toBeCloseTo(12.5, 2);
    expect(result.quality).toBeGreaterThan(0.5);
  });

  it('is accurate to within a millisecond', () => {
    const a = clip('a', slice(take, 0, 40, SR));
    const b = clip('b', asScratchAudio(slice(take, 7.321, 25, SR), SR));
    const result = alignPair(prepareClip(a, OPTS), prepareClip(b, OPTS), OPTS);
    expect(Math.abs(result.offsetSeconds - 7.321)).toBeLessThan(0.001);
  });

  it('handles a negative offset (the second clip rolled first)', () => {
    const a = clip('a', slice(take, 20, 30, SR));
    const b = clip('b', asScratchAudio(slice(take, 5, 40, SR), SR));
    const result = alignPair(prepareClip(a, OPTS), prepareClip(b, OPTS), OPTS);
    expect(result.accepted).toBe(true);
    expect(result.offsetSeconds).toBeCloseTo(-15, 2);
  });

  it('rejects two clips that share no content, rather than inventing an offset', () => {
    const a = clip('a', slice(take, 0, 30, SR));
    const other = makeSourceAudio(30, SR, 777);
    const b = clip('b', asScratchAudio(other, SR));
    const result = alignPair(prepareClip(a, OPTS), prepareClip(b, OPTS), OPTS);
    expect(result.accepted).toBe(false);
  });

  it('rejects a match whose overlap is too short to be trustworthy', () => {
    const a = clip('a', slice(take, 0, 30, SR));
    // Only ~1 s of shared material, below the 3 s minimum.
    const b = clip('b', asScratchAudio(slice(take, 29, 20, SR), SR));
    const result = alignPair(prepareClip(a, OPTS), prepareClip(b, OPTS), OPTS);
    expect(result.accepted).toBe(false);
  });

  it('uses embedded timecode as a seed when both clips carry it', () => {
    const a: AudioClip = { ...clip('a', slice(take, 0, 40, SR)), timecodeSeconds: 36000 };
    const b: AudioClip = {
      ...clip('b', asScratchAudio(slice(take, 9, 25, SR), SR)),
      timecodeSeconds: 36009,
    };
    const result = alignPair(prepareClip(a, OPTS), prepareClip(b, OPTS), OPTS);
    expect(result.accepted).toBe(true);
    expect(result.offsetSeconds).toBeCloseTo(9, 2);
  });
});

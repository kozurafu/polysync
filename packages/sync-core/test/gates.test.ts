import { describe, expect, it } from 'vitest';
import { DEFAULT_ALIGN_OPTIONS, prepareClip } from '../src/align.js';
import {
  DEFAULT_GATE_OPTIONS,
  couldOverlapInTime,
  maxEnvelopeCorrelation,
  screenPair,
} from '../src/gates.js';
import { overlapCorrelation } from '../src/gccphat.js';
import { DEFAULT_SYNC_OPTIONS, syncProject } from '../src/graph.js';
import type { AudioClip } from '../src/types.js';
import { asScratchAudio, makeSourceAudio, slice } from './fixtures.js';

const SR = 16000;

/** Matches graph.test.ts: the refinement pass is not what these tests exercise. */
const OPTS = {
  ...DEFAULT_SYNC_OPTIONS,
  fineRate: SR,
  fineSegmentSeconds: 4,
  detectDrift: false,
};

const UNGATED = { ...OPTS, gateByRecordingTime: false, envelopePrefilter: false };

function clip(id: string, samples: Float64Array, extra: Partial<AudioClip> = {}): AudioClip {
  return { id, samples, sampleRate: SR, name: id, ...extra };
}

function prep(c: AudioClip) {
  return prepareClip(c, { ...DEFAULT_ALIGN_OPTIONS, fineRate: SR });
}

/**
 * A clip of a given duration that costs nothing to prepare.
 *
 * The recording-time gate only reads `recordedAtSeconds` and `durationSeconds`,
 * never a sample, so these tests use a low sample rate to keep the decimation
 * in `prepareClip` from dominating the suite.
 */
function timedClip(id: string, seconds: number, recordedAtSeconds?: number) {
  const rate = 100;
  return prepareClip(
    { id, samples: new Float64Array(Math.round(seconds * rate)), sampleRate: rate, recordedAtSeconds },
    { ...DEFAULT_ALIGN_OPTIONS, fineRate: rate },
  );
}

describe('couldOverlapInTime', () => {
  const slop = DEFAULT_GATE_OPTIONS.recordingTimeSlopSeconds;

  it('fails open when either clip has no timestamp', () => {
    // A gate that guesses is worse than no gate: a wrongly excluded pair is a
    // lost sync the user cannot see, whereas a wasted alignment is only slow.
    const a = timedClip('a', 600, 1_000_000);
    const b = timedClip('b', 600);
    expect(couldOverlapInTime(a, b, slop)).toBe(true);
    expect(couldOverlapInTime(b, a, slop)).toBe(true);
  });

  it('fails open on a NaN timestamp', () => {
    const a = timedClip('a', 600, Number.NaN);
    const b = timedClip('b', 600, 1_000_000);
    expect(couldOverlapInTime(a, b, slop)).toBe(true);
  });

  it('keeps clips recorded minutes apart', () => {
    const a = timedClip('a', 600, 1_000_000);
    const b = timedClip('b', 600, 1_000_300);
    expect(couldOverlapInTime(a, b, slop)).toBe(true);
  });

  it('rules out the morning versus the afternoon', () => {
    // This is where the saving comes from on a real shoot day: most pairs are
    // simply hours apart and could never have shared a sound.
    const a = timedClip('a', 600, 1_000_000);
    const b = timedClip('b', 600, 1_000_000 + 6 * 3600);
    expect(couldOverlapInTime(a, b, slop)).toBe(false);
  });

  it('tolerates a timestamp meaning either the start or the end of the take', () => {
    // Some cameras stamp a file when they open it, some when they close it. A
    // ten-minute clip stamped at its end must still match one stamped at its
    // start ten minutes earlier, because they are the same ten minutes.
    const a = timedClip('a', 600, 1_000_000);
    const b = timedClip('b', 600, 1_000_600);
    expect(couldOverlapInTime(a, b, 0)).toBe(true);
  });

  it('does nothing when a bulk copy gave every file the same timestamp', () => {
    const a = timedClip('a', 600, 2_000_000);
    const b = timedClip('b', 600, 2_000_000);
    expect(couldOverlapInTime(a, b, slop)).toBe(true);
  });
});

describe('maxEnvelopeCorrelation', () => {
  const take = makeSourceAudio(60, SR, 4321);

  it('agrees with an exhaustive scan of overlapCorrelation', () => {
    // The prefilter's whole claim is that it computes an exact upper bound on
    // the quality this pair could ever be accepted with. If it drifts from the
    // metric the solver actually applies, the bound stops being a bound and the
    // gate starts silently losing syncs.
    const a = prep(clip('a', slice(take, 0, 25, SR)));
    const b = prep(clip('b', asScratchAudio(slice(take, 6, 25, SR), SR, 11)));

    const fast = maxEnvelopeCorrelation(a, b, DEFAULT_ALIGN_OPTIONS.minOverlapSeconds);

    const rate = a.envelopeRate;
    const minOverlap = Math.ceil(DEFAULT_ALIGN_OPTIONS.minOverlapSeconds * rate);
    let bruteBest = -Infinity;
    let bruteLag = 0;
    for (let lag = minOverlap - b.envelope.length; lag <= a.envelope.length - minOverlap; lag++) {
      const { r, overlapSamples } = overlapCorrelation(a.envelope, b.envelope, lag);
      if (overlapSamples < minOverlap) continue;
      if (r > bruteBest) {
        bruteBest = r;
        bruteLag = lag;
      }
    }

    expect(fast.r).toBeCloseTo(bruteBest, 5);
    expect(Math.round(fast.offsetSeconds * rate)).toBe(bruteLag);
  });

  it('is high for material sharing an event', () => {
    const a = prep(clip('a', slice(take, 0, 25, SR)));
    const related = prep(clip('b', asScratchAudio(slice(take, 5, 25, SR), SR, 3)));
    expect(maxEnvelopeCorrelation(a, related, DEFAULT_ALIGN_OPTIONS.minOverlapSeconds).r)
      .toBeGreaterThan(0.5);
  });

  it('is ALSO high for unrelated material — which is why it is a weak filter', () => {
    // Documenting a measured result, not an aspiration. The bound is a genuine
    // upper bound, but it is not selective: with a 3-second minimum overlap
    // there are tens of thousands of candidate lags, and among that many some
    // short window of any two speech-like recordings correlates well by chance.
    //
    // What actually separates a true match from a spurious one is the
    // peak-to-sidelobe ratio — unambiguity, not agreement — and PSR cannot be
    // bounded cheaply. Hence `envelopePrefilter` defaults to off.
    const a = prep(clip('a', makeSourceAudio(25, SR, 100)));
    const stranger = prep(clip('b', makeSourceAudio(25, SR, 987654)));
    const bound = maxEnvelopeCorrelation(a, stranger, DEFAULT_ALIGN_OPTIONS.minOverlapSeconds).r;
    expect(bound).toBeGreaterThan(DEFAULT_ALIGN_OPTIONS.minQuality);
  });

  it('does reject a clip with no usable content at all', () => {
    // The degenerate cases it still earns its keep on.
    const a = prep(clip('a', slice(take, 0, 25, SR)));
    const silent = prep(clip('b', new Float64Array(SR * 25)));
    expect(maxEnvelopeCorrelation(a, silent, DEFAULT_ALIGN_OPTIONS.minOverlapSeconds).r).toBe(0);
  });

  it('returns zero rather than throwing when a clip is shorter than the minimum overlap', () => {
    const a = prep(clip('a', slice(take, 0, 10, SR)));
    const tiny = prep(clip('b', slice(take, 0, 0.5, SR)));
    expect(maxEnvelopeCorrelation(a, tiny, 3).r).toBe(0);
  });
});

describe('screenPair', () => {
  const take = makeSourceAudio(60, SR, 555);
  const opts = {
    ...DEFAULT_GATE_OPTIONS,
    envelopePrefilter: true, // off by default; these tests are about it
    minQuality: DEFAULT_ALIGN_OPTIONS.minQuality,
    minOverlapSeconds: DEFAULT_ALIGN_OPTIONS.minOverlapSeconds,
  };

  it('passes a pair that shares an event', () => {
    const a = prep(clip('a', slice(take, 0, 25, SR)));
    const b = prep(clip('b', asScratchAudio(slice(take, 4, 25, SR), SR, 13)));
    expect(screenPair(a, b, opts).pass).toBe(true);
  });

  it('rejects a hopeless pair, and says which gate did it', () => {
    const a = prep(clip('a', makeSourceAudio(25, SR, 100)));
    const silent = prep(clip('b', new Float64Array(SR * 25)));
    const result = screenPair(a, silent, opts);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('envelope');
  });

  it('rejects on recording time before touching the audio at all', () => {
    const a = prep(clip('a', makeSourceAudio(25, SR, 1), { recordedAtSeconds: 1_000_000 }));
    const b = prep(clip('b', makeSourceAudio(25, SR, 2), { recordedAtSeconds: 1_050_000 }));
    const result = screenPair(a, b, opts);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('recording-time');
    expect(result.bound).toBeUndefined();
  });

  it('can be turned off entirely', () => {
    const a = prep(clip('a', makeSourceAudio(25, SR, 100)));
    const b = prep(clip('b', makeSourceAudio(25, SR, 200)));
    const off = { ...opts, gateByRecordingTime: false, envelopePrefilter: false };
    expect(screenPair(a, b, off).pass).toBe(true);
  });
});

describe('gates do not change the answer', () => {
  /**
   * Two scenes four hours apart, four devices each. Within a scene everything
   * overlaps; across scenes nothing can. That is the shape of a real shoot day
   * and the only shape in which the recording-time gate earns anything.
   */
  function shoot(): AudioClip[] {
    const clips: AudioClip[] = [];
    for (const scene of [0, 1]) {
      const take = makeSourceAudio(70, SR, 42 + scene);
      const base = 1_000_000 + scene * 4 * 3600;
      clips.push(
        clip('rec' + scene, slice(take, 0, 40, SR), {
          trackId: 'REC',
          recordedAtSeconds: base,
        }),
      );
      const cams: Array<[string, number, number]> = [
        ['A', 5, 21],
        ['B', 14, 22],
      ];
      for (const [name, offset, seed] of cams) {
        clips.push(
          clip(`cam${name}${scene}`, asScratchAudio(slice(take, offset, 30, SR), SR, seed + scene), {
            trackId: `CAM_${name}`,
            recordedAtSeconds: base + offset,
          }),
        );
      }
    }
    return clips;
  }

  it('produces identical placements with the gates on and off', () => {
    // The only property that really matters. Everything else about the gates is
    // an optimisation; this is the correctness claim.
    const clips = shoot();
    const gated = syncProject(clips, OPTS);
    const ungated = syncProject(clips, UNGATED);

    expect(gated.unsyncedClipIds.slice().sort()).toEqual(ungated.unsyncedClipIds.slice().sort());
    expect(gated.groupCount).toBe(ungated.groupCount);
    for (const placement of gated.placements) {
      const other = ungated.placements.find((p) => p.clipId === placement.clipId);
      expect(other, placement.clipId).toBeDefined();
      expect(placement.startSeconds, placement.clipId).toBeCloseTo(other!.startSeconds, 6);
      expect(placement.synced, placement.clipId).toBe(other!.synced);
    }
  }, 180_000);

  it('accepts exactly the same set of edges', () => {
    const clips = shoot();
    const acceptedEdges = (r: ReturnType<typeof syncProject>) =>
      r.pairs
        .filter((p) => p.accepted)
        .map((p) => `${p.aId}~${p.bId}`)
        .sort();

    expect(acceptedEdges(syncProject(clips, OPTS))).toEqual(
      acceptedEdges(syncProject(clips, UNGATED)),
    );
  }, 180_000);

  it('actually skips the cross-scene pairs', () => {
    const result = syncProject(shoot(), OPTS);
    expect(result.stats.totalPairs).toBe(15); // 6 clips

    // Three pairs are one device shot across both scenes (REC, CAM_A, CAM_B),
    // and the same-device rule claims those before recording time is consulted.
    expect(result.stats.skippedBySameDevice).toBe(3);
    // The other six cross-scene pairs are four hours apart.
    expect(result.stats.skippedByRecordingTime).toBe(6);
    expect(result.stats.aligned).toBe(6);
    expect(
      result.stats.aligned +
        result.stats.skippedBySameDevice +
        result.stats.skippedByRecordingTime +
        result.stats.skippedByEnvelope,
    ).toBe(result.stats.totalPairs);
  }, 180_000);

  it('exempts a clip whose clock is wrong rather than losing it', () => {
    // A camera set to the wrong timezone is hours from everything, so a naive
    // pairwise gate excludes every one of its pairs and the clip silently never
    // syncs — a confident answer with a clip missing and no reason given. The
    // matrix spots that the clip is isolated by its timestamp alone and steps
    // aside for it.
    const take = makeSourceAudio(70, SR, 77);
    const clips = [
      clip('rec', slice(take, 0, 40, SR), { trackId: 'REC', recordedAtSeconds: 1_000_000 }),
      clip('camA', asScratchAudio(slice(take, 5, 30, SR), SR, 31), {
        trackId: 'CAM_A',
        recordedAtSeconds: 1_000_005,
      }),
      // Same material, but its clock says three hours later.
      clip('camWrongClock', asScratchAudio(slice(take, 12, 30, SR), SR, 32), {
        trackId: 'CAM_B',
        recordedAtSeconds: 1_000_000 + 3 * 3600,
      }),
    ];

    const result = syncProject(clips, OPTS);
    expect(result.stats.skippedByRecordingTime).toBe(0);
    expect(result.unsyncedClipIds).toEqual([]);
    expect(result.placements.every((p) => p.synced)).toBe(true);
  }, 180_000);
});

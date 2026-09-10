import { describe, expect, it } from 'vitest';
import { DEFAULT_ALIGN_OPTIONS, prepareClip } from '../src/align.js';
import {
  DEFAULT_GATE_OPTIONS,
  couldOverlapInTime,
  maxEnvelopeCorrelation,
  recordingTimeMatrix,
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

/**
 * A clip. When a `recordedAtSeconds` is supplied it is stamped as coming from
 * the file's own metadata, because that is the only kind the gates act on — a
 * filesystem timestamp is deliberately inert, and the tests that care about
 * that say so explicitly.
 */
function clip(id: string, samples: Float64Array, extra: Partial<AudioClip> = {}): AudioClip {
  const source: Partial<AudioClip> =
    extra.recordedAtSeconds !== undefined && extra.recordedAtSource === undefined
      ? { recordedAtSource: 'metadata' }
      : {};
  return { id, samples, sampleRate: SR, name: id, ...extra, ...source };
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
function timedClip(
  id: string,
  seconds: number,
  recordedAtSeconds?: number,
  extra: Partial<AudioClip> = {},
) {
  const rate = 100;
  return prepareClip(
    {
      id,
      samples: new Float64Array(Math.round(seconds * rate)),
      sampleRate: rate,
      recordedAtSeconds,
      recordedAtSource: recordedAtSeconds === undefined ? undefined : 'metadata',
      ...extra,
    },
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

describe('a filesystem timestamp is not a recording time', () => {
  // Reported 2026-09-10, and the worst possible shape of failure: a real
  // project of 4 recorder files and 33 camera files, 666 pairs, 534 correctly
  // skipped as same-device — and all 132 remaining pairs ruled out on
  // recording time. Zero pairs compared. Nothing synced. Twenty-nine seconds
  // of solve that could not have produced an answer.
  //
  // The cause was `File.lastModified`. The recorder files had been through a
  // speech-isolation pass and carried that day's modification time; the camera
  // files had been copied off cards with 2021 timestamps intact. Five years
  // apart, so every cross-device pair failed the one-hour window. The audio
  // was perfectly syncable and never got looked at.
  const slop = DEFAULT_GATE_OPTIONS.recordingTimeSlopSeconds;

  it('never rules a pair out on a filesystem timestamp', () => {
    const a = timedClip('a', 10, 1_000_000, { recordedAtSource: 'filesystem' });
    const b = timedClip('b', 10, 1_000_000 + 5 * 365 * 24 * 3600, {
      recordedAtSource: 'filesystem',
    });
    expect(couldOverlapInTime(a, b, slop)).toBe(true);
  });

  it('does not act on a timestamp of unstated origin either', () => {
    const a = prepareClip(
      { id: 'a', samples: new Float64Array(1000), sampleRate: 100, recordedAtSeconds: 0 },
      { ...DEFAULT_ALIGN_OPTIONS, fineRate: 100 },
    );
    const b = prepareClip(
      { id: 'b', samples: new Float64Array(1000), sampleRate: 100, recordedAtSeconds: 9e8 },
      { ...DEFAULT_ALIGN_OPTIONS, fineRate: 100 },
    );
    expect(couldOverlapInTime(a, b, slop)).toBe(true);
  });

  it('still rules one out when both files stated the time themselves', () => {
    const a = timedClip('a', 10, 1_000_000);
    const b = timedClip('b', 10, 1_000_000 + 4 * 3600);
    expect(couldOverlapInTime(a, b, slop)).toBe(false);
  });

  it('reproduces the reported project: every cross-device pair survives', () => {
    const day = 1_600_000_000;
    const reprocessed = day + 5 * 365 * 24 * 3600;
    const clips = [
      ...[0, 1, 2, 3].map((i) =>
        timedClip(`mp3${i}`, 60, reprocessed + i * 60, {
          trackId: 'AUDIO',
          recordedAtSource: 'filesystem',
        }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        timedClip(`mp4${i}`, 30, day + i * 30, {
          trackId: 'VIDEO',
          recordedAtSource: 'filesystem',
        }),
      ),
    ];
    const allowed = recordingTimeMatrix(clips, slop);
    let cross = 0;
    for (let i = 0; i < clips.length; i++) {
      for (let j = i + 1; j < clips.length; j++) {
        if (clips[i].clip.trackId === clips[j].clip.trackId) continue;
        cross++;
        expect(allowed[i][j], `${clips[i].clip.id} vs ${clips[j].clip.id}`).toBe(true);
      }
    }
    expect(cross).toBe(32);
  });
});

describe('the wrong-clock rescue', () => {
  const slop = DEFAULT_GATE_OPTIONS.recordingTimeSlopSeconds;

  it('rescues a whole device whose clock is wrong, not just a lone clip', () => {
    // The second half of the same failure. The clip-level rescue asked whether
    // a clip was excluded from *every other clip*, and each recorder file was
    // still time-compatible with its three siblings — which it was never going
    // to be compared with anyway, being the same device. So no clip looked
    // isolated, the rescue never fired, and the device silently vanished.
    const day = 1_600_000_000;
    const clips = [
      ...[0, 1, 2, 3].map((i) =>
        timedClip(`rec${i}`, 60, day + 40 * 3600 + i * 60, { trackId: 'AUDIO' }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        timedClip(`cam${i}`, 30, day + i * 30, { trackId: 'VIDEO' }),
      ),
    ];
    const allowed = recordingTimeMatrix(clips, slop);
    for (let i = 0; i < 4; i++) {
      for (let j = 4; j < clips.length; j++) {
        expect(allowed[i][j], `${clips[i].clip.id} vs ${clips[j].clip.id}`).toBe(true);
      }
    }
  });

  it('still gates within a device that can reach the others', () => {
    // The rescue must not become a way of turning the gate off. Three cameras,
    // all clocks agreed: C1 overlaps C2, C3 is four hours later. C3 reaches
    // nobody and is rescued; the C1/C2 gating is untouched.
    const day = 1_600_000_000;
    const clips = [
      timedClip('c1', 30, day, { trackId: 'C1' }),
      timedClip('c2', 30, day + 10, { trackId: 'C2' }),
      timedClip('c3', 30, day + 4 * 3600, { trackId: 'C3' }),
    ];
    const allowed = recordingTimeMatrix(clips, slop);
    expect(allowed[0][1]).toBe(true);
    // c3 was isolated from everything, so it is exempt in both directions.
    expect(allowed[0][2]).toBe(true);
    expect(allowed[1][2]).toBe(true);
  });

  it('keeps ruling out pairs when every device can still reach another', () => {
    const day = 1_600_000_000;
    const clips = [
      timedClip('a1', 30, day, { trackId: 'A' }),
      timedClip('a2', 30, day + 8 * 3600, { trackId: 'A' }),
      timedClip('b1', 30, day + 10, { trackId: 'B' }),
      timedClip('b2', 30, day + 8 * 3600 + 10, { trackId: 'B' }),
    ];
    const allowed = recordingTimeMatrix(clips, slop);
    expect(allowed[0][2]).toBe(true); // morning vs morning
    expect(allowed[1][3]).toBe(true); // afternoon vs afternoon
    expect(allowed[0][3]).toBe(false); // eight hours apart, and correctly cut
    expect(allowed[1][2]).toBe(false);
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

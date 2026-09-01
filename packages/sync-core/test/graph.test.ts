import { describe, expect, it } from 'vitest';
import { DEFAULT_SYNC_OPTIONS, syncProject } from '../src/graph.js';
import type { AudioClip } from '../src/types.js';
import { asScratchAudio, makeSourceAudio, slice } from './fixtures.js';

const SR = 16000;
const OPTS = {
  ...DEFAULT_SYNC_OPTIONS,
  fineRate: SR,
  fineSegmentSeconds: 4,
  detectDrift: false,
};

function clip(id: string, samples: Float64Array, trackId: string): AudioClip {
  return { id, samples, sampleRate: SR, trackId, name: id };
}

/** Relative positions, normalised so the first clip sits at zero. */
function relative(result: ReturnType<typeof syncProject>, ids: string[]): number[] {
  const byId = new Map(result.placements.map((p) => [p.clipId, p.startSeconds]));
  const base = byId.get(ids[0])!;
  return ids.map((id) => byId.get(id)! - base);
}

describe('syncProject', () => {
  const take = makeSourceAudio(140, SR, 1234);

  it('solves a three-camera plus recorder shoot', () => {
    // Ground truth: recorder rolls at 0, cameras at 8, 21.4 and 33 s.
    const clips: AudioClip[] = [
      clip('rec', slice(take, 0, 110, SR), 'REC'),
      clip('camA', asScratchAudio(slice(take, 8, 70, SR), SR), 'CAM_A'),
      clip('camB', asScratchAudio(slice(take, 21.4, 80, SR), SR), 'CAM_B'),
      clip('camC', asScratchAudio(slice(take, 33, 60, SR), SR), 'CAM_C'),
    ];

    const result = syncProject(clips, OPTS);

    expect(result.unsyncedClipIds).toEqual([]);
    expect(result.groupCount).toBe(1);

    const [rec, a, b, c] = relative(result, ['rec', 'camA', 'camB', 'camC']);
    expect(rec).toBe(0);
    expect(a).toBeCloseTo(8, 1);
    expect(b).toBeCloseTo(21.4, 1);
    expect(c).toBeCloseTo(33, 1);
  });

  it('syncs transitively when a camera never overlaps the recorder', () => {
    // camC shares no material with the recorder at all; it only overlaps camB.
    // A pairwise tool would leave it unsynced. The spanning forest carries it.
    const clips: AudioClip[] = [
      clip('rec', slice(take, 0, 45, SR), 'REC'),
      clip('camB', asScratchAudio(slice(take, 20, 60, SR), SR), 'CAM_B'),
      clip('camC', asScratchAudio(slice(take, 60, 50, SR), SR), 'CAM_C'),
    ];

    const result = syncProject(clips, OPTS);

    expect(result.unsyncedClipIds).toEqual([]);
    const [, b, c] = relative(result, ['rec', 'camB', 'camC']);
    expect(b).toBeCloseTo(20, 1);
    expect(c).toBeCloseTo(60, 1);
  });

  it('flags material from a different shoot as unsynced instead of forcing it in', () => {
    const otherShoot = makeSourceAudio(60, SR, 88888);
    const clips: AudioClip[] = [
      clip('rec', slice(take, 0, 70, SR), 'REC'),
      clip('camA', asScratchAudio(slice(take, 6, 50, SR), SR), 'CAM_A'),
      clip('orphan', asScratchAudio(otherShoot, SR), 'CAM_X'),
    ];

    const result = syncProject(clips, OPTS);

    expect(result.unsyncedClipIds).toEqual(['orphan']);
    expect(result.groupCount).toBe(2);

    // The synced group starts at zero; the orphan is parked after it, which is
    // where an editor expects to find material that did not sync.
    const byId = new Map(result.placements.map((p) => [p.clipId, p]));
    expect(byId.get('rec')!.startSeconds).toBeCloseTo(0, 3);
    expect(byId.get('orphan')!.startSeconds).toBeGreaterThan(70);
    expect(byId.get('orphan')!.synced).toBe(false);
    expect(byId.get('camA')!.synced).toBe(true);
  });

  it('produces a self-consistent timeline (redundant matches agree)', () => {
    const clips: AudioClip[] = [
      clip('rec', slice(take, 0, 100, SR), 'REC'),
      clip('camA', asScratchAudio(slice(take, 10, 80, SR), SR), 'CAM_A'),
      clip('camB', asScratchAudio(slice(take, 25, 70, SR), SR), 'CAM_B'),
    ];
    const result = syncProject(clips, OPTS);
    expect(result.inconsistencies).toEqual([]);
  });

  it('reports progress monotonically from 0 to 1', () => {
    const seen: number[] = [];
    syncProject(
      [
        clip('rec', slice(take, 0, 20, SR), 'REC'),
        clip('camA', asScratchAudio(slice(take, 4, 15, SR), SR), 'CAM_A'),
      ],
      { ...OPTS, onProgress: (f) => seen.push(f) },
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('returns an empty result for an empty project', () => {
    const result = syncProject([], OPTS);
    expect(result.placements).toEqual([]);
    expect(result.groupCount).toBe(0);
  });
});

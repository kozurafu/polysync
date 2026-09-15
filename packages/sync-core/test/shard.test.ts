import { describe, expect, it } from 'vitest';
import { DEFAULT_SYNC_OPTIONS, alignShard, syncProject } from '../src/graph.js';
import type { AudioClip, PairAlignment } from '../src/types.js';
import { asScratchAudio, makeSourceAudio, slice } from './fixtures.js';

const SR = 16000;
const OPTS = { ...DEFAULT_SYNC_OPTIONS, fineRate: SR, fineSegmentSeconds: 4, detectDrift: false };

function clip(id: string, samples: Float64Array, trackId: string): AudioClip {
  return { id, samples, sampleRate: SR, trackId, name: id };
}

/** Run the same project through N shards and feed the result back in. */
function sharded(clips: AudioClip[], shardCount: number) {
  const precomputed = new Map<string, PairAlignment>();
  for (let shard = 0; shard < shardCount; shard++) {
    for (const { i, j, pair } of alignShard(clips, OPTS, shard, shardCount)) {
      precomputed.set(`${i}:${j}`, pair);
    }
  }
  return { result: syncProject(clips, { ...OPTS, precomputedPairs: precomputed }), precomputed };
}

describe('sharded alignment', () => {
  const take = makeSourceAudio(70, SR, 4242);
  const clips: AudioClip[] = [
    clip('rec', slice(take, 0, 55, SR), 'REC'),
    clip('camA1', asScratchAudio(slice(take, 4, 20, SR), SR), 'CAM_A'),
    clip('camA2', asScratchAudio(slice(take, 30, 20, SR), SR), 'CAM_A'),
    clip('camB', asScratchAudio(slice(take, 10.7, 30, SR), SR), 'CAM_B'),
    clip('camC', asScratchAudio(slice(take, 16.5, 25, SR), SR), 'CAM_C'),
  ];

  const single = syncProject(clips, OPTS);

  // The promise this whole change rests on: spreading the work across cores
  // must not change the answer. Different machines have different core counts,
  // so if shard count altered the result, the same project would sync
  // differently on different computers — which is worse than being slow.
  for (const shardCount of [1, 2, 3, 8]) {
    it(`gives byte-identical placements across ${shardCount} shard(s)`, () => {
      const { result } = sharded(clips, shardCount);
      expect(result.placements).toEqual(single.placements);
      expect(result.unsyncedClipIds).toEqual(single.unsyncedClipIds);
      expect(result.groupCount).toBe(single.groupCount);
      expect(result.stats.aligned).toBe(single.stats.aligned);
    });
  }

  it('covers every pair exactly once, whatever the shard count', () => {
    // A pair claimed by two shards is wasted work; a pair claimed by none is a
    // lost match. Both are silent, so both get asserted.
    for (const shardCount of [1, 3, 8]) {
      const seen = new Map<string, number>();
      for (let shard = 0; shard < shardCount; shard++) {
        for (const { i, j } of alignShard(clips, OPTS, shard, shardCount)) {
          seen.set(`${i}:${j}`, (seen.get(`${i}:${j}`) ?? 0) + 1);
        }
      }
      expect(seen.size, `${shardCount} shards`).toBe(single.stats.aligned);
      expect([...seen.values()].every((n) => n === 1), `${shardCount} shards`).toBe(true);
    }
  });

  it('skips the same pairs the gates skip, so shards never align a dead pair', () => {
    // camA1 and camA2 are one device, so the pair must never reach a shard.
    const all = alignShard(clips, OPTS, 0, 1);
    const ids = all.map(({ i, j }) => [clips[i].id, clips[j].id].sort().join('~'));
    expect(ids).not.toContain('camA1~camA2');
  });

  it('still solves when a shard produced nothing at all', () => {
    // A worker that dies must cost time, not correctness: the solve aligns
    // anything it was not handed.
    const partial = new Map<string, PairAlignment>();
    for (const { i, j, pair } of alignShard(clips, OPTS, 0, 4)) {
      partial.set(`${i}:${j}`, pair);
    }
    const result = syncProject(clips, { ...OPTS, precomputedPairs: partial });
    expect(result.placements).toEqual(single.placements);
  });

  it('ignores an empty precomputed map entirely', () => {
    const result = syncProject(clips, { ...OPTS, precomputedPairs: new Map() });
    expect(result.placements).toEqual(single.placements);
  });
});

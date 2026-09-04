/**
 * Regressions found by real users on real rushes.
 *
 * Each test here started as a bug report. Synthetic fixtures model the
 * degradations we thought of; these model the ones we did not.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SYNC_OPTIONS, syncProject } from '../src/graph.js';
import type { AudioClip } from '../src/types.js';
import { asScratchAudio, makeSourceAudio, slice } from './fixtures.js';

const SR = 16000;
const OPTS = { ...DEFAULT_SYNC_OPTIONS, fineRate: SR, fineSegmentSeconds: 4, detectDrift: false };

/**
 * Reported 4 September 2026: 70 clips from a single camera, dropped as one
 * folder. The tool placed 66 of them on top of each other between 80 s and
 * 140 s — 1,618 overlapping pairs out of 2,415 — and the exported XML was
 * unusable.
 *
 * The clips were sequential takes from one camera at one event: same room,
 * same ambience, mostly under ten seconds. They correlated with each other
 * beautifully and the placement was nonsense, because **a camera records one
 * clip at a time**. Two clips from the same device cannot overlap in time, no
 * matter how similar they sound. Nothing in the engine knew that.
 */
describe('one camera, sequential takes (reported 2026-09-04)', () => {
  /** Ten short takes from one camera, all of the same room, none overlapping. */
  function oneCameraDay(): AudioClip[] {
    const room = makeSourceAudio(200, SR, 4242);
    const clips: AudioClip[] = [];
    for (let i = 0; i < 10; i++) {
      // Each take is a different, non-overlapping stretch of the same event.
      const start = i * 18;
      clips.push({
        id: `C2_49${28 + i}`,
        name: `C2_49${28 + i}.MP4`,
        trackId: 'CAM',
        samples: asScratchAudio(slice(room, start, 8, SR), SR, 7),
        sampleRate: SR,
      });
    }
    return clips;
  }

  it('never places two clips from the same device on top of each other', () => {
    const clips = oneCameraDay();
    const result = syncProject(clips, OPTS);

    const spans = result.placements.map((p) => {
      const clip = clips.find((c) => c.id === p.clipId)!;
      return {
        id: p.clipId,
        from: p.startSeconds,
        to: p.startSeconds + clip.samples.length / clip.sampleRate,
      };
    });

    const overlapping: string[] = [];
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        // A tolerance of a millisecond: touching is fine, overlapping is not.
        if (spans[i].from < spans[j].to - 0.001 && spans[j].from < spans[i].to - 0.001) {
          overlapping.push(`${spans[i].id}~${spans[j].id}`);
        }
      }
    }
    expect(overlapping, `overlapping same-device pairs: ${overlapping.join(', ')}`).toEqual([]);
  }, 180_000);

  it('reports them as unsynced rather than inventing a sync', () => {
    // With only one device there is nothing to sync against, and saying so is
    // the honest answer. Placing them confidently is the failure mode this
    // whole project exists to avoid.
    const result = syncProject(oneCameraDay(), OPTS);
    expect(result.unsyncedClipIds).toHaveLength(10);
  }, 180_000);

  it('lays them out in the order they were given', () => {
    const clips = oneCameraDay();
    const result = syncProject(clips, OPTS);
    const order = [...result.placements].sort((a, b) => a.startSeconds - b.startSeconds);
    expect(order.map((p) => p.clipId)).toEqual(clips.map((c) => c.id));
  }, 180_000);
});

describe('two devices still sync when one of them has several takes', () => {
  it('places each camera clip against the recorder, not against its siblings', () => {
    // The same-device rule must not break the normal case: a recorder rolling
    // long, and a camera starting and stopping around it.
    const take = makeSourceAudio(140, SR, 99);
    const clips: AudioClip[] = [
      { id: 'rec', name: 'MIX.WAV', trackId: 'REC', samples: slice(take, 0, 120, SR), sampleRate: SR },
      {
        id: 'camA1',
        name: 'A001.MP4',
        trackId: 'CAM_A',
        samples: asScratchAudio(slice(take, 10, 30, SR), SR, 21),
        sampleRate: SR,
      },
      {
        id: 'camA2',
        name: 'A002.MP4',
        trackId: 'CAM_A',
        samples: asScratchAudio(slice(take, 60, 30, SR), SR, 22),
        sampleRate: SR,
      },
    ];

    const result = syncProject(clips, OPTS);
    expect(result.unsyncedClipIds).toEqual([]);

    const at = (id: string) => result.placements.find((p) => p.clipId === id)!.startSeconds;
    const origin = at('rec');
    expect(at('camA1') - origin).toBeCloseTo(10, 1);
    expect(at('camA2') - origin).toBeCloseTo(60, 1);
  }, 180_000);
});

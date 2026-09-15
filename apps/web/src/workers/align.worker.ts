/// <reference lib="webworker" />
/**
 * Align one shard of the project's pairs.
 *
 * Pair alignment is the dominant cost of a solve — 8,862 pairs at about 330 ms
 * each on one real project — and pairs are independent of one another, so this
 * is the part worth spreading across cores.
 *
 * Every shard walks the same pair order and applies the same gates, then aligns
 * only the pairs whose ordinal belongs to it. That is what lets the results be
 * independent of how many shards there were, and so of how many cores the
 * visitor's machine has. See `shard.test.ts`.
 *
 * Audio arrives here as a *copy*, not a transfer — the main thread still needs
 * it for the other shards and for the solve. That copy is the whole reason
 * `planAlignPool` exists: on a large project the copies are what would kill the
 * tab, so the pool is sized against real memory or not used at all.
 */

import { alignShard, type AudioClip } from '@polysync/sync-core';

export interface AlignRequest {
  clips: Array<{
    id: string;
    name: string;
    trackId: string;
    samples: ArrayBuffer;
    sampleRate: number;
    timecodeSeconds?: number;
    recordedAtSeconds?: number;
    recordedAtSource?: 'metadata' | 'filesystem';
    frameRate?: number;
  }>;
  shardIndex: number;
  shardCount: number;
}

export type AlignResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; alignments: Array<{ i: number; j: number; pair: unknown }> }
  | { type: 'error'; message: string };

const post = (message: AlignResponse) => {
  (self as unknown as Worker).postMessage(message);
};

self.onmessage = (event: MessageEvent<AlignRequest>) => {
  try {
    const clips: AudioClip[] = event.data.clips.map((c) => ({
      id: c.id,
      name: c.name,
      trackId: c.trackId,
      samples: new Float64Array(c.samples),
      sampleRate: c.sampleRate,
      timecodeSeconds: c.timecodeSeconds,
      recordedAtSeconds: c.recordedAtSeconds,
      recordedAtSource: c.recordedAtSource,
      frameRate: c.frameRate,
    }));

    let lastPosted = -1;
    const alignments = alignShard(
      clips,
      {
        onProgress: (fraction) => {
          // One message per half-percent: the solve reports far more often than
          // a progress bar can use, and every message is a structured clone.
          const step = Math.floor(fraction * 200);
          if (step === lastPosted) return;
          lastPosted = step;
          post({ type: 'progress', fraction });
        },
      },
      event.data.shardIndex,
      event.data.shardCount,
    );

    post({ type: 'done', alignments });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

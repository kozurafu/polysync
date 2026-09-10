/// <reference lib="webworker" />
/**
 * Run the whole-project solve off the main thread.
 *
 * Not an optimisation — a requirement. The solve takes tens of seconds to
 * minutes, and on the main thread the tab stops painting and the browser offers
 * to kill it. The user sees a crash, not a computation.
 *
 * The solve itself is still single-threaded. Sharding pair alignment across
 * workers is the next big lever (see `docs/08-build-plan.md` §7.2), but it needs
 * either the full-rate audio duplicated into every worker or the refinement pass
 * deferred, and neither is a change to make casually.
 */

import { syncProject, type AudioClip, type SyncResult } from '@polysync/sync-core';

export interface SyncRequest {
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
}

export type SyncResponse =
  | { type: 'progress'; fraction: number; label: string }
  | { type: 'done'; result: SyncResult }
  | { type: 'error'; message: string };

const post = (message: SyncResponse) => {
  (self as unknown as Worker).postMessage(message);
};

self.onmessage = (event: MessageEvent<SyncRequest>) => {
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
    const result = syncProject(clips, {
      onProgress: (fraction, label) => {
        // The solve reports far more often than a UI can usefully paint, and
        // every message is a structured clone.
        const step = Math.floor(fraction * 200);
        if (step !== lastPosted) {
          lastPosted = step;
          post({ type: 'progress', fraction, label });
        }
      },
    });

    post({ type: 'done', result });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * The app's whole relationship with the workers.
 *
 * Two rules hold this together, and both exist to keep the main thread free:
 *
 *   1. **Audio never touches the main thread.** Ingest workers hand their
 *      decoded buffers straight on to the sync worker by transfer, so the UI
 *      holds only metadata and a 1.6 kB peak summary per clip. A shoot day of
 *      rushes would otherwise be hundreds of megabytes sitting in React state.
 *   2. **Nothing expensive runs where the page paints.** Decode is parallel
 *      across a pool; the solve runs in its own worker. On the main thread a
 *      minute-long solve looks exactly like a crashed tab.
 */

import type { ProbeResult } from '@polysync/media-io';
import type { SyncResult } from '@polysync/sync-core';
import type { IngestRequest, IngestResponse } from '../workers/ingest.worker.ts';
import type { SyncRequest, SyncResponse } from '../workers/sync.worker.ts';

export interface PickedFile {
  file: File;
  /** Path relative to the folder that was dropped, e.g. `CAM_A/CLIPS/A001.MOV`. */
  relativePath: string;
}

export interface IngestedClip {
  id: string;
  name: string;
  relativePath: string;
  probe: ProbeResult;
  sampleRate: number;
  durationSeconds: number;
  peaks: Float32Array;
  timecodeSeconds?: number;
  recordedAtSeconds?: number;
  frameRate?: number;
  /** Held only until it is handed to the sync worker, then released. */
  samples?: ArrayBuffer;
}

export interface IngestFailure {
  relativePath: string;
  message: string;
}

export interface IngestProgress {
  /** 0..1 across the whole batch. */
  fraction: number;
  done: number;
  total: number;
  /** What is being decoded right now, for the status line. */
  current?: string;
}

/**
 * Decode every file, `hardwareConcurrency - 1` at a time.
 *
 * One less than the core count on purpose: the main thread still has to paint
 * progress, and a pool that saturates every core makes the UI stutter in exactly
 * the way this architecture exists to avoid.
 */
export function poolSize(fileCount: number): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(cores - 1, 8, fileCount));
}

export async function ingestFiles(
  files: PickedFile[],
  options: {
    onProgress?: (progress: IngestProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ clips: IngestedClip[]; failures: IngestFailure[] }> {
  const clips: IngestedClip[] = [];
  const failures: IngestFailure[] = [];
  if (files.length === 0) return { clips, failures };

  const size = poolSize(files.length);
  const workers = Array.from({ length: size }, createIngestWorker);
  const perFile = new Map<string, number>();
  let nextIndex = 0;
  let completed = 0;

  const report = (current?: string) => {
    let partial = 0;
    for (const f of perFile.values()) partial += f;
    options.onProgress?.({
      fraction: files.length ? Math.min(1, partial / files.length) : 1,
      done: completed,
      total: files.length,
      current,
    });
  };

  try {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve, reject) => {
            const next = () => {
              if (options.signal?.aborted) return resolve();
              if (nextIndex >= files.length) return resolve();
              const index = nextIndex++;
              const picked = files[index];
              const id = picked.relativePath;
              perFile.set(id, 0);
              report(picked.file.name);
              const request: IngestRequest = {
                id,
                file: picked.file,
                relativePath: picked.relativePath,
              };
              worker.postMessage(request);
            };

            worker.onmessage = (event: MessageEvent<IngestResponse>) => {
              const message = event.data;
              if (message.type === 'progress') {
                perFile.set(message.id, message.fraction);
                report();
                return;
              }

              perFile.set(message.id, 1);
              completed++;

              if (message.type === 'error') {
                failures.push({ relativePath: message.id, message: message.message });
              } else {
                clips.push({
                  id: message.id,
                  name: message.probe.name,
                  relativePath: message.id,
                  probe: message.probe,
                  sampleRate: message.sampleRate,
                  durationSeconds: message.probe.durationSeconds,
                  peaks: message.peaks,
                  timecodeSeconds: message.timecodeSeconds,
                  recordedAtSeconds: message.recordedAtSeconds,
                  frameRate: message.frameRate,
                  samples: message.samples,
                });
              }
              report();
              next();
            };

            worker.onerror = (event) => reject(new Error(event.message || 'ingest worker failed'));
            next();
          }),
      ),
    );
  } finally {
    for (const worker of workers) worker.terminate();
  }

  // Stable order, so the UI does not reshuffle as workers finish out of order.
  clips.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  failures.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { clips, failures };
}

/**
 * Solve the project.
 *
 * Takes ownership of every clip's `samples`: the buffers are transferred into
 * the worker and detached here, and `samples` is cleared to say so. Re-syncing
 * therefore needs a re-ingest, which is the honest trade for not holding a
 * second copy of the audio on the main thread.
 */
export function solve(
  clips: IngestedClip[],
  deviceOf: (clipId: string) => string,
  options: {
    onProgress?: (fraction: number, label: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<SyncResult> {
  return new Promise((resolve, reject) => {
    const worker = createSyncWorker();
    const transfer: Transferable[] = [];

    const payload: SyncRequest = {
      clips: clips.map((clip) => {
        const samples = clip.samples;
        if (!samples) throw new Error(`${clip.name}: audio was already handed to a solve`);
        transfer.push(samples);
        return {
          id: clip.id,
          name: clip.name,
          trackId: deviceOf(clip.id),
          samples,
          sampleRate: clip.sampleRate,
          timecodeSeconds: clip.timecodeSeconds,
          recordedAtSeconds: clip.recordedAtSeconds,
          frameRate: clip.frameRate,
        };
      }),
    };

    const cleanup = () => worker.terminate();

    options.signal?.addEventListener('abort', () => {
      cleanup();
      reject(new Error('Sync cancelled'));
    });

    worker.onmessage = (event: MessageEvent<SyncResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        options.onProgress?.(message.fraction, message.label);
        return;
      }
      cleanup();
      if (message.type === 'error') reject(new Error(message.message));
      else resolve(message.result);
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'sync worker failed'));
    };

    worker.postMessage(payload, transfer);
    for (const clip of clips) clip.samples = undefined; // detached; say so
  });
}

function createIngestWorker(): Worker {
  return new Worker(new URL('../workers/ingest.worker.ts', import.meta.url), { type: 'module' });
}

function createSyncWorker(): Worker {
  return new Worker(new URL('../workers/sync.worker.ts', import.meta.url), { type: 'module' });
}

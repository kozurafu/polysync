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
import { planAlignPool, projectAudioBytes, type PoolBudget } from './alignPool.ts';
import type { IngestRequest, IngestResponse } from '../workers/ingest.worker.ts';
import type { SyncRequest, SyncResponse } from '../workers/sync.worker.ts';
import type { AlignResponse } from '../workers/align.worker.ts';

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
  recordedAtSource?: 'metadata' | 'filesystem';
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
                  recordedAtSource: message.recordedAtSource,
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
export async function solve(
  clips: IngestedClip[],
  deviceOf: (clipId: string) => string,
  options: {
    onProgress?: (fraction: number, label: string) => void;
    signal?: AbortSignal;
    /** Records how the pool was sized, for the diagnostic report. */
    onPoolPlan?: (plan: PoolBudget) => void;
    /**
     * Seconds spent in the align pool, separately from the rest of the solve.
     *
     * Reported because the two are the whole story of a slow solve: alignment
     * is the part that scales with cores, everything after it does not, and
     * without the split a disappointing total is unattributable.
     */
    onAlignSeconds?: (seconds: number) => void;
  } = {},
): Promise<SyncResult> {
  // Spread pair alignment across cores when the machine can hold the copies.
  // `planAlignPool` returns 1 whenever it cannot, and 1 means the code below
  // runs exactly as it did before any of this existed — which is the point:
  // a weak machine or an oversized project behaves as it always has rather
  // than slightly differently.
  const plan = planAlignPool({
    audioBytes: projectAudioBytes(clips),
    cores: navigator.hardwareConcurrency || 1,
    deviceMemoryGb: (navigator as { deviceMemory?: number }).deviceMemory,
    pairsToAlign: (clips.length * (clips.length - 1)) / 2,
    override: workerOverride(),
  });
  options.onPoolPlan?.(plan);

  const startedAlign = performance.now();
  const precomputed =
    plan.size > 1 ? await runAlignPool(clips, deviceOf, plan.size, options) : [];
  if (plan.size > 1) options.onAlignSeconds?.((performance.now() - startedAlign) / 1000);

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
          recordedAtSource: clip.recordedAtSource,
          frameRate: clip.frameRate,
        };
      }),
      precomputed,
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

/**
 * Run the pair alignment across a pool of workers.
 *
 * Each worker gets a *copy* of the audio — the main thread still needs its own
 * for the solve that follows — which is why `planAlignPool` sized this against
 * real memory before we got here. The copies are released as soon as each
 * worker finishes, so the peak is brief.
 *
 * A worker that fails is not fatal. Anything it did not return is aligned by
 * the solve itself, so a dead shard costs time and never correctness.
 */
/** `?workers=N` on the URL, for checking a result against another core count. */
function workerOverride(): number | undefined {
  try {
    const raw = new URLSearchParams(location.search).get('workers');
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

async function runAlignPool(
  clips: IngestedClip[],
  deviceOf: (clipId: string) => string,
  shardCount: number,
  options: { onProgress?: (fraction: number, label: string) => void; signal?: AbortSignal },
): Promise<Array<{ i: number; j: number; pair: unknown }>> {
  const payloadClips = clips.map((clip) => {
    const samples = clip.samples;
    if (!samples) throw new Error(`${clip.name}: audio was already handed to a solve`);
    return {
      id: clip.id,
      name: clip.name,
      trackId: deviceOf(clip.id),
      samples,
      sampleRate: clip.sampleRate,
      timecodeSeconds: clip.timecodeSeconds,
      recordedAtSeconds: clip.recordedAtSeconds,
      recordedAtSource: clip.recordedAtSource,
      frameRate: clip.frameRate,
    };
  });

  const workers: Worker[] = [];
  const progress = new Array<number>(shardCount).fill(0);
  const stopAll = () => {
    for (const worker of workers) worker.terminate();
  };

  try {
    const shards = await Promise.all(
      Array.from({ length: shardCount }, (_, shardIndex) => {
        return new Promise<Array<{ i: number; j: number; pair: unknown }>>((resolveShard) => {
          const worker = createAlignWorker();
          workers.push(worker);

          worker.onmessage = (event: MessageEvent<AlignResponse>) => {
            const message = event.data;
            if (message.type === 'progress') {
              progress[shardIndex] = message.fraction;
              const mean = progress.reduce((t, f) => t + f, 0) / shardCount;
              // Alignment is the bulk of the solve, so it owns most of the bar.
              options.onProgress?.(0.05 + 0.75 * mean, 'Matching clips');
              return;
            }
            worker.terminate();
            // A failed shard resolves empty: the solve aligns what it is not
            // given, so the answer is the same and only the time is lost.
            resolveShard(message.type === 'done' ? message.alignments : []);
          };
          worker.onerror = () => {
            worker.terminate();
            resolveShard([]);
          };

          // Copied, not transferred — every shard needs the whole project.
          worker.postMessage({ clips: payloadClips, shardIndex, shardCount });
        });
      }),
    );
    return shards.flat();
  } finally {
    stopAll();
  }
}

function createAlignWorker(): Worker {
  return new Worker(new URL('../workers/align.worker.ts', import.meta.url), { type: 'module' });
}

function createIngestWorker(): Worker {
  return new Worker(new URL('../workers/ingest.worker.ts', import.meta.url), { type: 'module' });
}

function createSyncWorker(): Worker {
  return new Worker(new URL('../workers/sync.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * How many workers may share the pair-alignment work.
 *
 * Pair alignment is the dominant cost of a solve and pairs are independent, so
 * it is the obvious thing to spread across cores. The catch is memory. The main
 * thread *transfers* audio into the sync worker rather than copying it, so
 * exactly one copy of the project exists today — which is how a 7.5-hour
 * project fits in a tab at all. Handing the same audio to several workers means
 * cloning it, and clones are not free:
 *
 *     241 clips, 7.5 hours at the 16 kHz working rate = 3.4 GB per copy
 *
 * Eight of those is 27 GB against a tab ceiling nearer 2–4 GB. The naive pool
 * does not make a big project slow, it kills the tab — so the pool size is
 * derived from the project's actual size and the device's actual memory, and a
 * project that will not fit simply runs the way it does today.
 *
 * Two deliberate properties:
 *
 *   - **One is the floor, and one means "don't".** A size of 1 tells the caller
 *     to use the existing single-worker path untouched, not to run a pool of
 *     one. Weak machines and huge projects therefore behave exactly as before
 *     rather than slightly differently.
 *   - **Results do not depend on the size.** Shards agree on the gates and each
 *     aligns a disjoint slice, so a four-core laptop and a sixteen-core desktop
 *     produce the same timeline. See `shard.test.ts`.
 */

/** Bytes of audio the project will ask each worker to hold. */
export function projectAudioBytes(clips: Array<{ samples?: ArrayBuffer }>): number {
  let total = 0;
  for (const clip of clips) total += clip.samples?.byteLength ?? 0;
  return total;
}

export interface PoolBudget {
  /** Workers to align with. 1 means "use the single-worker path". */
  size: number;
  /** Why, in words — shown in the diagnostic report. */
  reason: string;
  /**
   * True when a person asked for this count rather than the budget deciding it.
   *
   * The difference matters to the UI: "your machine could not manage more" is
   * worth telling someone, and "you pressed the button that does this" is not.
   */
  forced?: boolean;
}

/**
 * Preparing a clip adds a 2 kHz coarse copy (an eighth) and a 100 Hz envelope
 * (negligible) alongside the working-rate audio, so a worker holds a little
 * more than the audio it was sent.
 */
const PREPARED_OVERHEAD = 1.2;

/**
 * Share of device memory the pool may claim. A third leaves room for the copy
 * the main thread is still holding, the decoded page, and the browser itself.
 */
const MEMORY_SHARE = 1 / 3;

/** Assumed when the browser will not say — Safari and Firefox report nothing. */
const ASSUMED_MEMORY_GB = 4;

/** More than this stops helping and starts costing scheduler time. */
const MAX_WORKERS = 8;

export function planAlignPool(input: {
  audioBytes: number;
  cores: number;
  /** `navigator.deviceMemory`, in GB. Undefined outside Chromium. */
  deviceMemoryGb?: number;
  pairsToAlign: number;
  /**
   * Force a worker count, from `?workers=` on the URL.
   *
   * There so that "is the pool doing this?" can be answered by trying it rather
   * than reasoning about it — `?workers=1` runs the old single-threaded path on
   * demand, which is the first thing to try when a result looks wrong.
   */
  override?: number;
  /** Where the override came from, so the report can attribute it correctly. */
  overrideSource?: 'url' | 'setting';
}): PoolBudget {
  if (input.override !== undefined && Number.isFinite(input.override)) {
    const forced = Math.max(1, Math.min(Math.floor(input.override), MAX_WORKERS));
    const from = input.overrideSource === 'url' ? '?workers= on the URL' : 'the Processing setting';
    return { size: forced, reason: `set to ${forced} by ${from}`, forced: true };
  }
  const cores = Math.max(1, Math.floor(input.cores || 1));
  if (cores < 3) {
    return { size: 1, reason: `${cores} core(s) — nothing to share the work with` };
  }
  // A handful of pairs finishes before the workers have started.
  if (input.pairsToAlign < 24) {
    return { size: 1, reason: `only ${input.pairsToAlign} pairs to align — not worth a pool` };
  }

  const perWorker = input.audioBytes * PREPARED_OVERHEAD;
  if (perWorker <= 0) return { size: 1, reason: 'no audio to align' };

  const memoryGb = input.deviceMemoryGb ?? ASSUMED_MEMORY_GB;
  const budget = memoryGb * 1e9 * MEMORY_SHARE;
  const affordable = Math.floor(budget / perWorker);

  // Leave a core for the main thread so the UI keeps painting.
  const size = Math.max(1, Math.min(affordable, cores - 1, MAX_WORKERS));
  const gb = (input.audioBytes / 1e9).toFixed(2);

  if (size <= 1) {
    return {
      size: 1,
      reason:
        `${gb} GB of audio needs ${(perWorker / 1e9).toFixed(2)} GB per worker; ` +
        `${memoryGb} GB device leaves room for none — running single-threaded`,
    };
  }
  return {
    size,
    reason:
      `${size} workers x ${(perWorker / 1e9).toFixed(2)} GB ` +
      `(${gb} GB project, ${memoryGb} GB device, ${cores} cores)`,
  };
}

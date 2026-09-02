/**
 * Turning decoded PCM into the signals `sync-core` actually correlates.
 *
 * The reason this is streaming rather than a call to `decimate()` on a whole
 * array: an hour of 48 kHz mono float64 is 1.4 GB, and a shoot day has dozens
 * of those. The decimation to 2 kHz is 29 MB and the envelope 1.4 MB, so the
 * derived signals are cheap — it is only the intermediate that is ruinous, and
 * the intermediate is exactly what never needs to exist all at once.
 *
 * The filter design is imported from `sync-core` rather than duplicated. Two
 * anti-aliasing filters that drift apart over time would produce a subtle,
 * maddening class of bug where the CLI and the browser disagree by a few
 * samples on the same file.
 */

import { designLowpass } from '@polysync/sync-core';

/**
 * Anti-aliased decimation over a stream of blocks.
 *
 * Produces bit-for-bit the same result as `sync-core`'s whole-array
 * `decimate()` — asserted in the tests, because "close enough" here means the
 * CLI and the app can disagree about where a clip sits.
 *
 * The filter is a windowed sinc of odd length, so its group delay is exactly
 * `(taps - 1) / 2` samples and output `m` is a symmetric window centred on
 * input `m * factor`. Samples outside the signal are treated as zero, which is
 * what a whole-array linear convolution does at its edges too.
 */
export class StreamingDecimator {
  private readonly h: Float64Array;
  private readonly delay: number;
  private buf: Float64Array = new Float64Array(0);
  /** Absolute input index of `buf[0]`. */
  private bufStart = 0;
  /** Next output index to emit. */
  private m = 0;
  /** Total input samples pushed so far. */
  private total = 0;

  constructor(readonly factor: number) {
    if (factor < 1 || !Number.isInteger(factor)) throw new Error(`bad decimation factor ${factor}`);
    // Identical parameters to sync-core's decimate(), deliberately.
    const taps = Math.min(511, Math.max(31, factor * 16 + 1));
    this.h = factor === 1 ? new Float64Array(0) : designLowpass(0.45 / factor, taps);
    this.delay = factor === 1 ? 0 : (this.h.length - 1) >> 1;
  }

  /** Feed a block; returns whatever output became computable. */
  push(block: Float64Array): Float64Array {
    if (this.factor === 1) {
      this.total += block.length;
      return block;
    }
    this.append(block);
    // Emit every output whose rightmost tap is already in the buffer.
    const available = this.bufStart + this.buf.length;
    const out = this.emitWhile((m) => m * this.factor + this.delay < available);
    this.trim();
    return out;
  }

  /** Emit the tail, zero-padding past the end of the signal. Call once. */
  flush(): Float64Array {
    if (this.factor === 1) return new Float64Array(0);
    const last = Math.floor(this.total / this.factor);
    return this.emitWhile((m) => m < last);
  }

  /** Total outputs this decimator will have produced, once flushed. */
  get outputLength(): number {
    return this.factor === 1 ? this.total : Math.floor(this.total / this.factor);
  }

  /**
   * Input samples currently held. Stays near the filter length however much is
   * pushed through — the property that makes a four-hour file tractable, and
   * worth asserting rather than assuming.
   */
  get retainedSamples(): number {
    return this.buf.length;
  }

  private append(block: Float64Array): void {
    const merged = new Float64Array(this.buf.length + block.length);
    merged.set(this.buf, 0);
    merged.set(block, this.buf.length);
    this.buf = merged;
    this.total += block.length;
  }

  private emitWhile(more: (m: number) => boolean): Float64Array {
    const limit = Math.floor(this.total / this.factor);
    const out: number[] = [];
    while (this.m < limit && more(this.m)) {
      out.push(this.convolveAt(this.m * this.factor));
      this.m++;
    }
    return Float64Array.from(out);
  }

  /** One output sample: the filter centred on input index `centre`. */
  private convolveAt(centre: number): number {
    let acc = 0;
    for (let k = 0; k < this.h.length; k++) {
      const i = centre + this.delay - k;
      if (i < 0 || i >= this.total) continue; // zero outside the signal
      const j = i - this.bufStart;
      if (j >= 0 && j < this.buf.length) acc += this.h[k] * this.buf[j];
    }
    return acc;
  }

  /** Drop input the remaining outputs can no longer reach. */
  private trim(): void {
    const needed = this.m * this.factor - this.delay;
    if (needed <= this.bufStart) return;
    const drop = Math.min(needed - this.bufStart, this.buf.length);
    this.buf = this.buf.slice(drop);
    this.bufStart += drop;
  }
}

/**
 * Pick a working sample rate for a clip.
 *
 * Sync accuracy is bounded by what peak-picking can resolve, not by the sample
 * rate, and parabolic interpolation over the correlation peak already gets us
 * well below one sample. So holding native rate for a long clip buys precision
 * nobody can perceive at a cost that is measured in gigabytes.
 *
 * 16 kHz gives a refinement resolution of 62 µs before interpolation — about
 * 1/640th of a frame at 25 fps — while using a third of the memory of 48 kHz.
 * `budgetSamples` then decimates further for genuinely long clips rather than
 * failing on them.
 */
export function chooseWorkingRate(
  sourceRate: number,
  frameCount: number,
  preferredRate = 16000,
  budgetSamples = 120e6,
): number {
  const target = Math.min(sourceRate, preferredRate);
  let factor = Math.max(1, Math.floor(sourceRate / target));
  while (frameCount / factor > budgetSamples && sourceRate / (factor + 1) >= 1000) factor++;
  return sourceRate / factor;
}

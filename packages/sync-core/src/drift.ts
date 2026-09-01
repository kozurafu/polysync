import { decimate, decimationFactor, normaliseRms, removeDc } from './dsp.js';
import { gccPhat } from './gccphat.js';
import type { AudioClip } from './types.js';

export interface DriftResult {
  /**
   * Rate correction to apply to b, in parts per million, so that it holds sync
   * against a for the whole clip. Positive = b's material is stretched (its
   * clock ran slow) and must be sped up by this amount.
   */
  ppm: number;
  /** Goodness of fit of the linear model. Below ~0.8, do not trust the estimate. */
  r2: number;
  /** Local offset measurements the fit was built from. */
  samples: Array<{ timeSeconds: number; offsetSeconds: number }>;
  /** Total sync error accumulated across the overlap, seconds. */
  totalSlipSeconds: number;
}

export interface DriftOptions {
  /** Rate the per-window correlations run at. */
  rate: number;
  /** Number of measurement windows across the overlap. */
  windows: number;
  /** Length of each measurement window, seconds. */
  windowSeconds: number;
  /** Half-width of the local search around the global offset, seconds. */
  searchSeconds: number;
  /** Drop windows whose peak is not this sharp. */
  minPsr: number;
}

export const DEFAULT_DRIFT_OPTIONS: DriftOptions = {
  rate: 8000,
  windows: 12,
  windowSeconds: 4,
  searchSeconds: 0.5,
  minPsr: 5,
};

/**
 * Estimate relative clock drift between two clips already aligned at their start.
 *
 * Two devices recording the same event never share a clock. A recorder running
 * 20 ppm fast against a camera slips by ~72 ms over an hour — inaudible at the
 * head, an obvious lip-sync error at the tail. This measures the slope by
 * correlating short windows spread across the overlap and fitting a line
 * through the local offsets. The slope is the clock ratio error; the intercept
 * is a refined start offset.
 */
export function estimateDrift(
  a: AudioClip,
  b: AudioClip,
  offsetSeconds: number,
  opts: DriftOptions = DEFAULT_DRIFT_OPTIONS,
): DriftResult {
  const aFactor = decimationFactor(a.sampleRate, opts.rate);
  const bFactor = decimationFactor(b.sampleRate, opts.rate);
  const rate = a.sampleRate / aFactor;
  const aSig = normaliseRms(decimate(removeDc(a.samples), aFactor));
  const bSig = normaliseRms(decimate(removeDc(b.samples), bFactor));

  const offset0 = offsetSeconds * rate;
  const overlapStart = Math.max(0, offset0);
  const overlapEnd = Math.min(aSig.length, bSig.length + offset0);
  const overlapLen = overlapEnd - overlapStart;

  const winLen = Math.round(opts.windowSeconds * rate);
  const search = Math.round(opts.searchSeconds * rate);
  const measurements: Array<{ timeSeconds: number; offsetSeconds: number }> = [];

  if (overlapLen > winLen * 2) {
    const n = Math.max(3, Math.min(opts.windows, Math.floor(overlapLen / winLen)));
    for (let i = 0; i < n; i++) {
      // Spread windows evenly, inset by half a window at each end.
      const aStart = Math.round(overlapStart + ((overlapLen - winLen) * i) / (n - 1));
      const bWant = Math.round(aStart - offset0);
      const bStart = Math.max(0, bWant - search);
      const bEnd = Math.min(bSig.length, bWant + winLen + search);
      if (aStart + winLen > aSig.length || bEnd - bStart < winLen) continue;

      const segA = Float64Array.from(aSig.subarray(aStart, aStart + winLen));
      const segB = Float64Array.from(bSig.subarray(bStart, bEnd));
      const res = gccPhat(segA, segB, { maxLag: winLen + search });
      if (res.psr < opts.minPsr) continue;

      const localOffset = (aStart - bStart + res.offset) / rate;
      measurements.push({ timeSeconds: aStart / rate, offsetSeconds: localOffset });
    }
  }

  if (measurements.length < 3) {
    return { ppm: 0, r2: 0, samples: measurements, totalSlipSeconds: 0 };
  }

  // Ordinary least squares: offset = intercept + slope * time.
  const n = measurements.length;
  let sx = 0;
  let sy = 0;
  for (const m of measurements) {
    sx += m.timeSeconds;
    sy += m.offsetSeconds;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (const m of measurements) {
    sxy += (m.timeSeconds - mx) * (m.offsetSeconds - my);
    sxx += (m.timeSeconds - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;

  let ssRes = 0;
  let ssTot = 0;
  for (const m of measurements) {
    const pred = intercept + slope * m.timeSeconds;
    ssRes += (m.offsetSeconds - pred) ** 2;
    ssTot += (m.offsetSeconds - my) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const span = measurements[measurements.length - 1].timeSeconds - measurements[0].timeSeconds;

  return {
    // slope = change in required placement offset per second of programme.
    // If b's clock ran slow, b's material is stretched: matching content sits
    // progressively later inside b, so the offset that aligns it decreases, and
    // b must be sped up. Hence the correction is the negated slope.
    ppm: -slope * 1e6,
    r2,
    samples: measurements,
    totalSlipSeconds: slope * span,
  };
}

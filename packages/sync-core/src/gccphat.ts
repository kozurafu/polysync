import { fft, ifft, nextPow2 } from './fft.js';

/**
 * Sign convention used everywhere in this package
 * ------------------------------------------------
 * Given two signals `a` and `b`, `offset` is the position of b's first sample
 * on a timeline whose origin is a's first sample, measured in samples.
 *
 *   offset > 0  →  b starts later than a
 *   offset < 0  →  b starts earlier than a
 *
 * This is exactly the number an NLE needs: place a at 0, place b at `offset`.
 *
 * Formally we maximise r[tau] = sum_t a[t] * b[t - tau], which peaks at
 * tau = i_a - i_b for a shared event at index i_a in a and i_b in b — i.e. at
 * the offset as defined above.
 */

export interface CorrelationResult {
  /** Sub-sample interpolated offset, in samples of the input rate. */
  offset: number;
  /** Integer offset at the correlation peak, before interpolation. */
  offsetInt: number;
  /** Peak value of the (PHAT-weighted) correlation. */
  peak: number;
  /**
   * Peak-to-sidelobe ratio: how far the winning peak stands above the rest of
   * the correlation surface. This is the primary confidence signal — a true
   * match under PHAT weighting produces a single needle-sharp spike, while a
   * spurious match produces a low, broad, noisy surface.
   */
  psr: number;
}

export interface CorrelateOptions {
  /**
   * Restrict the search to |offset| <= maxLag samples. Cuts both compute and
   * false positives when timecode or file timestamps already bracket the answer.
   */
  maxLag?: number;
  /**
   * PHAT weighting exponent. 1 = full phase transform (sharpest peak, most
   * robust to level/EQ mismatch), 0 = plain cross-correlation (best SNR on
   * clean identical sources). 0.6-0.8 is a good compromise on noisy scratch
   * audio; we default to full PHAT.
   */
  phat?: number;
  /** Half-width in samples of the region excluded from the sidelobe estimate. */
  psrExclusion?: number;
}

/**
 * Generalised cross-correlation with phase transform.
 * Both inputs should already be DC-removed; scaling is irrelevant under PHAT.
 */
export function gccPhat(
  a: Float64Array,
  b: Float64Array,
  opts: CorrelateOptions = {},
): CorrelationResult {
  const { phat = 1, psrExclusion = 5 } = opts;
  const n = nextPow2(a.length + b.length);

  const aRe = new Float64Array(n);
  const aIm = new Float64Array(n);
  const bRe = new Float64Array(n);
  const bIm = new Float64Array(n);
  aRe.set(a);
  bRe.set(b);

  fft(aRe, aIm);
  fft(bRe, bIm);

  // R = A * conj(B), optionally magnitude-normalised (PHAT).
  const rRe = new Float64Array(n);
  const rIm = new Float64Array(n);
  const eps = 1e-12;
  for (let i = 0; i < n; i++) {
    const re = aRe[i] * bRe[i] + aIm[i] * bIm[i];
    const im = aIm[i] * bRe[i] - aRe[i] * bIm[i];
    if (phat > 0) {
      const mag = Math.sqrt(re * re + im * im) + eps;
      const w = phat === 1 ? 1 / mag : 1 / Math.pow(mag, phat);
      rRe[i] = re * w;
      rIm[i] = im * w;
    } else {
      rRe[i] = re;
      rIm[i] = im;
    }
  }

  ifft(rRe, rIm);

  // Find the peak over the permitted lag range.
  const maxLag = opts.maxLag ?? n / 2 - 1;
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < n; i++) {
    const lag = i < n / 2 ? i : i - n;
    if (Math.abs(lag) > maxLag) continue;
    const v = rRe[i];
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }

  const offsetInt = bestIdx < n / 2 ? bestIdx : bestIdx - n;

  // Parabolic interpolation around the peak for sub-sample resolution.
  const yMinus = rRe[(bestIdx - 1 + n) % n];
  const yPlus = rRe[(bestIdx + 1) % n];
  const denom = yMinus - 2 * bestVal + yPlus;
  const frac = denom === 0 ? 0 : (0.5 * (yMinus - yPlus)) / denom;
  const offset = offsetInt + (Number.isFinite(frac) && Math.abs(frac) <= 1 ? frac : 0);

  // Peak-to-sidelobe ratio over the searched region only.
  let acc = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const lag = i < n / 2 ? i : i - n;
    if (Math.abs(lag) > maxLag) continue;
    if (Math.abs(((i - bestIdx + n + n / 2) % n) - n / 2) <= psrExclusion) continue;
    acc += rRe[i] * rRe[i];
    count++;
  }
  const sidelobeRms = count ? Math.sqrt(acc / count) : 0;
  const psr = sidelobeRms > 0 ? bestVal / sidelobeRms : Infinity;

  return { offset, offsetInt, peak: bestVal, psr };
}

/**
 * Pearson correlation of the two signals over their overlap at a given integer
 * offset. Unlike PSR this is bounded to [-1, 1] and is directly interpretable,
 * so it is what we surface to the user as "match quality".
 */
export function overlapCorrelation(
  a: Float64Array,
  b: Float64Array,
  offset: number,
): { r: number; overlapSamples: number } {
  const o = Math.round(offset);
  const start = Math.max(0, o);
  const end = Math.min(a.length, b.length + o);
  const n = end - start;
  if (n <= 1) return { r: 0, overlapSamples: Math.max(0, n) };

  let sa = 0;
  let sb = 0;
  for (let i = start; i < end; i++) {
    sa += a[i];
    sb += b[i - o];
  }
  const ma = sa / n;
  const mb = sb / n;

  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = start; i < end; i++) {
    const x = a[i] - ma;
    const y = b[i - o] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return { r: denom > 0 ? num / denom : 0, overlapSamples: n };
}

/**
 * Pair-discovery gates.
 *
 * The solve is O(n²) in clip count: 60 clips is 1,770 pairs, and a full
 * alignment of two ten-minute clips costs about 2.9 seconds. That is 85 minutes
 * for one shoot day, which is not a usable tool. Almost all of those pairs are
 * two clips that share no audio whatsoever, and the whole cost of finding that
 * out is wasted.
 *
 * So: two cheap tests that can rule a pair out before paying for it.
 *
 * **The governing rule is that a gate may never reject a pair that would have
 * matched.** A slow solve is an annoyance; a lost sync is a wrong answer, and
 * the user has no way to tell it happened. Both gates below are therefore
 * conservative to the point of being provably safe:
 *
 *   - The recording-time gate fails *open*. Missing timestamps, ambiguous
 *     timestamps, bulk-copied timestamps — all mean "cannot rule this out".
 *   - The envelope prefilter is not a heuristic at all. It computes the exact
 *     upper bound on the quality this pair could ever be accepted with, so a
 *     rejection is a proof rather than a guess.
 */

import { fft, ifft, nextPow2 } from './fft.js';
import type { PreparedClip } from './align.js';

export interface GateOptions {
  /** Rule out pairs whose recording windows cannot intersect. */
  gateByRecordingTime: boolean;
  /**
   * Slack applied to every recording-time comparison, seconds.
   *
   * Generous on purpose. A file's modification time is set when the camera
   * *closed* the file on some cameras and when it opened it on others, cards
   * get copied, clocks are set wrong, and daylight saving exists. One hour
   * absorbs all of that and still rules out the morning-versus-afternoon pairs
   * that make up most of a shoot day.
   */
  recordingTimeSlopSeconds: number;
  /** Rule out pairs whose best possible envelope correlation is too low. */
  envelopePrefilter: boolean;
  /**
   * Margin subtracted from the acceptance threshold before rejecting.
   *
   * The bound is exact in real arithmetic; this covers the floating-point
   * difference between computing the correlation from prefix sums here and
   * computing it directly in `overlapCorrelation`. Cheap insurance against the
   * one failure mode that matters.
   */
  prefilterMargin: number;
}

export const DEFAULT_GATE_OPTIONS: GateOptions = {
  gateByRecordingTime: true,
  recordingTimeSlopSeconds: 3600,
  // Off by default, and measured rather than assumed. On a simulated shoot day
  // the bound rejected 0 of 190 pairs: with a 3-second minimum overlap there
  // are tens of thousands of candidate lags, and among that many some short
  // window always correlates above the threshold by chance. The bound is real
  // — it just is not selective, because what actually separates a true match
  // from a spurious one is the peak-to-sidelobe ratio, and that cannot be
  // bounded cheaply. Kept because it costs 1.3% of a pair and does catch
  // degenerate cases (silence, near-empty clips), and because
  // `maxEnvelopeCorrelation` is useful on its own. See tools/bench.ts.
  envelopePrefilter: false,
  prefilterMargin: 0.05,
};

export type GateReason = 'recording-time' | 'envelope';

export interface ScreenResult {
  /** False means this pair cannot match and must not be aligned. */
  pass: boolean;
  reason?: GateReason;
  /** Best achievable envelope correlation, when the prefilter ran. */
  bound?: number;
}

/**
 * Could these two clips have been recording at the same time?
 *
 * `recordedAtSeconds` is a single instant, and we do not know whether the
 * device meant the start or the end of the take — so a clip of duration `d`
 * timestamped `t` is treated as possibly occupying anywhere in
 * `[t - d - slop, t + d + slop]`. Two clips can only share audio if those
 * windows intersect.
 *
 * Returns true whenever it cannot prove otherwise, including when either clip
 * has no timestamp at all.
 */
export function couldOverlapInTime(
  a: PreparedClip,
  b: PreparedClip,
  slopSeconds: number,
): boolean {
  const ta = a.clip.recordedAtSeconds;
  const tb = b.clip.recordedAtSeconds;
  if (ta == null || tb == null || !Number.isFinite(ta) || !Number.isFinite(tb)) return true;

  const aFrom = ta - a.durationSeconds - slopSeconds;
  const aTo = ta + a.durationSeconds + slopSeconds;
  const bFrom = tb - b.durationSeconds - slopSeconds;
  const bTo = tb + b.durationSeconds + slopSeconds;
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Which pairs the recording-time gate allows, for the whole project at once.
 *
 * Done as a matrix rather than pair by pair because of one failure mode that
 * pairwise evaluation cannot see. A camera whose clock is set to the wrong
 * timezone is hours away from everything else, so *every* one of its pairs gets
 * gated out and the camera silently never syncs — the worst possible outcome,
 * because the user is given a confident answer with a clip missing from it and
 * no indication why.
 *
 * So: if a clip would be excluded from every other clip in the project, its
 * timestamp is not evidence about that clip, it is evidence that its clock is
 * wrong. The gate steps aside for that clip entirely and it goes back to a full
 * search. Costs one pass over the matrix; removes the only way this gate can
 * lose a sync.
 */
export function recordingTimeMatrix(
  clips: PreparedClip[],
  slopSeconds: number,
): boolean[][] {
  const n = clips.length;
  const allowed: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(true));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ok = couldOverlapInTime(clips[i], clips[j], slopSeconds);
      allowed[i][j] = ok;
      allowed[j][i] = ok;
    }
  }

  for (let i = 0; i < n; i++) {
    let anyAllowed = false;
    for (let j = 0; j < n; j++) {
      if (j !== i && allowed[i][j]) {
        anyAllowed = true;
        break;
      }
    }
    if (anyAllowed) continue;
    // Isolated by its timestamp alone. Trust the audio instead.
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      allowed[i][j] = true;
      allowed[j][i] = true;
    }
  }
  return allowed;
}

/**
 * The highest envelope correlation this pair could achieve at any offset.
 *
 * This is the load-bearing idea. A pair is accepted only if its `quality`
 * clears `minQuality`, and that quality is *always* the Pearson correlation of
 * the two log-energy envelopes over their overlap at the chosen offset. So if
 * the maximum of that quantity over every possible offset is already below the
 * threshold, no offset exists that could be accepted, and the expensive
 * waveform pass cannot change the outcome. Rejecting here is not a gamble.
 *
 * Computing it for every lag would normally be O(n²). Instead:
 *
 *   - the numerator's `sum(a·b)` term for all lags at once is a cross-correlation,
 *     which one FFT pair provides;
 *   - the per-lag means and sums of squares come from prefix sums in O(1) each.
 *
 * The envelope runs at 100 Hz, so for two ten-minute clips this is a 2^17-point
 * transform — roughly forty times cheaper than the 2 kHz waveform pass it
 * replaces.
 */
export function maxEnvelopeCorrelation(
  a: PreparedClip,
  b: PreparedClip,
  minOverlapSeconds: number,
): { r: number; offsetSeconds: number; overlapSeconds: number } {
  const rate = a.envelopeRate;
  const x = a.envelope;
  const y = b.envelope;
  const na = x.length;
  const nb = y.length;
  const minOverlap = Math.max(2, Math.ceil(minOverlapSeconds * rate));
  if (na < minOverlap || nb < minOverlap) {
    return { r: 0, offsetSeconds: 0, overlapSeconds: 0 };
  }

  const cross = crossCorrelate(x, y);

  // Prefix sums, so any window's sum and sum-of-squares is one subtraction.
  const px = prefix(x);
  const px2 = prefixSquares(x);
  const py = prefix(y);
  const py2 = prefixSquares(y);

  let bestR = -Infinity;
  let bestLag = 0;
  let bestN = 0;

  // Lag is the offset of b's first sample relative to a's, matching the sign
  // convention used everywhere in this package.
  const lagFrom = minOverlap - nb;
  const lagTo = na - minOverlap;
  for (let lag = lagFrom; lag <= lagTo; lag++) {
    const start = Math.max(0, lag);
    const end = Math.min(na, nb + lag);
    const n = end - start;
    if (n < minOverlap) continue;

    const sx = px[end] - px[start];
    const sx2 = px2[end] - px2[start];
    const sy = py[end - lag] - py[start - lag];
    const sy2 = py2[end - lag] - py2[start - lag];
    const sxy = cross[lag < 0 ? lag + cross.length : lag];

    const num = sxy - (sx * sy) / n;
    const dx = sx2 - (sx * sx) / n;
    const dy = sy2 - (sy * sy) / n;
    if (dx <= 0 || dy <= 0) continue;

    const r = num / Math.sqrt(dx * dy);
    if (r > bestR) {
      bestR = r;
      bestLag = lag;
      bestN = n;
    }
  }

  if (bestR === -Infinity) return { r: 0, offsetSeconds: 0, overlapSeconds: 0 };
  return { r: bestR, offsetSeconds: bestLag / rate, overlapSeconds: bestN / rate };
}

/**
 * Decide whether a pair is worth aligning.
 *
 * `minQuality` is the acceptance threshold the caller will apply later; the
 * prefilter rejects only when the pair provably cannot reach it.
 */
export function screenPair(
  a: PreparedClip,
  b: PreparedClip,
  opts: GateOptions & { minQuality: number; minOverlapSeconds: number },
): ScreenResult {
  if (opts.gateByRecordingTime && !couldOverlapInTime(a, b, opts.recordingTimeSlopSeconds)) {
    return { pass: false, reason: 'recording-time' };
  }
  if (opts.envelopePrefilter) {
    const { r } = maxEnvelopeCorrelation(a, b, opts.minOverlapSeconds);
    if (r < opts.minQuality - opts.prefilterMargin) {
      return { pass: false, reason: 'envelope', bound: r };
    }
    return { pass: true, bound: r };
  }
  return { pass: true };
}

/**
 * Plain (unweighted) circular cross-correlation via FFT.
 *
 * `out[k] = sum_i x[i] * y[i - k]`, with negative lags wrapped to the end of
 * the array — the same indexing `gccPhat` uses. Deliberately *not* PHAT
 * weighted: the phase transform sharpens the peak but destroys the magnitudes,
 * and it is exactly the magnitudes the Pearson numerator needs.
 */
function crossCorrelate(x: Float64Array, y: Float64Array): Float64Array {
  const n = nextPow2(x.length + y.length);
  const xr = new Float64Array(n);
  const xi = new Float64Array(n);
  const yr = new Float64Array(n);
  const yi = new Float64Array(n);
  xr.set(x);
  yr.set(y);

  fft(xr, xi);
  fft(yr, yi);

  const rr = new Float64Array(n);
  const ri = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // X * conj(Y)
    rr[i] = xr[i] * yr[i] + xi[i] * yi[i];
    ri[i] = xi[i] * yr[i] - xr[i] * yi[i];
  }
  ifft(rr, ri);
  return rr;
}

/** `out[i]` is the sum of the first `i` elements, so `out` is one longer. */
function prefix(v: Float64Array): Float64Array {
  const out = new Float64Array(v.length + 1);
  let acc = 0;
  for (let i = 0; i < v.length; i++) {
    acc += v[i];
    out[i + 1] = acc;
  }
  return out;
}

function prefixSquares(v: Float64Array): Float64Array {
  const out = new Float64Array(v.length + 1);
  let acc = 0;
  for (let i = 0; i < v.length; i++) {
    acc += v[i] * v[i];
    out[i + 1] = acc;
  }
  return out;
}

import { decimate, decimationFactor, logEnergyEnvelope, normaliseRms, removeDc } from './dsp.js';
import { gccPhat, overlapCorrelation } from './gccphat.js';
import type { AlignMethod, AudioClip, PairAlignment } from './types.js';

export interface AlignOptions {
  /** Rate the coarse full-length search runs at. Lower = faster, coarser. */
  coarseRate: number;
  /** Rate the refinement pass runs at. Native rate gives sample accuracy. */
  fineRate: number;
  /** Half-width of the refinement search around the coarse estimate, seconds. */
  refineWindowSeconds: number;
  /** Length of audio used for the refinement correlation, seconds. */
  fineSegmentSeconds: number;
  /** Reject matches whose overlap is shorter than this. */
  minOverlapSeconds: number;
  /** Reject matches below this envelope correlation. */
  minQuality: number;
  /** Reject matches below this peak-to-sidelobe ratio. */
  minPsr: number;
  /** Limit the search to |offset| <= this. Infinity searches the full range. */
  maxLagSeconds: number;
  /** Frame/hop for the log-energy envelope, seconds. */
  envelopeFrameSeconds: number;
  envelopeHopSeconds: number;
  /** If the waveform pass fails, retry on the log-energy envelope. */
  envelopeFallback: boolean;
  /** Use embedded timecode to seed the search when both clips carry it. */
  useTimecode: boolean;
}

export const DEFAULT_ALIGN_OPTIONS: AlignOptions = {
  coarseRate: 2000,
  fineRate: 48000,
  refineWindowSeconds: 0.25,
  fineSegmentSeconds: 15,
  minOverlapSeconds: 3,
  minQuality: 0.3,
  minPsr: 6,
  maxLagSeconds: Infinity,
  envelopeFrameSeconds: 0.04,
  envelopeHopSeconds: 0.01,
  envelopeFallback: true,
  useTimecode: true,
};

/** Cached per-clip derived signals, so an N-clip project decimates each clip once. */
export interface PreparedClip {
  clip: AudioClip;
  coarse: Float64Array;
  coarseRate: number;
  envelope: Float64Array;
  envelopeRate: number;
  durationSeconds: number;
}

export function prepareClip(clip: AudioClip, opts: AlignOptions): PreparedClip {
  const mono = removeDc(clip.samples);
  const factor = decimationFactor(clip.sampleRate, opts.coarseRate);
  const coarse = normaliseRms(decimate(mono, factor));
  const coarseRate = clip.sampleRate / factor;

  const frame = Math.max(2, Math.round(opts.envelopeFrameSeconds * clip.sampleRate));
  const hop = Math.max(1, Math.round(opts.envelopeHopSeconds * clip.sampleRate));
  const envelope = removeDc(logEnergyEnvelope(mono, frame, hop));
  const envelopeRate = clip.sampleRate / hop;

  return {
    clip,
    coarse,
    coarseRate,
    envelope,
    envelopeRate,
    durationSeconds: clip.samples.length / clip.sampleRate,
  };
}

function envelopeQuality(a: PreparedClip, b: PreparedClip, offsetSeconds: number): { r: number; overlapSeconds: number } {
  // Both envelopes are at (almost exactly) the same rate when the sources share
  // a sample rate; when they don't, resample the offset into a's envelope grid
  // and accept the small rate mismatch — envelope correlation is tolerant.
  const rate = a.envelopeRate;
  const { r, overlapSamples } = overlapCorrelation(a.envelope, b.envelope, offsetSeconds * rate);
  return { r, overlapSeconds: overlapSamples / rate };
}

/**
 * Refine a coarse offset to (near) sample accuracy by correlating a short
 * segment of native-rate audio inside a narrow window around the estimate.
 */
function refine(
  a: AudioClip,
  b: AudioClip,
  coarseOffsetSeconds: number,
  opts: AlignOptions,
): { offsetSeconds: number; psr: number } | null {
  const sr = Math.min(a.sampleRate, b.sampleRate, opts.fineRate);
  const aFactor = decimationFactor(a.sampleRate, sr);
  const bFactor = decimationFactor(b.sampleRate, sr);
  const aRate = a.sampleRate / aFactor;
  const bRate = b.sampleRate / bFactor;
  if (Math.abs(aRate - bRate) > 1e-6) return null; // refine only on matching grids

  const aSig = aFactor === 1 ? removeDc(a.samples) : normaliseRms(decimate(removeDc(a.samples), aFactor));
  const bSig = bFactor === 1 ? removeDc(b.samples) : normaliseRms(decimate(removeDc(b.samples), bFactor));

  const offsetC = Math.round(coarseOffsetSeconds * aRate);
  const overlapStart = Math.max(0, offsetC);
  const overlapEnd = Math.min(aSig.length, bSig.length + offsetC);
  const overlapLen = overlapEnd - overlapStart;
  if (overlapLen < aRate) return null;

  const segLen = Math.min(overlapLen, Math.round(opts.fineSegmentSeconds * aRate));
  const centre = overlapStart + overlapLen / 2;
  let aStart = Math.round(centre - segLen / 2);
  aStart = Math.max(overlapStart, Math.min(aStart, overlapEnd - segLen));

  const w = Math.round(opts.refineWindowSeconds * aRate);
  const bWant = aStart - offsetC;
  const bStart = Math.max(0, bWant - w);
  const bEnd = Math.min(bSig.length, bWant + segLen + w);
  if (bEnd - bStart < segLen / 2) return null;

  const segA = aSig.subarray(aStart, aStart + segLen);
  const segB = bSig.subarray(bStart, bEnd);

  const { offset, psr } = gccPhat(Float64Array.from(segA), Float64Array.from(segB), {
    maxLag: segLen + w,
  });

  // offsetFinal = aStart - bStart + tau   (see the sign convention in gccphat.ts)
  const offsetSamples = aStart - bStart + offset;
  return { offsetSeconds: offsetSamples / aRate, psr };
}

/** Align a single pair of clips. Returns an alignment whether or not it passed. */
export function alignPair(
  a: PreparedClip,
  b: PreparedClip,
  opts: AlignOptions = DEFAULT_ALIGN_OPTIONS,
): PairAlignment {
  const maxLagCoarse =
    Number.isFinite(opts.maxLagSeconds) ? Math.round(opts.maxLagSeconds * a.coarseRate) : undefined;

  const candidates: Array<{ offsetSeconds: number; psr: number; method: AlignMethod }> = [];

  // 1. Timecode seed, when both clips carry one. This is not a guess: matching
  //    jam-synced timecode is authoritative to within a frame, and we only use
  //    correlation to verify and refine it.
  if (opts.useTimecode && a.clip.timecodeSeconds != null && b.clip.timecodeSeconds != null) {
    candidates.push({
      offsetSeconds: b.clip.timecodeSeconds - a.clip.timecodeSeconds,
      psr: Infinity,
      method: 'timecode',
    });
  }

  // 2. Full-length coarse waveform search on decimated audio.
  {
    const rateRatio = b.coarseRate / a.coarseRate;
    const bResampled = Math.abs(rateRatio - 1) < 1e-9 ? b.coarse : b.coarse; // rates match in practice
    const res = gccPhat(a.coarse, bResampled, { maxLag: maxLagCoarse });
    candidates.push({ offsetSeconds: res.offset / a.coarseRate, psr: res.psr, method: 'waveform' });
  }

  // 3. Envelope search — the fallback that rescues wildly dissimilar sources
  //    (room mic vs lav) where waveform phase never lines up.
  if (opts.envelopeFallback) {
    const res = gccPhat(a.envelope, b.envelope, {
      maxLag: Number.isFinite(opts.maxLagSeconds)
        ? Math.round(opts.maxLagSeconds * a.envelopeRate)
        : undefined,
    });
    candidates.push({
      offsetSeconds: res.offset / a.envelopeRate,
      psr: res.psr,
      method: 'envelope',
    });
  }

  // Score each candidate cheaply on the envelope first and only pay for the
  // expensive native-rate refinement on the winner.
  let best: { offsetSeconds: number; psr: number; method: AlignMethod; quality: number; overlapSeconds: number } | null =
    null;
  for (const cand of candidates) {
    const { r, overlapSeconds } = envelopeQuality(a, b, cand.offsetSeconds);
    if (!best || r > best.quality) {
      best = { ...cand, quality: r, overlapSeconds };
    }
  }

  let result: PairAlignment | null = null;
  if (best) {
    const refined = refine(a.clip, b.clip, best.offsetSeconds, opts);
    const offsetSeconds = refined?.offsetSeconds ?? best.offsetSeconds;
    const scored = envelopeQuality(a, b, offsetSeconds);
    // Keep the refinement only if it did not make the match worse; a refinement
    // that lands on a different peak is a refinement that found the wrong one.
    const useRefined = scored.r >= best.quality - 0.02;
    result = {
      aId: a.clip.id,
      bId: b.clip.id,
      offsetSeconds: useRefined ? offsetSeconds : best.offsetSeconds,
      quality: useRefined ? scored.r : best.quality,
      psr: Math.max(best.psr === Infinity ? 0 : best.psr, refined?.psr ?? 0),
      overlapSeconds: useRefined ? scored.overlapSeconds : best.overlapSeconds,
      method: best.method,
      accepted: false,
    };
  }

  result = result ?? {
    aId: a.clip.id,
    bId: b.clip.id,
    offsetSeconds: 0,
    quality: 0,
    psr: 0,
    overlapSeconds: 0,
    method: 'none' as AlignMethod,
    accepted: false,
  };

  result.accepted =
    result.overlapSeconds >= opts.minOverlapSeconds &&
    result.quality >= opts.minQuality &&
    result.psr >= opts.minPsr;

  return result;
}

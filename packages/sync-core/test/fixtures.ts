/**
 * Synthetic test material.
 *
 * Real multicam rushes are the only true test, but they cannot live in a repo.
 * These generators reproduce the specific properties that break naive
 * correlation: a camera's on-board mic is band-limited, 20-30 dB down, noisy,
 * and smeared by room reflections, while the recorder feed is clean and
 * full-band. Anything that syncs these will sync a real shoot.
 */

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Speech-like source: bursts of filtered noise with sharp onsets and pauses,
 * plus a few harmonic components. Transient-rich, which is what correlation
 * actually locks onto.
 */
export function makeSourceAudio(seconds: number, sampleRate: number, seed = 1): Float64Array {
  const rand = rng(seed);
  const n = Math.round(seconds * sampleRate);
  const out = new Float64Array(n);

  let i = 0;
  while (i < n) {
    const silent = rand() < 0.35;
    const durSec = 0.08 + rand() * 0.45;
    const len = Math.min(n - i, Math.round(durSec * sampleRate));
    if (!silent) {
      const f0 = 90 + rand() * 160;
      const amp = 0.2 + rand() * 0.8;
      let lp = 0;
      for (let k = 0; k < len; k++) {
        const t = k / sampleRate;
        // Attack/decay envelope with a hard onset.
        const env = Math.min(1, k / (0.004 * sampleRate)) * Math.exp(-3 * (k / len));
        const noise = rand() * 2 - 1;
        lp = lp * 0.7 + noise * 0.3;
        const harmonics =
          Math.sin(2 * Math.PI * f0 * t) * 0.5 +
          Math.sin(2 * Math.PI * 2 * f0 * t) * 0.25 +
          Math.sin(2 * Math.PI * 3 * f0 * t) * 0.12;
        out[i + k] = amp * env * (0.55 * harmonics + 0.45 * lp);
      }
    }
    i += len;
  }
  return out;
}

/** One-pole low-pass. `cutoff` in Hz. */
export function lowpass(x: Float64Array, cutoff: number, sampleRate: number): Float64Array {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = dt / (rc + dt);
  const out = new Float64Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += alpha * (x[i] - y);
    out[i] = y;
  }
  return out;
}

/** One-pole high-pass. */
export function highpass(x: Float64Array, cutoff: number, sampleRate: number): Float64Array {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = rc / (rc + dt);
  const out = new Float64Array(x.length);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < x.length; i++) {
    prevY = alpha * (prevY + x[i] - prevX);
    prevX = x[i];
    out[i] = prevY;
  }
  return out;
}

/** Crude early-reflection reverb — enough to decorrelate fine phase structure. */
export function addRoom(x: Float64Array, sampleRate: number, seed = 7): Float64Array {
  const rand = rng(seed);
  const taps = Array.from({ length: 6 }, () => ({
    delay: Math.round((0.005 + rand() * 0.05) * sampleRate),
    gain: 0.1 + rand() * 0.3,
  }));
  const out = Float64Array.from(x);
  for (const tap of taps) {
    for (let i = tap.delay; i < x.length; i++) out[i] += x[i - tap.delay] * tap.gain;
  }
  return out;
}

export function addNoise(x: Float64Array, level: number, seed = 3): Float64Array {
  const rand = rng(seed);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + (rand() * 2 - 1) * level;
  return out;
}

export function gain(x: Float64Array, g: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

/**
 * Degrade a clean source into something resembling a camera's on-board mic:
 * band-limited 250 Hz - 5 kHz, room reflections, 26 dB down, with a noise floor.
 */
export function asScratchAudio(x: Float64Array, sampleRate: number, seed = 11): Float64Array {
  let y = addRoom(x, sampleRate, seed);
  y = highpass(y, 250, sampleRate);
  y = lowpass(y, 5000, sampleRate);
  y = gain(y, 0.05);
  return addNoise(y, 0.004, seed + 1);
}

/** Slice `[startSec, startSec + lengthSec)` out of a longer take, zero-padded if short. */
export function slice(
  x: Float64Array,
  startSec: number,
  lengthSec: number,
  sampleRate: number,
): Float64Array {
  const start = Math.round(startSec * sampleRate);
  const len = Math.round(lengthSec * sampleRate);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const j = start + i;
    out[i] = j >= 0 && j < x.length ? x[j] : 0;
  }
  return out;
}

/**
 * Resample by `ratio` using linear interpolation, simulating a device whose
 * clock runs at a slightly different rate. ratio > 1 stretches (device slow).
 */
export function resample(x: Float64Array, ratio: number): Float64Array {
  const outLen = Math.floor(x.length * ratio);
  const out = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = x[i0] ?? 0;
    const b = x[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * Signal conditioning used before correlation.
 *
 * The design goal throughout is invariance to everything that differs between a
 * camera's on-board scratch mic and a boom feed into a field recorder: level,
 * EQ, mic distance, codec artefacts. What survives all of that is the *envelope
 * and transient structure* of the recording, which is what we correlate.
 */

/**
 * Windowed-sinc low-pass FIR, Blackman window.
 * @param cutoff normalised cutoff (fraction of the sample rate, 0 < cutoff < 0.5)
 * @param taps   filter length; forced odd so the filter is linear-phase with an
 *               integer group delay of (taps - 1) / 2 samples.
 */
export function designLowpass(cutoff: number, taps: number): Float64Array {
  if (cutoff <= 0 || cutoff >= 0.5) throw new Error(`designLowpass: cutoff ${cutoff} out of range`);
  const n = taps % 2 === 0 ? taps + 1 : taps;
  const h = new Float64Array(n);
  const mid = (n - 1) / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    // Blackman window
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) +
      0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < n; i++) h[i] /= sum; // unity DC gain
  return h;
}

/** Direct-form FIR convolution, compensating the filter's group delay. */
export function firFilter(x: Float64Array, h: Float64Array): Float64Array {
  const delay = (h.length - 1) >> 1;
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let acc = 0;
    const kStart = Math.max(0, i + delay - x.length + 1);
    const kEnd = Math.min(h.length - 1, i + delay);
    for (let k = kStart; k <= kEnd; k++) {
      acc += h[k] * x[i + delay - k];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Anti-aliased decimation by an integer factor.
 * Returns the decimated signal; the effective output rate is `srIn / factor`.
 */
export function decimate(x: Float64Array, factor: number): Float64Array {
  if (factor < 1 || !Number.isInteger(factor)) throw new Error(`decimate: bad factor ${factor}`);
  if (factor === 1) return x;
  // Cutoff a little below Nyquist of the new rate to leave transition room.
  const cutoff = 0.45 / factor;
  const taps = Math.min(511, Math.max(31, factor * 16 + 1));
  const filtered = firFilter(x, designLowpass(cutoff, taps));
  const outLen = Math.floor(x.length / factor);
  const out = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = filtered[i * factor];
  return out;
}

/** Choose the largest integer decimation factor that keeps rate >= targetRate. */
export function decimationFactor(srIn: number, targetRate: number): number {
  return Math.max(1, Math.floor(srIn / targetRate));
}

/** Subtract the mean (removes DC offset, which otherwise dominates correlation). */
export function removeDc(x: Float64Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  const mean = sum / (x.length || 1);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - mean;
  return out;
}

export function rms(x: Float64Array, from = 0, to = x.length): number {
  let acc = 0;
  const n = Math.max(0, to - from);
  for (let i = from; i < to; i++) acc += x[i] * x[i];
  return n ? Math.sqrt(acc / n) : 0;
}

/** Scale to unit RMS. A no-op on silence. */
export function normaliseRms(x: Float64Array): Float64Array {
  const r = rms(x);
  if (r === 0) return x;
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] / r;
  return out;
}

/**
 * Short-time energy envelope, in dB, at `hop` sample resolution.
 *
 * Correlating the log-energy envelope rather than the waveform is what makes a
 * match possible between sources with completely different frequency responses:
 * a phone mic 20 m back in a room and a lav on the subject share almost no
 * spectral content, but their loudness contours line up exactly.
 */
export function logEnergyEnvelope(x: Float64Array, frame: number, hop: number): Float64Array {
  const n = Math.max(0, Math.floor((x.length - frame) / hop) + 1);
  const out = new Float64Array(n);
  const floor = 1e-10;
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const s = i * hop;
    for (let k = 0; k < frame; k++) {
      const v = x[s + k];
      acc += v * v;
    }
    out[i] = 10 * Math.log10(acc / frame + floor);
  }
  return out;
}

/** Mix an interleaved multi-channel buffer down to mono. */
export function toMono(interleaved: Float32Array | Float64Array, channels: number): Float64Array {
  if (channels <= 1) return Float64Array.from(interleaved);
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) acc += interleaved[i * channels + c];
    out[i] = acc / channels;
  }
  return out;
}

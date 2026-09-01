/**
 * Minimal, dependency-free iterative radix-2 FFT operating on split
 * real/imaginary Float64Arrays.
 *
 * This exists so `sync-core` stays pure TypeScript with zero dependencies and
 * can run identically in Node (tests), a Web Worker, and a browser main thread.
 * It is fast enough for the coarse pass (decimated audio) and for the short
 * refinement windows. If profiling later shows the FFT dominating, swap this
 * implementation for a WASM SIMD kernel behind the same interface — see
 * docs/03-sync-engine.md.
 */

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place complex FFT. `re`/`im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  transform(re, im, false);
}

/** In-place complex inverse FFT (scaled by 1/N). */
export function ifft(re: Float64Array, im: Float64Array): void {
  transform(re, im, true);
  const n = re.length;
  const inv = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] *= inv;
    im[i] *= inv;
  }
}

function transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: re/im length mismatch');
  if (n === 0) return;
  if ((n & (n - 1)) !== 0) throw new Error(`fft: length ${n} is not a power of two`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

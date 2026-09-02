/**
 * Synthetic media files, built byte by byte.
 *
 * The real test corpus is real camera and recorder files, and getting it is the
 * project's largest risk (`docs/08-build-plan.md` §5). These fixtures do not
 * replace it — they pin down the parsing of structures we control, so that when
 * a real Sony file fails we know the failure is in the file and not in us.
 */

/** Build an ISO-BMFF / RIFF style box or chunk. */
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff, true);
  return b;
}

function u64le(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

function ascii(s: string, length?: number): Uint8Array {
  const out = new Uint8Array(length ?? s.length);
  for (let i = 0; i < s.length && i < out.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------- WAV / BWF

export interface WavFixtureOptions {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  isFloat?: boolean;
  /** Per-channel signals. Length sets the duration. */
  signals?: Float64Array[];
  frames?: number;
  /** Write a `bext` chunk with this `TimeReference` (samples since midnight). */
  timeReference?: number;
  ixml?: string;
  /** Emit an RF64 header with a `ds64` chunk instead of RIFF. */
  rf64?: boolean;
}

/** A RIFF/WAVE or RF64 file with optional `bext` and iXML. */
export function makeWav(options: WavFixtureOptions = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 48000;
  const channels = options.channels ?? 1;
  const bits = options.bitsPerSample ?? 16;
  const isFloat = options.isFloat ?? false;
  const frames = options.frames ?? options.signals?.[0]?.length ?? sampleRate;
  const bytesPerSample = bits >> 3;
  const blockAlign = bytesPerSample * channels;

  const data = new Uint8Array(frames * blockAlign);
  const view = new DataView(data.buffer);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = options.signals?.[c]?.[i] ?? 0;
      const at = i * blockAlign + c * bytesPerSample;
      writeSample(view, at, v, bits, isFloat);
    }
  }

  const chunks: Uint8Array[] = [];

  const fmt = concatBytes([
    u16le(isFloat ? 3 : 1),
    u16le(channels),
    u32le(sampleRate),
    u32le(sampleRate * blockAlign),
    u16le(blockAlign),
    u16le(bits),
  ]);
  chunks.push(chunk('fmt ', fmt));

  if (options.timeReference !== undefined) {
    chunks.push(chunk('bext', makeBext(options.timeReference)));
  }
  if (options.ixml !== undefined) {
    chunks.push(chunk('iXML', new TextEncoder().encode(options.ixml)));
  }

  if (options.rf64) {
    // RF64 puts the real 64-bit sizes in ds64 and writes -1 in the 32-bit ones.
    const ds64 = concatBytes([
      u64le(0), // riffSize, unused by our reader
      u64le(data.length),
      u64le(frames),
      u32le(0), // table length
    ]);
    // ds64 must precede fmt per the spec; order the chunk list accordingly.
    chunks.unshift(chunk('ds64', ds64));
    chunks.push(concatBytes([ascii('data'), u32le(0xffffffff), data]));
    const body = concatBytes([ascii('WAVE'), ...chunks]);
    return concatBytes([ascii('RF64'), u32le(0xffffffff), body]);
  }

  chunks.push(chunk('data', data));
  const body = concatBytes([ascii('WAVE'), ...chunks]);
  return concatBytes([ascii('RIFF'), u32le(body.length), body]);
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const pad = body.length % 2 === 1 ? new Uint8Array(1) : new Uint8Array(0);
  return concatBytes([ascii(id, 4), u32le(body.length), body, pad]);
}

/** A 602-byte `bext` chunk carrying a start-sample count. */
function makeBext(timeReference: number): Uint8Array {
  const out = new Uint8Array(602);
  out.set(ascii('Polysync test fixture'), 0);
  out.set(ascii('POLYSYNC'), 256);
  out.set(ascii('2026-09-02'), 320);
  out.set(ascii('10:52:02'), 330);
  const view = new DataView(out.buffer);
  const low = timeReference >>> 0;
  const high = Math.floor(timeReference / 0x1_0000_0000);
  view.setUint32(338, low, true);
  view.setUint32(342, high, true);
  view.setUint16(346, 1, true);
  return out;
}

function writeSample(view: DataView, at: number, v: number, bits: number, isFloat: boolean): void {
  const clamped = Math.max(-1, Math.min(1, v));
  if (isFloat) {
    if (bits === 32) view.setFloat32(at, clamped, true);
    else view.setFloat64(at, clamped, true);
    return;
  }
  switch (bits) {
    case 8:
      view.setUint8(at, Math.round(clamped * 127) + 128);
      break;
    case 16:
      view.setInt16(at, Math.round(clamped * 32767), true);
      break;
    case 24: {
      const n = Math.round(clamped * 8388607);
      view.setUint8(at, n & 0xff);
      view.setUint8(at + 1, (n >> 8) & 0xff);
      view.setUint8(at + 2, (n >> 16) & 0xff);
      break;
    }
    case 32:
      view.setInt32(at, Math.round(clamped * 2147483647), true);
      break;
    default:
      throw new Error(`fixture: cannot write ${bits}-bit samples`);
  }
}

// ------------------------------------------------------------------- MOV

function box(type: string, ...bodies: Uint8Array[]): Uint8Array {
  const body = concatBytes(bodies);
  return concatBytes([u32be(body.length + 8), ascii(type, 4), body]);
}

export interface MovFixtureOptions {
  /** Frame count since midnight, as the `tmcd` sample stores it. */
  startFrames: number;
  timeScale?: number;
  frameDuration?: number;
  numberOfFrames?: number;
  dropFrame?: boolean;
  /** Put `moov` at the end, as every camera does. */
  moovAtEnd?: boolean;
}

/**
 * A minimal QuickTime file carrying a timecode track and nothing else.
 *
 * Not playable — it has no media track — but structurally what a `tmcd` reader
 * has to walk: a `trak` whose handler is `tmcd`, a sample description holding
 * the rate and the drop-frame flag, and a single 32-bit sample in `mdat` that
 * `stco` points at.
 */
export function makeMovWithTimecode(options: MovFixtureOptions): Uint8Array {
  const timeScale = options.timeScale ?? 25;
  const frameDuration = options.frameDuration ?? 1;
  const numberOfFrames = options.numberOfFrames ?? Math.round(timeScale / frameDuration);
  const flags = options.dropFrame ? 1 : 0;

  const ftyp = box('ftyp', ascii('qt  ', 4), u32be(512), ascii('qt  ', 4));
  const sampleBytes = u32be(options.startFrames);

  // Build mdat first so the sample's absolute file offset is known: stco holds
  // an offset from the start of the file, not from moov.
  const buildMoov = (sampleOffset: number) => {
    const hdlr = box(
      'hdlr',
      u32be(0), // version + flags
      u32be(0), // pre_defined
      ascii('tmcd', 4),
      new Uint8Array(12), // reserved
      new Uint8Array(1), // empty name
    );

    // size(4) 'tmcd'(4) reserved(6) dri(2) reserved(4) flags(4)
    //   timeScale(4) frameDuration(4) numberOfFrames(1) reserved(1)
    const tmcdEntry = concatBytes([
      u32be(34),
      ascii('tmcd', 4),
      new Uint8Array(6),
      u16le(1),
      u32be(0),
      u32be(flags),
      u32be(timeScale),
      u32be(frameDuration),
      new Uint8Array([numberOfFrames, 0]),
    ]);
    const stsd = box('stsd', u32be(0), u32be(1), tmcdEntry);
    const stsz = box('stsz', u32be(0), u32be(4), u32be(1));
    const stco = box('stco', u32be(0), u32be(1), u32be(sampleOffset));
    const stbl = box('stbl', stsd, stsz, stco);
    const minf = box('minf', stbl);
    const mdia = box('mdia', hdlr, minf);
    const trak = box('trak', mdia);
    return box('moov', trak);
  };

  if (options.moovAtEnd) {
    const mdat = box('mdat', sampleBytes);
    const sampleOffset = ftyp.length + 8; // past mdat's own 8-byte header
    return concatBytes([ftyp, mdat, buildMoov(sampleOffset)]);
  }

  // moov first: its length depends on nothing variable here, so one pass with a
  // placeholder then a rebuild at the true offset is exact.
  const placeholder = buildMoov(0);
  const sampleOffset = ftyp.length + placeholder.length + 8;
  const mdat = box('mdat', sampleBytes);
  return concatBytes([ftyp, buildMoov(sampleOffset), mdat]);
}

// ------------------------------------------------------------------ signals

/** A repeatable pseudo-random signal with transients — what correlation locks onto. */
export function noiseBurst(frames: number, seed = 1): Float64Array {
  const x = new Float64Array(frames);
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  for (let i = 0; i < frames; i++) {
    x[i] = 0.3 * rand();
    if (i % 4001 === 0) x[i] += 0.7;
  }
  return x;
}

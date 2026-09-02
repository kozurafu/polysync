/**
 * RIFF/WAVE and RF64 reading, with no dependencies.
 *
 * This is rung 1 of the codec ladder and the only rung that is guaranteed on
 * every browser, because it needs no codec support at all — the samples are
 * already PCM. Every sound recorder writes this format, and the recorder is
 * the reference track for most real syncs, so this path is the one that must
 * never fail.
 *
 * Two things a general-purpose WAV library would not give us:
 *
 *   - **RF64.** A recorder rolling for more than about four hours at 48 kHz
 *     stereo crosses the 4 GB that a 32-bit RIFF size field can express, and
 *     writes RF64 with a `ds64` chunk carrying the real 64-bit sizes instead.
 *     A reader that trusts the 32-bit field sees a file of length 0xFFFFFFFF.
 *   - **`bext` and iXML**, which is where the timecode and the channel names
 *     live. `wavefile` reads them but loads the entire file into memory first,
 *     which is exactly what we cannot do.
 *
 * Everything here reads through `ByteSource`, so the data chunk is never held
 * in memory — only the block currently being converted.
 */

import { cString, fourCC, readView, type ByteSource } from './source.js';

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** True for IEEE float samples (format tag 3), false for integer PCM. */
  isFloat: boolean;
  /** Bytes per frame across all channels. */
  blockAlign: number;
}

export interface WavInfo {
  format: PcmFormat;
  /** Absolute file offset of the first sample byte. */
  dataOffset: number;
  /** Length of the sample data in bytes. */
  dataLength: number;
  frameCount: number;
  durationSeconds: number;
  /** Raw `bext` chunk body, for `@polysync/timecode` to parse. */
  bextBytes?: Uint8Array;
  /** iXML chunk body, decoded as UTF-8. */
  ixmlText?: string;
  /** `INAM`/`ISFT` style tags from a `LIST INFO` chunk, if present. */
  info?: Record<string, string>;
  /** True when the file declared itself RF64 rather than RIFF. */
  rf64: boolean;
}

const FORMAT_PCM = 0x0001;
const FORMAT_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;

/** True if the first bytes look like a RIFF/WAVE or RF64 file. */
export async function isWav(src: ByteSource): Promise<boolean> {
  if (src.size < 12) return false;
  const head = await readView(src, 0, 12);
  const riff = fourCC(head, 0);
  return (riff === 'RIFF' || riff === 'RF64') && fourCC(head, 8) === 'WAVE';
}

/**
 * Read the header chunks. Reads only chunk headers plus the small metadata
 * chunks — the sample data is skipped over, never read.
 */
export async function readWav(src: ByteSource): Promise<WavInfo> {
  if (src.size < 12) throw new Error(`${src.name}: too short to be a WAV`);
  const head = await readView(src, 0, 12);
  const riff = fourCC(head, 0);
  if ((riff !== 'RIFF' && riff !== 'RF64') || fourCC(head, 8) !== 'WAVE') {
    throw new Error(`${src.name}: not a RIFF/WAVE file`);
  }
  const rf64 = riff === 'RF64';

  let format: PcmFormat | undefined;
  let dataOffset = -1;
  let dataLength = -1;
  let bextBytes: Uint8Array | undefined;
  let ixmlText: string | undefined;
  let info: Record<string, string> | undefined;
  // RF64 stores the real data size here; the data chunk's own field is -1.
  let ds64DataLength: number | undefined;

  let p = 12;
  while (p + 8 <= src.size) {
    const header = await readView(src, p, 8);
    const id = fourCC(header, 0);
    const declared = header.getUint32(4, true);
    const bodyStart = p + 8;

    // 0xFFFFFFFF is RF64's "look in ds64 instead" sentinel.
    let size = declared === 0xffffffff ? -1 : declared;

    switch (id) {
      case 'ds64': {
        const body = await readView(src, bodyStart, Math.min(declared, 28));
        // riffSize(8) dataSize(8) sampleCount(8) tableLength(4)
        ds64DataLength = Number(body.getBigUint64(8, true));
        break;
      }
      case 'fmt ': {
        format = parseFmt(await readView(src, bodyStart, Math.min(size, 40)), src.name);
        break;
      }
      case 'data': {
        dataOffset = bodyStart;
        dataLength = size >= 0 ? size : (ds64DataLength ?? src.size - bodyStart);
        // Some recorders write a data size that overruns the actual file when
        // a card is pulled mid-take. Trust the file length over the header.
        dataLength = Math.min(dataLength, src.size - bodyStart);
        size = dataLength;
        break;
      }
      case 'bext': {
        if (size > 0) bextBytes = await src.read(bodyStart, bodyStart + size);
        break;
      }
      case 'iXML': {
        if (size > 0) {
          const bytes = await src.read(bodyStart, bodyStart + size);
          ixmlText = new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '');
        }
        break;
      }
      case 'LIST': {
        if (size > 4) info = await readListInfo(src, bodyStart, size);
        break;
      }
      default:
        break;
    }

    if (size < 0) break; // an unknown chunk of unknown length; stop walking
    // RIFF chunks are word-aligned: an odd body is followed by a pad byte.
    p = bodyStart + size + (size % 2);
  }

  if (!format) throw new Error(`${src.name}: no fmt chunk`);
  if (dataOffset < 0) throw new Error(`${src.name}: no data chunk`);

  const frameCount = Math.floor(dataLength / format.blockAlign);
  return {
    format,
    dataOffset,
    dataLength,
    frameCount,
    durationSeconds: frameCount / format.sampleRate,
    bextBytes,
    ixmlText,
    info,
    rf64,
  };
}

function parseFmt(view: DataView, name: string): PcmFormat {
  if (view.byteLength < 16) throw new Error(`${name}: fmt chunk too short`);
  let tag = view.getUint16(0, true);
  const channels = view.getUint16(2, true);
  const sampleRate = view.getUint32(4, true);
  const blockAlign = view.getUint16(12, true);
  const bitsPerSample = view.getUint16(14, true);

  if (tag === FORMAT_EXTENSIBLE) {
    // WAVE_FORMAT_EXTENSIBLE hides the real tag in the first two bytes of the
    // SubFormat GUID. Multi-channel recorders write this rather than plain PCM.
    if (view.byteLength >= 26) tag = view.getUint16(24, true);
    else tag = FORMAT_PCM;
  }
  if (tag !== FORMAT_PCM && tag !== FORMAT_FLOAT) {
    throw new Error(`${name}: WAV format tag 0x${tag.toString(16)} is not PCM or float`);
  }
  if (!channels || !sampleRate || !bitsPerSample) {
    throw new Error(`${name}: fmt chunk declares no channels, rate or bit depth`);
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    isFloat: tag === FORMAT_FLOAT,
    blockAlign: blockAlign || Math.ceil((bitsPerSample / 8) * channels),
  };
}

async function readListInfo(
  src: ByteSource,
  start: number,
  size: number,
): Promise<Record<string, string> | undefined> {
  const bytes = await src.read(start, start + size);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourCC(view, 0) !== 'INFO') return undefined;
  const out: Record<string, string> = {};
  let p = 4;
  while (p + 8 <= bytes.length) {
    const id = fourCC(view, p);
    const len = view.getUint32(p + 4, true);
    if (p + 8 + len > bytes.length) break;
    out[id] = cString(bytes.subarray(p + 8, p + 8 + len));
    p += 8 + len + (len % 2);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Stream the sample data as mono `Float64Array` blocks.
 *
 * Channels are averaged rather than summed, so a stereo file and a mono file of
 * the same material come out at the same level and the RMS normalisation in
 * `sync-core` has nothing to undo.
 *
 * `blockFrames` bounds peak memory: at the default, a block is about 8 MB of
 * float64 regardless of how long the file is.
 */
export async function streamWavMono(
  src: ByteSource,
  wav: WavInfo,
  onBlock: (block: Float64Array) => void | Promise<void>,
  blockFrames = 1 << 20,
): Promise<void> {
  const { blockAlign, channels, bitsPerSample, isFloat } = wav.format;
  const bytesPerSample = bitsPerSample >> 3;
  if (bytesPerSample < 1) throw new Error(`${src.name}: bit depth ${bitsPerSample} unsupported`);

  const read = sampleReader(bitsPerSample, isFloat, src.name);
  let frame = 0;
  while (frame < wav.frameCount) {
    const count = Math.min(blockFrames, wav.frameCount - frame);
    const start = wav.dataOffset + frame * blockAlign;
    const bytes = await src.read(start, start + count * blockAlign);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const usable = Math.min(count, Math.floor(bytes.length / blockAlign));

    const out = new Float64Array(usable);
    for (let i = 0; i < usable; i++) {
      const base = i * blockAlign;
      let acc = 0;
      for (let c = 0; c < channels; c++) acc += read(view, base + c * bytesPerSample);
      out[i] = acc / channels;
    }
    await onBlock(out);

    frame += usable;
    if (usable < count) break; // short read: the file ended early
  }
}

/**
 * A reader for one sample, returning -1..1.
 *
 * Chosen once per file rather than branched per sample — this is the innermost
 * loop in the whole ingest path, and it runs a few billion times on a shoot day.
 */
function sampleReader(bits: number, isFloat: boolean, name: string): (v: DataView, o: number) => number {
  if (isFloat) {
    if (bits === 32) return (v, o) => v.getFloat32(o, true);
    if (bits === 64) return (v, o) => v.getFloat64(o, true);
    throw new Error(`${name}: ${bits}-bit float WAV is not a thing`);
  }
  switch (bits) {
    case 8:
      // 8-bit WAV is unsigned, biased by 128. Every other depth is signed.
      return (v, o) => (v.getUint8(o) - 128) / 128;
    case 16:
      return (v, o) => v.getInt16(o, true) / 32768;
    case 24:
      return (v, o) => {
        const lo = v.getUint8(o);
        const mid = v.getUint8(o + 1);
        const hi = v.getInt8(o + 2); // sign lives in the top byte
        return ((hi << 16) | (mid << 8) | lo) / 8388608;
      };
    case 32:
      return (v, o) => v.getInt32(o, true) / 2147483648;
    default:
      throw new Error(`${name}: ${bits}-bit PCM is unsupported`);
  }
}

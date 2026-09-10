/**
 * The one entry point the rest of the app uses: a source of bytes in, an
 * `AudioClip` out.
 *
 * Everything codec-specific stops here. `sync-core` above this never sees a
 * container, a codec or a byte — only `Float64Array` and a sample rate, which
 * is what lets it be tested exhaustively in Node and swapped for a WASM kernel
 * later without touching anything else.
 */

import type { AudioClip } from '@polysync/sync-core';
import {
  bwfStartSeconds,
  ixmlFrameRate,
  parseBext,
  parseIXml,
  parseMoovTimecode,
  timecodeFromSample,
  type BextInfo,
  type IXmlInfo,
} from '@polysync/timecode';
import { probeContainer, streamContainerMono, UndecodableAudioError } from './container.js';
import { chooseWorkingRate, StreamingDecimator } from './derive.js';
import { readMoov } from './iso.js';
import type { ByteSource } from './source.js';
import { isWav, readWav, streamWavMono, type WavInfo } from './wav.js';

export interface ProbeResult {
  name: string;
  durationSeconds: number;
  /** Native sample rate of the source, before any decimation. */
  sampleRate: number;
  channels: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  /** Start timecode in seconds since midnight, if the file carried one. */
  timecodeSeconds?: number;
  /** Where that timecode came from — worth showing, because they disagree. */
  timecodeSource?: 'tmcd' | 'bext';
  /**
   * When the recording started, seconds since epoch, *as stated by the file*.
   *
   * Distinct from `File.lastModified` in the only way that matters: this one
   * survives being copied, and is therefore the only kind of timestamp the sync
   * gates are allowed to rule a pair out on.
   */
  recordedAtSeconds?: number;
  /** Per-channel names from iXML TRACK_LIST, e.g. ["Boom", "Lav1"]. */
  channelNames?: string[];
  /** True when the audio can actually be decoded in this environment. */
  decodable: boolean;
  /** Populated when `decodable` is false: what to tell the user. */
  undecodableReason?: string;
}

export interface IngestOptions {
  /** Sample rate to decode down to. Defaults to the `chooseWorkingRate` policy. */
  workingRate?: number;
  /**
   * Filesystem modification time, seconds since epoch — `File.lastModified` in
   * a browser. Used only when the file itself states no recording time, and
   * flagged as untrusted when it is, so nothing gates on it.
   */
  recordedAtSeconds?: number;
  /** Called with this file's decode progress as a 0..1 fraction. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface IngestResult {
  probe: ProbeResult;
  clip: AudioClip;
}

/**
 * Read metadata without decoding any audio.
 *
 * Cheap enough to run across a whole card before deciding what to ingest:
 * header reads, plus for a MOV the `moov` box and four bytes of `mdat`.
 */
export async function probe(src: ByteSource): Promise<ProbeResult> {
  if (await isWav(src)) return probeWav(src);
  return probeMedia(src);
}

async function probeWav(src: ByteSource): Promise<ProbeResult> {
  const wav = await readWav(src);
  const { bext, ixml } = wavMetadata(wav);
  const start = bwfStartSeconds(bext, ixml, wav.format.sampleRate);
  const depth = wav.format.bitsPerSample;

  return {
    name: src.name,
    durationSeconds: wav.durationSeconds,
    sampleRate: wav.format.sampleRate,
    channels: wav.format.channels,
    hasVideo: false,
    hasAudio: true,
    audioCodec: wav.format.isFloat ? `pcm-f${depth}` : `pcm-s${depth}`,
    frameRate: ixmlFrameRate(ixml),
    timecodeSeconds: start,
    timecodeSource: start !== undefined ? 'bext' : undefined,
    recordedAtSeconds: bextOriginationSeconds(bext),
    channelNames: ixml?.trackNames,
    decodable: true,
  };
}

async function probeMedia(src: ByteSource): Promise<ProbeResult> {
  const info = await probeContainer(src);
  const tc = await readTmcd(src);

  const result: ProbeResult = {
    name: src.name,
    durationSeconds: info.durationSeconds,
    sampleRate: info.sampleRate ?? 0,
    channels: info.channels ?? 0,
    hasVideo: info.hasVideo,
    hasAudio: info.hasAudio,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    width: info.width,
    height: info.height,
    frameRate: tc?.frameRate,
    timecodeSeconds: tc?.startSeconds,
    timecodeSource: tc ? 'tmcd' : undefined,
    decodable: info.decodable,
  };

  if (!info.hasAudio) {
    result.undecodableReason = `${src.name}: no audio track, so there is nothing to sync on`;
  } else if (!info.decodable) {
    result.undecodableReason = new UndecodableAudioError(
      src.name,
      info.audioCodec ?? 'unknown',
    ).message;
  }
  return result;
}

/** Read the `tmcd` track: `moov` for the descriptor, then the sample from `mdat`. */
async function readTmcd(src: ByteSource) {
  try {
    const moov = await readMoov(src);
    if (!moov) return undefined;
    const desc = parseMoovTimecode(moov);
    if (!desc) return undefined;
    const wanted = Math.max(4, desc.sampleSize);
    const sample = await src.read(desc.sampleOffset, desc.sampleOffset + wanted);
    if (sample.length < 4) return undefined;
    return timecodeFromSample(desc, sample);
  } catch {
    // A malformed atom costs us the timecode, never the ingest. Timecode is a
    // seed and a cross-check here, never a requirement — audio sync works
    // without it, which is the entire point of the tool.
    return undefined;
  }
}

/**
 * `bext` origination date and time as an instant, or undefined.
 *
 * The two fields are `YYYY-MM-DD` and `HH:MM:SS` with no timezone, so they are
 * read as UTC. That is a fiction — they are local wall-clock time at the
 * recorder — but a consistent one: every clip on a shoot is offset by the same
 * amount, so differences between them, which is all the gate ever looks at,
 * come out right. Recorders that leave the fields blank or zeroed are common
 * enough that anything unparseable has to mean "no answer" rather than 1970.
 */
export function bextOriginationSeconds(bext: BextInfo | undefined): number | undefined {
  if (!bext) return undefined;
  const date = /^(\d{4})[-:/](\d{2})[-:/](\d{2})$/.exec(bext.originationDate.trim());
  const time = /^(\d{2}):(\d{2}):(\d{2})$/.exec(bext.originationTime.trim());
  if (!date || !time) return undefined;
  const [, y, mo, d] = date.map(Number);
  const [, h, mi, sec] = time.map(Number);
  // A recorder with a dead clock writes 1970 or 0000; neither is a shoot.
  if (y < 1990 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  if (h > 23 || mi > 59 || sec > 59) return undefined;
  return Date.UTC(y, mo - 1, d, h, mi, sec) / 1000;
}

function wavMetadata(wav: WavInfo): { bext?: BextInfo; ixml?: IXmlInfo } {
  return {
    bext: wav.bextBytes ? parseBext(wav.bextBytes) : undefined,
    ixml: wav.ixmlText ? parseIXml(wav.ixmlText) : undefined,
  };
}

/**
 * Decode a file to the mono signal the sync engine correlates.
 *
 * Decimation happens *during* decode, so peak memory is one decode block plus
 * the output. An hour of mono at 48 kHz would be 1.4 GB of float64; at the
 * default working rate it is 460 MB, and a four-hour recorder file stays
 * tractable rather than failing outright.
 */
export async function ingest(
  src: ByteSource,
  id: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const info = await probe(src);
  if (!info.hasAudio) throw new Error(info.undecodableReason ?? `${src.name}: no audio track`);
  if (!info.decodable) throw new Error(info.undecodableReason ?? `${src.name}: cannot decode audio`);

  const frameCount = Math.round(info.durationSeconds * info.sampleRate);
  const workingRate = options.workingRate ?? chooseWorkingRate(info.sampleRate, frameCount);
  const factor = Math.max(1, Math.round(info.sampleRate / workingRate));
  const decimator = new StreamingDecimator(factor);

  const chunks: Float64Array[] = [];
  let decodedFrames = 0;
  const consume = (block: Float64Array) => {
    if (options.signal?.aborted) throw new Error(`${src.name}: ingest aborted`);
    const out = decimator.push(block);
    if (out.length) chunks.push(out);
    decodedFrames += block.length;
    if (frameCount) options.onProgress?.(Math.min(1, decodedFrames / frameCount));
  };

  if (await isWav(src)) {
    const wav = await readWav(src);
    await streamWavMono(src, wav, consume);
  } else {
    await streamContainerMono(src, (block) => consume(block));
  }
  const tail = decimator.flush();
  if (tail.length) chunks.push(tail);
  options.onProgress?.(1);

  const clip: AudioClip = {
    id,
    name: src.name,
    samples: concat(chunks),
    sampleRate: info.sampleRate / factor,
    timecodeSeconds: info.timecodeSeconds,
    // The file's own account of when it was recorded beats the filesystem's
    // account of when it was last written, every time.
    recordedAtSeconds: info.recordedAtSeconds ?? options.recordedAtSeconds,
    recordedAtSource: info.recordedAtSeconds !== undefined ? 'metadata' : 'filesystem',
    frameRate: info.frameRate,
  };
  return { probe: info, clip };
}

function concat(chunks: Float64Array[]): Float64Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float64Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

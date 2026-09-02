/**
 * Broadcast Wave metadata: the `bext` chunk and the iXML chunk.
 *
 * This is where a sound recorder puts its timecode, and no JavaScript library
 * reads it properly — `wavefile` gets close but loads the whole file into
 * memory, which is unusable on a four-hour poly-WAV.
 *
 * These functions are deliberately pure: they take the chunk bytes and return
 * a value. Locating the chunks is `media-io`'s job, which keeps this package
 * dependency-free and testable against a handful of bytes.
 */

/** EBU Tech 3285 broadcast extension. Fields past `timeReference` are rarely useful. */
export interface BextInfo {
  description: string;
  originator: string;
  originatorReference: string;
  /** `YYYY-MM-DD` as written by the recorder. Not validated. */
  originationDate: string;
  /** `HH:MM:SS` as written by the recorder. */
  originationTime: string;
  /**
   * Samples since midnight at the *timecode* sample rate. This is the start
   * timecode, and the only field here that matters for sync.
   */
  timeReference: number;
  version: number;
  codingHistory: string;
}

export interface IXmlInfo {
  /** `<SPEED><TIMECODE_RATE>` as a rational, e.g. 25/1 or 30000/1001. */
  timecodeRate?: { numerator: number; denominator: number };
  /** True when `<TIMECODE_FLAG>` is `DF`. */
  dropFrame?: boolean;
  /**
   * `<SPEED><TIMECODE_SAMPLE_RATE>`. **Read this carefully.** On a pull-up or
   * pull-down recording it differs from the file's own sample rate, and
   * dividing `timeReference` by the wrong one produces a start offset that
   * drifts — the classic, near-undiagnosable sync bug.
   */
  timecodeSampleRate?: number;
  fileSampleRate?: number;
  /** Per-channel names from `<TRACK_LIST>`, indexed by channel number - 1. */
  trackNames?: string[];
  project?: string;
  scene?: string;
  take?: string;
  note?: string;
}

const BEXT_MIN_SIZE = 602;

/** Parse a `bext` chunk body. Returns undefined if it is too short to be one. */
export function parseBext(bytes: Uint8Array): BextInfo | undefined {
  if (bytes.length < BEXT_MIN_SIZE) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => latin1(bytes.subarray(offset, offset + length));

  // The two halves of a 64-bit sample count, little-endian, stored as separate
  // 32-bit fields. Recombined through Number, which is exact to 2^53 — about
  // 5,700 years of samples at 48 kHz.
  const low = view.getUint32(338, true);
  const high = view.getUint32(342, true);

  return {
    description: text(0, 256),
    originator: text(256, 32),
    originatorReference: text(288, 32),
    originationDate: text(320, 10),
    originationTime: text(330, 8),
    timeReference: high * 0x1_0000_0000 + low,
    version: view.getUint16(346, true),
    codingHistory: bytes.length > BEXT_MIN_SIZE ? latin1(bytes.subarray(BEXT_MIN_SIZE)) : '',
  };
}

/**
 * Parse an iXML chunk.
 *
 * Hand-rolled rather than DOM-parsed: `DOMParser` does not exist in a worker
 * without a shim, iXML from real recorders is frequently not well-formed
 * (unescaped ampersands in scene names are common), and we want four fields
 * out of it. A forgiving regex reader gets those four from a file a strict
 * parser would reject outright.
 */
export function parseIXml(xml: string): IXmlInfo {
  const info: IXmlInfo = {};

  const rate = tag(xml, 'TIMECODE_RATE');
  if (rate) {
    const m = /^\s*(\d+)\s*(?:\/\s*(\d+))?\s*$/.exec(rate);
    if (m) info.timecodeRate = { numerator: Number(m[1]), denominator: m[2] ? Number(m[2]) : 1 };
  }

  const flag = tag(xml, 'TIMECODE_FLAG');
  if (flag) info.dropFrame = flag.trim().toUpperCase() === 'DF';

  const tcsr = numberTag(xml, 'TIMECODE_SAMPLE_RATE');
  if (tcsr !== undefined) info.timecodeSampleRate = tcsr;
  const fsr = numberTag(xml, 'FILE_SAMPLE_RATE');
  if (fsr !== undefined) info.fileSampleRate = fsr;

  info.project = tag(xml, 'PROJECT');
  info.scene = tag(xml, 'SCENE');
  info.take = tag(xml, 'TAKE');
  info.note = tag(xml, 'NOTE');

  const names = parseTrackList(xml);
  if (names.length) info.trackNames = names;

  return info;
}

/**
 * `<TRACK_LIST>` channel names, indexed by channel number - 1.
 *
 * Sound Devices and Zaxcom both write this, and it is the difference between
 * showing an editor "Boom / Lav1 / Lav2" and showing them "ch1 / ch2 / ch3".
 */
function parseTrackList(xml: string): string[] {
  const list = tagBlock(xml, 'TRACK_LIST');
  if (!list) return [];
  const names: string[] = [];
  for (const m of list.matchAll(/<TRACK\b[^>]*>([\s\S]*?)<\/TRACK>/gi)) {
    const track = m[1];
    const index = numberTag(track, 'CHANNEL_INDEX');
    const name = tag(track, 'NAME');
    if (name === undefined) continue;
    const slot = index !== undefined && index >= 1 ? index - 1 : names.length;
    names[slot] = name;
  }
  for (let i = 0; i < names.length; i++) if (names[i] === undefined) names[i] = '';
  return names;
}

/**
 * Start position in seconds since midnight.
 *
 * `fileSampleRate` is the fallback divisor and is used only when iXML does not
 * declare a timecode sample rate — see the warning on `timecodeSampleRate`.
 */
export function bwfStartSeconds(
  bext: BextInfo | undefined,
  ixml: IXmlInfo | undefined,
  fileSampleRate: number,
): number | undefined {
  if (!bext || !Number.isFinite(bext.timeReference)) return undefined;
  const rate = ixml?.timecodeSampleRate ?? fileSampleRate;
  if (!rate || rate <= 0) return undefined;
  return bext.timeReference / rate;
}

/** Frames per second implied by iXML, or undefined if it did not say. */
export function ixmlFrameRate(ixml: IXmlInfo | undefined): number | undefined {
  const r = ixml?.timecodeRate;
  if (!r || !r.denominator) return undefined;
  return r.numerator / r.denominator;
}

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decodeEntities(m[1].trim()) : undefined;
}

function tagBlock(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? m[1] : undefined;
}

function numberTag(xml: string, name: string): number | undefined {
  const raw = tag(xml, name);
  if (raw === undefined) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function latin1(bytes: Uint8Array): string {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  let out = '';
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out.trim();
}

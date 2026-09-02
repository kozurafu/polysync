/**
 * QuickTime / ISO-BMFF timecode tracks (`tmcd`).
 *
 * Verified absent from both `mp4box.js` 2.4.1 and `mediabunny` 1.55.5 — neither
 * contains any `tmcd` handling at all — so this is written from the QuickTime
 * File Format specification.
 *
 * How a MOV stores its start timecode, which is less obvious than it sounds:
 *
 *   - A separate track whose media handler type is `tmcd`.
 *   - Its sample description carries the *rate* (`timeScale / frameDuration`),
 *     a nominal `numberOfFrames` for the FF field, and a flags word whose
 *     bit 0 is the drop-frame flag.
 *   - The start value itself is a **single 32-bit big-endian sample** holding a
 *     frame count since midnight — and that sample lives in `mdat`, not in
 *     `moov`. So parsing is necessarily two steps: read the box tree to find
 *     out *where* the sample is, then read those four bytes.
 *
 * Hence `parseMoovTimecode` returns a descriptor including the sample's file
 * offset, and the caller reads it and calls `timecodeFromSample`.
 */

/** What `moov` tells us about a timecode track, minus the sample itself. */
export interface TmcdDescriptor {
  /** Absolute file offset of the 32-bit frame-count sample. */
  sampleOffset: number;
  sampleSize: number;
  /** Rate numerator; with `frameDuration` gives the true frame rate. */
  timeScale: number;
  frameDuration: number;
  /** Nominal frames per second used for the FF field: 24, 25, 30, 50, 60. */
  numberOfFrames: number;
  dropFrame: boolean;
  /** True frame rate, e.g. 30000/1001 = 29.97. */
  frameRate: number;
}

export interface TmcdTimecode extends TmcdDescriptor {
  /** Frame count since midnight, straight from the sample. */
  startFrames: number;
  /** Start position in seconds since midnight — what the sync engine wants. */
  startSeconds: number;
}

interface Box {
  type: string;
  /** Offset of the box's payload, relative to the buffer the walk started in. */
  start: number;
  /** One past the last payload byte. */
  end: number;
}

/**
 * Walk the boxes directly inside `[start, end)`.
 *
 * Tolerant by design: a zero or overlong size terminates the walk rather than
 * throwing, because a truncated or slightly malformed atom near the end of a
 * camera file should cost us the timecode, not the whole ingest.
 */
function* boxes(bytes: Uint8Array, start: number, end: number): Generator<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(
      view.getUint8(p + 4),
      view.getUint8(p + 5),
      view.getUint8(p + 6),
      view.getUint8(p + 7),
    );
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      // 64-bit size. Number is exact past any plausible atom length.
      size = Number(view.getBigUint64(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p; // extends to the end of its container
    }
    if (size < header || p + size > end) return;
    yield { type, start: p + header, end: p + size };
    p += size;
  }
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string): Box | undefined {
  for (const box of boxes(bytes, start, end)) if (box.type === type) return box;
  return undefined;
}

/** Follow a path of box types down the tree, e.g. `mdia/minf/stbl`. */
function descend(bytes: Uint8Array, box: Box, path: string[]): Box | undefined {
  let current: Box | undefined = box;
  for (const type of path) {
    if (!current) return undefined;
    current = findBox(bytes, current.start, current.end, type);
  }
  return current;
}

/**
 * Find the timecode track in a `moov` buffer.
 *
 * `sampleOffset` comes back as an absolute file offset, because `stco` chunk
 * offsets are measured from the start of the file rather than from `moov` —
 * so the caller can read those bytes directly without knowing where `moov` sat.
 */
export function parseMoovTimecode(moov: Uint8Array): TmcdDescriptor | undefined {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);

  for (const trak of boxes(moov, 0, moov.length)) {
    if (trak.type !== 'trak') continue;

    const hdlr = descend(moov, trak, ['mdia', 'hdlr']);
    if (!hdlr || hdlr.end - hdlr.start < 12) continue;
    // FullBox: version(1) + flags(3), then pre_defined(4), then handler_type.
    const handler = String.fromCharCode(
      view.getUint8(hdlr.start + 8),
      view.getUint8(hdlr.start + 9),
      view.getUint8(hdlr.start + 10),
      view.getUint8(hdlr.start + 11),
    );
    if (handler !== 'tmcd') continue;

    const stbl = descend(moov, trak, ['mdia', 'minf', 'stbl']);
    if (!stbl) continue;

    const desc = parseTmcdSampleEntry(moov, view, stbl);
    if (!desc) continue;

    const sampleOffset = firstChunkOffset(moov, view, stbl);
    if (sampleOffset === undefined) continue;

    return { ...desc, sampleOffset, sampleSize: sampleSizeOf(moov, view, stbl) };
  }
  return undefined;
}

function parseTmcdSampleEntry(
  moov: Uint8Array,
  view: DataView,
  stbl: Box,
): Omit<TmcdDescriptor, 'sampleOffset' | 'sampleSize'> | undefined {
  const stsd = findBox(moov, stbl.start, stbl.end, 'stsd');
  if (!stsd) return undefined;
  // FullBox(4) + entry_count(4); entries follow.
  let p = stsd.start + 8;
  while (p + 16 <= stsd.end) {
    const entrySize = view.getUint32(p);
    const format = String.fromCharCode(
      view.getUint8(p + 4),
      view.getUint8(p + 5),
      view.getUint8(p + 6),
      view.getUint8(p + 7),
    );
    if (entrySize < 16) return undefined;
    if (format === 'tmcd' && p + 34 <= stsd.end) {
      // size(4) format(4) reserved(6) data_reference_index(2) = 16, then:
      //   reserved(4) flags(4) timeScale(4) frameDuration(4) numberOfFrames(1)
      const flags = view.getUint32(p + 20);
      const timeScale = view.getUint32(p + 24);
      const frameDuration = view.getUint32(p + 28);
      const numberOfFrames = view.getUint8(p + 32);
      if (!timeScale || !frameDuration) return undefined;
      return {
        timeScale,
        frameDuration,
        numberOfFrames: numberOfFrames || Math.round(timeScale / frameDuration),
        dropFrame: (flags & 0x1) !== 0,
        frameRate: timeScale / frameDuration,
      };
    }
    p += entrySize;
  }
  return undefined;
}

/** The timecode track has exactly one sample, so its chunk offset is its offset. */
function firstChunkOffset(moov: Uint8Array, view: DataView, stbl: Box): number | undefined {
  const stco = findBox(moov, stbl.start, stbl.end, 'stco');
  if (stco && stco.end - stco.start >= 12 && view.getUint32(stco.start + 4) >= 1) {
    return view.getUint32(stco.start + 8);
  }
  const co64 = findBox(moov, stbl.start, stbl.end, 'co64');
  if (co64 && co64.end - co64.start >= 16 && view.getUint32(co64.start + 4) >= 1) {
    return Number(view.getBigUint64(co64.start + 8));
  }
  return undefined;
}

function sampleSizeOf(moov: Uint8Array, view: DataView, stbl: Box): number {
  const stsz = findBox(moov, stbl.start, stbl.end, 'stsz');
  if (!stsz || stsz.end - stsz.start < 12) return 4;
  const uniform = view.getUint32(stsz.start + 4);
  if (uniform) return uniform;
  return stsz.end - stsz.start >= 16 ? view.getUint32(stsz.start + 12) : 4;
}

/**
 * Combine the descriptor with the four sample bytes read from `mdat`.
 * `sample` must be at least `descriptor.sampleSize` bytes.
 */
export function timecodeFromSample(desc: TmcdDescriptor, sample: Uint8Array): TmcdTimecode {
  const view = new DataView(sample.buffer, sample.byteOffset, sample.byteLength);
  // Big-endian, always — this is a QuickTime structure, not a RIFF one.
  const startFrames = desc.sampleSize >= 4 ? view.getUint32(0) : view.getUint16(0);
  return {
    ...desc,
    startFrames,
    startSeconds: startFrames / desc.frameRate,
  };
}

/** Locate the top-level `moov` box in a buffer that begins at a box boundary. */
export function findMoov(bytes: Uint8Array): { start: number; end: number } | undefined {
  const box = findBox(bytes, 0, bytes.length, 'moov');
  return box ? { start: box.start, end: box.end } : undefined;
}

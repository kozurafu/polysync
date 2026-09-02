/**
 * Locating top-level boxes in an ISO-BMFF / QuickTime file.
 *
 * Only enough box walking to find `moov` and read it. `moov` sits at the head
 * of a faststart-remuxed file and at the *tail* of anything a camera wrote,
 * because its size is not known until recording stops — so a reader that only
 * looks at the first megabyte finds nothing on exactly the files we care about.
 *
 * Reads 16 bytes per box header, so finding a `moov` at the end of a 40 GB card
 * file costs a few hundred bytes of I/O, not a scan.
 */

import { fourCC, readView, type ByteSource } from './source.js';

export interface TopLevelBox {
  type: string;
  /** Offset of the payload, i.e. past the header. */
  start: number;
  end: number;
}

/** True if the file begins with something that looks like an ISO-BMFF box. */
export async function isIsoBmff(src: ByteSource): Promise<boolean> {
  if (src.size < 12) return false;
  const view = await readView(src, 0, 12);
  const type = fourCC(view, 4);
  return type === 'ftyp' || type === 'moov' || type === 'mdat' || type === 'free' || type === 'skip';
}

/** Walk the top-level boxes, yielding each without reading its payload. */
export async function* topLevelBoxes(src: ByteSource): AsyncGenerator<TopLevelBox> {
  let p = 0;
  while (p + 8 <= src.size) {
    const view = await readView(src, p, 16);
    if (view.byteLength < 8) return;
    let size = view.getUint32(0);
    const type = fourCC(view, 4);
    let header = 8;
    if (size === 1) {
      if (view.byteLength < 16) return;
      size = Number(view.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      size = src.size - p;
    }
    if (size < header || p + size > src.size) return;
    yield { type, start: p + header, end: p + size };
    p += size;
  }
}

/**
 * Read the `moov` payload.
 *
 * Returns undefined rather than throwing when there isn't one: a file with no
 * `moov` is not a MOV, and the caller has other things to try.
 */
export async function readMoov(
  src: ByteSource,
  maxBytes = 64 << 20,
): Promise<Uint8Array | undefined> {
  for await (const box of topLevelBoxes(src)) {
    if (box.type !== 'moov') continue;
    const length = box.end - box.start;
    // A moov this large means a corrupt header, not a real index; refuse it
    // rather than trying to allocate it.
    if (length > maxBytes) return undefined;
    return src.read(box.start, box.end);
  }
  return undefined;
}

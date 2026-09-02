/**
 * A lazily-readable run of bytes.
 *
 * Every parser in this package reads through this interface and never touches
 * `File`, `fs`, or a whole-file buffer. Three reasons, in order of how much
 * they matter:
 *
 * 1. A 200 GB card must never be held in memory. `File.slice()` is a range read
 *    against the on-disk file on every browser, and `fs.read` is the same in
 *    Node, so both back this interface without copying.
 * 2. The CLI harness in `tools/` runs the identical code path as the browser.
 *    Testing ingest without a UI is the whole point of Phase 1.
 * 3. Tests can hand parsers an in-memory buffer with no I/O at all.
 */
export interface ByteSource {
  /** Total length in bytes. */
  readonly size: number;
  /** Display name — usually the file name. Used for grouping and messages. */
  readonly name: string;
  /** Read `[start, end)`. May return fewer bytes only at end of source. */
  read(start: number, end: number): Promise<Uint8Array>;
}

/** A `ByteSource` over a browser `File` or `Blob`. */
export function blobSource(blob: Blob, name?: string): ByteSource {
  const label = name ?? (blob instanceof File ? blob.name : 'blob');
  return {
    size: blob.size,
    name: label,
    async read(start, end) {
      const clamped = Math.min(end, blob.size);
      if (clamped <= start) return new Uint8Array(0);
      return new Uint8Array(await blob.slice(start, clamped).arrayBuffer());
    },
  };
}

/** A `ByteSource` over an in-memory buffer. Used by tests and small sidecars. */
export function bytesSource(bytes: Uint8Array, name = 'bytes'): ByteSource {
  return {
    size: bytes.length,
    name,
    async read(start, end) {
      return bytes.subarray(Math.max(0, start), Math.min(end, bytes.length));
    },
  };
}

/**
 * Read a window and return a `DataView` over exactly those bytes.
 * The view's offset 0 corresponds to `start` in the source.
 */
export async function readView(src: ByteSource, start: number, length: number): Promise<DataView> {
  const bytes = await src.read(start, start + length);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Four-character code at `offset`, as ASCII. The universal container tag. */
export function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Latin-1 text, stopping at the first NUL. Container strings are NUL-padded. */
export function cString(bytes: Uint8Array): string {
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

/**
 * `ByteSource` over the Node filesystem.
 *
 * The whole reason `media-io` reads through an interface rather than `File`:
 * the CLI harness runs the identical ingest code the browser runs, so a bug
 * found at the command line is a bug found in the app.
 */

import { open, stat, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import type { ByteSource } from '@polysync/media-io';

/**
 * Open a file as a lazily-read byte source.
 *
 * The handle stays open for the life of the source. Callers ingest one file at
 * a time per worker, so this never approaches a descriptor limit — and holding
 * it open avoids reopening the file for every one of the thousands of range
 * reads a demuxer makes walking an index.
 */
export async function fileSource(path: string): Promise<ByteSource & { close(): Promise<void> }> {
  const info = await stat(path);
  const handle = await open(path, 'r');
  return {
    size: info.size,
    name: basename(path),
    async read(start, end) {
      const length = Math.max(0, Math.min(end, info.size) - start);
      if (length === 0) return new Uint8Array(0);
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
    },
    async close() {
      await handle.close();
    },
  };
}

export interface FoundFile {
  absolutePath: string;
  /** Path relative to the root that was scanned — what grouping and relinking use. */
  relativePath: string;
  size: number;
  lastModified: number;
}

/** Extensions worth opening. Anything else in a card folder is a sidecar. */
const MEDIA_EXTENSIONS = new Set([
  'wav', 'bwf', 'w64', 'rf64', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac',
  'mov', 'mp4', 'm4v', 'mkv', 'webm', 'mts', 'm2ts', 'm2t', 'ts', 'mxf', 'avi',
]);

/** Walk a folder for media files, skipping the noise every card carries. */
export async function findMedia(root: string): Promise<FoundFile[]> {
  const out: FoundFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable folder is not a reason to abandon the scan
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
      if (!MEDIA_EXTENSIONS.has(ext)) continue;
      const info = await stat(full);
      out.push({
        absolutePath: full,
        relativePath: relative(root, full).split(/[\\/]/).join('/'),
        size: info.size,
        lastModified: info.mtimeMs,
      });
    }
  }

  await walk(root);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

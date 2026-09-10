/**
 * Getting a folder of rushes into the page.
 *
 * Three routes, because the browsers genuinely differ:
 *
 *   - `showDirectoryPicker()` on Chromium: a real folder handle.
 *   - Folder drag-and-drop via `webkitGetAsEntry()`: works everywhere, Safari
 *     and Firefox included.
 *   - `<input webkitdirectory>`: the button that works everywhere.
 *
 * What matters is that all three produce the same thing — a `File` plus a path
 * relative to the dropped folder — and that reading is identical afterwards.
 * `File.slice()` is a lazy range read against the file on disk on every browser,
 * so a 200 GB card streams the same way regardless of how it was picked. What
 * Chromium buys is remembering the folder next time, not the ability to read it.
 */

import type { PickedFile } from './engine.ts';

const MEDIA_EXTENSIONS = new Set([
  'wav', 'bwf', 'w64', 'rf64', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac',
  'mov', 'mp4', 'm4v', 'mkv', 'webm', 'mts', 'm2ts', 'm2t', 'ts', 'mxf', 'avi',
]);

export function isMediaFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return MEDIA_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * The `accept` attribute for the file input.
 *
 * Both the extensions *and* the wildcards, deliberately. Camera formats like
 * MTS and MXF frequently have no MIME type registered on the machine, so a
 * wildcard-only list greys them out in the dialog; and an extension-only list
 * greys out anything with an unusual suffix. Listing both means the dialog is
 * filtered without ever disabling a file the app could actually read.
 */
export const MEDIA_ACCEPT = [
  ...[...MEDIA_EXTENSIONS].map((e) => `.${e}`),
  'video/*',
  'audio/*',
].join(',');

/** What a picker or a drop produced. */
export interface PickResult {
  files: PickedFile[];
  /** Names that were not media files, so the UI can say what it ignored. */
  ignored: string[];
}

/**
 * Add newly picked files to what is already loaded.
 *
 * Appending rather than replacing, because "Add media" means add. Dropping a
 * folder of camera files and then a folder of recorder files is the single most
 * common way to assemble a project, and replacing on the second drop threw the
 * first one away.
 *
 * Keyed on the relative path, so re-dropping the same folder updates in place
 * instead of duplicating every clip, and a file edited since the last drop
 * replaces the stale one rather than sitting alongside it.
 */
export function mergePicked(existing: PickedFile[], incoming: PickedFile[]): PickedFile[] {
  const seen = new Map(existing.map((p) => [p.relativePath, p]));
  for (const pick of incoming) seen.set(pick.relativePath, pick);
  return [...seen.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** Path, size and modification time — enough to tell whether a file changed. */
export function pickedIdentity(pick: PickedFile): string {
  return `${pick.relativePath}:${pick.file.size}:${pick.file.lastModified}`;
}

/** True when this browser can hand us a folder handle it will remember. */
export function hasDirectoryPicker(): boolean {
  return typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

interface DirectoryHandleLike {
  name: string;
  values(): AsyncIterable<FileSystemHandleLike>;
}
interface FileSystemHandleLike {
  kind: 'file' | 'directory';
  name: string;
  getFile?(): Promise<File>;
  values?(): AsyncIterable<FileSystemHandleLike>;
}

/** Chromium's folder picker. Rejects if the user cancels. */
export async function pickDirectory(): Promise<PickResult> {
  const picker = (window as unknown as { showDirectoryPicker: () => Promise<DirectoryHandleLike> })
    .showDirectoryPicker;
  const root = await picker();
  const out: PickedFile[] = [];
  const ignored: string[] = [];
  await walkHandle(root as unknown as FileSystemHandleLike, '', out, ignored);
  return { files: sortPicked(out), ignored };
}

async function walkHandle(
  handle: FileSystemHandleLike,
  prefix: string,
  out: PickedFile[],
  ignored: string[],
): Promise<void> {
  if (!handle.values) return;
  for await (const entry of handle.values()) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await walkHandle(entry, path, out, ignored);
    } else if (entry.getFile && isMediaFile(entry.name)) {
      out.push({ file: await entry.getFile(), relativePath: path });
    } else if (entry.kind === 'file') {
      ignored.push(path);
    }
  }
}

/**
 * A `<input type="file">` selection, from either the file picker or the folder
 * picker. Only the folder one sets `webkitRelativePath`; individually chosen
 * files carry no path at all and land at the root.
 */
export function fromInput(fileList: FileList | null): PickResult {
  if (!fileList) return { files: [], ignored: [] };
  const out: PickedFile[] = [];
  const ignored: string[] = [];
  for (const file of Array.from(fileList)) {
    if (!isMediaFile(file.name)) {
      ignored.push(file.name);
      continue;
    }
    const withPath = file as File & { webkitRelativePath?: string };
    const relative = withPath.webkitRelativePath || file.name;
    // webkitRelativePath includes the picked folder itself; drop that segment
    // so grouping sees CAM_A/... rather than Rushes/CAM_A/...
    const parts = relative.split('/');
    out.push({ file, relativePath: parts.length > 1 ? parts.slice(1).join('/') : file.name });
  }
  return { files: sortPicked(out), ignored };
}

/**
 * Drag-and-drop, including whole folders.
 *
 * `webkitGetAsEntry` is non-standard and ancient and is nonetheless the only
 * way to read a dropped *folder* in Safari and Firefox. The items have to be
 * captured synchronously — the DataTransfer list is emptied the moment the drop
 * handler yields — which is why the entries are collected before any awaiting.
 */
export async function fromDrop(dataTransfer: DataTransfer): Promise<PickResult> {
  const entries: FileSystemEntryLike[] = [];
  const looseFiles: File[] = [];

  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const getEntry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }).webkitGetAsEntry;
    const entry = getEntry ? getEntry.call(item) : null;
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) looseFiles.push(file);
    }
  }

  const out: PickedFile[] = [];
  const ignored: string[] = [];
  for (const entry of entries) await walkEntry(entry, '', out, ignored);
  for (const file of looseFiles) {
    if (isMediaFile(file.name)) out.push({ file, relativePath: file.name });
    else ignored.push(file.name);
  }
  return { files: sortPicked(out), ignored };
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(cb: (file: File) => void, err?: (e: unknown) => void): void;
  createReader?(): {
    readEntries(cb: (entries: FileSystemEntryLike[]) => void, err?: (e: unknown) => void): void;
  };
}

async function walkEntry(
  entry: FileSystemEntryLike,
  prefix: string,
  out: PickedFile[],
  ignored: string[],
): Promise<void> {
  if (entry.name.startsWith('.')) return;
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile && entry.file) {
    if (!isMediaFile(entry.name)) {
      ignored.push(path);
      return;
    }
    const file = await new Promise<File | null>((resolve) => {
      entry.file!((f) => resolve(f), () => resolve(null));
    });
    if (file) out.push({ file, relativePath: path });
    return;
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns at most 100 entries per call and signals the end with
    // an empty batch — a card folder will hit that limit every time.
    for (;;) {
      const batch = await new Promise<FileSystemEntryLike[]>((resolve) => {
        reader.readEntries((e) => resolve(e), () => resolve([]));
      });
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, path, out, ignored);
    }
  }
}

function sortPicked(files: PickedFile[]): PickedFile[] {
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** Trigger a download of generated text. Exports are small text files. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick; revoking synchronously races the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

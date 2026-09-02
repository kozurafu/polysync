/**
 * Identifying a file across sessions and machines.
 *
 * Deliberately *not* the absolute path. Safari and Firefox cannot persist a
 * directory handle, so reopening a project means dropping the folder again and
 * relinking every clip; and a project copied to another machine has different
 * absolute paths for the same media. Relative path, size and modification time
 * survive both.
 *
 * This is the key for the OPFS analysis cache and for project relinking, which
 * are the same problem seen from two ends.
 */

export interface FileIdentity {
  /** Path relative to the folder the user dropped. */
  relativePath: string;
  size: number;
  /** Milliseconds since epoch, as `File.lastModified` reports it. */
  lastModified: number;
}

/** A stable cache key. A collision needs the same path, size and mtime. */
export function identityKey(identity: FileIdentity): string {
  return `${identity.relativePath} ${identity.size} ${identity.lastModified}`;
}

export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.size === b.size && a.lastModified === b.lastModified && a.relativePath === b.relativePath;
}

/**
 * Relink a saved project's clips against a freshly dropped folder.
 *
 * Three passes, weakest evidence last:
 *   1. Exact identity.
 *   2. Same size and mtime at a different path — a file that moved folders is
 *      still that file.
 *   3. Same name and size — catches a copy whose timestamps a card-offload
 *      tool rewrote, which is common enough to be worth the looser match.
 *
 * Each candidate is consumed once, so two identical takes cannot both relink
 * to the same file.
 */
export function relink(
  wanted: FileIdentity[],
  available: FileIdentity[],
): Map<string, FileIdentity | undefined> {
  const out = new Map<string, FileIdentity | undefined>();
  const unused = new Set(available);

  const take = (match: FileIdentity | undefined) => {
    if (match) unused.delete(match);
    return match;
  };

  for (const want of wanted) {
    const exact = [...unused].find((a) => sameFile(want, a));
    if (exact) {
      out.set(want.relativePath, take(exact));
      continue;
    }
    const moved = [...unused].find(
      (a) => a.size === want.size && a.lastModified === want.lastModified,
    );
    if (moved) {
      out.set(want.relativePath, take(moved));
      continue;
    }
    const wantedName = baseName(want.relativePath);
    const renamed = [...unused].find(
      (a) => baseName(a.relativePath) === wantedName && a.size === want.size,
    );
    out.set(want.relativePath, take(renamed));
  }
  return out;
}

function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

import { DEFAULT_ALIGN_OPTIONS, alignPair, prepareClip, type AlignOptions, type PreparedClip } from './align.js';
import { DEFAULT_DRIFT_OPTIONS, estimateDrift, type DriftOptions } from './drift.js';
import type { AudioClip, PairAlignment, Placement, SyncResult } from './types.js';

export interface SyncOptions extends AlignOptions {
  /** Measure and report per-pair clock drift. Costs one extra pass per accepted edge. */
  detectDrift: boolean;
  drift: DriftOptions;
  /**
   * Preserve the order clips were supplied in within each track, rather than
   * letting the solver reposition them freely. PluralEyes 4 removed this
   * control and it became its single most-complained-about regression, so it is
   * on by default here.
   */
  preserveClipOrder: boolean;
  /** Gap inserted between sync groups when laying unsynced material out, seconds. */
  groupGapSeconds: number;
  /** Progress callback: fraction 0..1 and a short label. */
  onProgress?: (fraction: number, label: string) => void;
}

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  ...DEFAULT_ALIGN_OPTIONS,
  detectDrift: true,
  drift: DEFAULT_DRIFT_OPTIONS,
  preserveClipOrder: true,
  groupGapSeconds: 5,
};

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[rb] = ra;
    return true;
  }
}

/**
 * Solve a whole project.
 *
 * Every pair of clips is aligned, accepted matches become weighted edges, and a
 * maximum-confidence spanning forest fixes each clip's absolute position. Clips
 * that end up alone in their own component are what PluralEyes called
 * "unsynced" — a match could exist but none was found, or none exists.
 *
 * Solving on a spanning forest rather than pairwise means one strong match can
 * carry a weakly-matching clip into place transitively: camera B syncs to the
 * recorder, camera C syncs to camera B, and C lands correctly even though C and
 * the recorder never correlated directly.
 */
export function syncProject(
  clips: AudioClip[],
  options: Partial<SyncOptions> = {},
): SyncResult {
  const opts: SyncOptions = { ...DEFAULT_SYNC_OPTIONS, ...options };
  const n = clips.length;
  const report = (f: number, label: string) => opts.onProgress?.(f, label);

  if (n === 0) {
    return { placements: [], pairs: [], unsyncedClipIds: [], inconsistencies: [], groupCount: 0 };
  }

  report(0, 'Preparing audio');
  const prepared: PreparedClip[] = clips.map((c, i) => {
    report((0.3 * i) / n, `Preparing ${c.name ?? c.id}`);
    return prepareClip(c, opts);
  });

  report(0.3, 'Matching clips');
  const pairs: PairAlignment[] = [];
  const totalPairs = (n * (n - 1)) / 2;
  let done = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push(alignPair(prepared[i], prepared[j], opts));
      done++;
      report(0.3 + 0.5 * (done / Math.max(1, totalPairs)), 'Matching clips');
    }
  }

  const indexById = new Map(clips.map((c, i) => [c.id, i]));
  const accepted = pairs
    .filter((p) => p.accepted)
    .sort((a, b) => scoreEdge(b) - scoreEdge(a));

  // Maximum-confidence spanning forest.
  const uf = new UnionFind(n);
  const tree: PairAlignment[] = [];
  const adjacency: Array<Array<{ to: number; offset: number; edge: PairAlignment }>> = Array.from(
    { length: n },
    () => [],
  );
  for (const edge of accepted) {
    const a = indexById.get(edge.aId)!;
    const b = indexById.get(edge.bId)!;
    if (uf.union(a, b)) {
      tree.push(edge);
      adjacency[a].push({ to: b, offset: edge.offsetSeconds, edge });
      adjacency[b].push({ to: a, offset: -edge.offsetSeconds, edge });
    }
  }

  // Assign positions per connected component by breadth-first traversal.
  report(0.85, 'Solving timeline');
  const position = new Array<number | null>(n).fill(null);
  const group = new Array<number>(n).fill(-1);
  const bestQuality = new Array<number>(n).fill(0);
  const components: number[][] = [];

  for (let start = 0; start < n; start++) {
    if (position[start] !== null) continue;
    const groupId = components.length;
    const members: number[] = [];
    position[start] = 0;
    group[start] = groupId;
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      members.push(cur);
      for (const link of adjacency[cur]) {
        if (position[link.to] !== null) continue;
        position[link.to] = position[cur]! + link.offset;
        group[link.to] = groupId;
        bestQuality[link.to] = Math.max(bestQuality[link.to], link.edge.quality);
        bestQuality[cur] = Math.max(bestQuality[cur], link.edge.quality);
        queue.push(link.to);
      }
    }
    components.push(members);
  }

  // Consistency check: every accepted edge NOT in the tree is an independent
  // measurement of a distance the tree already fixed. Disagreement means at
  // least one of the two is wrong, and the user should be told which clips.
  const inconsistencies: Array<{ aId: string; bId: string; errorSeconds: number }> = [];
  const treeSet = new Set(tree);
  for (const edge of accepted) {
    if (treeSet.has(edge)) continue;
    const a = indexById.get(edge.aId)!;
    const b = indexById.get(edge.bId)!;
    if (group[a] !== group[b]) continue;
    const implied = position[b]! - position[a]!;
    const error = implied - edge.offsetSeconds;
    if (Math.abs(error) > 0.02) {
      inconsistencies.push({ aId: edge.aId, bId: edge.bId, errorSeconds: error });
    }
  }

  // Drift, measured only on tree edges (the ones that actually hold the timeline).
  if (opts.detectDrift) {
    report(0.9, 'Measuring drift');
    for (const edge of tree) {
      const a = clips[indexById.get(edge.aId)!];
      const b = clips[indexById.get(edge.bId)!];
      const d = estimateDrift(a, b, edge.offsetSeconds, opts.drift);
      if (d.r2 >= 0.8 && Math.abs(d.ppm) > 1) {
        edge.driftPpm = d.ppm;
        edge.driftR2 = d.r2;
      }
    }
  }

  // Lay the components out: the largest synced group starts at zero, every
  // other group is parked after it in order, which is how an editor wants to
  // find the material that did not sync.
  const order = components
    .map((members, id) => ({ id, members, size: members.length }))
    .sort((x, y) => y.size - x.size || x.id - y.id);

  let cursor = 0;
  const groupBase = new Map<number, number>();
  for (const comp of order) {
    const minPos = Math.min(...comp.members.map((m) => position[m]!));
    groupBase.set(comp.id, cursor - minPos);
    const maxEnd = Math.max(
      ...comp.members.map((m) => position[m]! + clips[m].samples.length / clips[m].sampleRate),
    );
    cursor = cursor - minPos + maxEnd + opts.groupGapSeconds;
  }

  const driftByClip = new Map<string, number>();
  for (const edge of tree) {
    if (edge.driftPpm != null) driftByClip.set(edge.bId, edge.driftPpm);
  }

  const placements: Placement[] = clips.map((clip, i) => ({
    clipId: clip.id,
    trackId: clip.trackId ?? clip.id,
    startSeconds: position[i]! + (groupBase.get(group[i]) ?? 0),
    synced: components[group[i]].length > 1,
    quality: bestQuality[i] || undefined,
    groupId: group[i],
    driftPpm: driftByClip.get(clip.id),
  }));

  const unsyncedClipIds = placements.filter((p) => !p.synced).map((p) => p.clipId);

  report(1, 'Done');
  return {
    placements,
    pairs,
    unsyncedClipIds,
    inconsistencies,
    groupCount: components.length,
  };
}

/**
 * Edge weight. Quality dominates; overlap length and peak sharpness break ties,
 * both compressed logarithmically so a very long weak match cannot outrank a
 * short unambiguous one.
 */
function scoreEdge(p: PairAlignment): number {
  return p.quality * 10 + Math.log10(1 + p.overlapSeconds) + Math.log10(1 + p.psr);
}

/** A mono audio signal extracted from one media file, ready to correlate. */
export interface AudioClip {
  id: string;
  /** Device/camera/recorder this clip came from. Clips sharing a trackId land on one NLE track. */
  trackId?: string;
  /** Display name, usually the source filename. */
  name?: string;
  /** Mono samples. */
  samples: Float64Array;
  sampleRate: number;
  /** Start timecode in seconds since midnight, if the file carried one. */
  timecodeSeconds?: number;
  /** File modification / recording start time, seconds since epoch. Weak hint only. */
  recordedAtSeconds?: number;
  /** Video frame rate, if this clip has picture. Used for timecode maths on export. */
  frameRate?: number;
}

export type AlignMethod = 'waveform' | 'envelope' | 'timecode' | 'none';

export interface PairAlignment {
  aId: string;
  bId: string;
  /** Position of b's start relative to a's start, in seconds. */
  offsetSeconds: number;
  /** Envelope correlation over the overlap, -1..1. The user-facing match quality. */
  quality: number;
  /** Peak-to-sidelobe ratio of the correlation surface. Sharpness of the match. */
  psr: number;
  overlapSeconds: number;
  method: AlignMethod;
  accepted: boolean;
  /** Estimated relative clock error, parts per million. Positive = b runs fast. */
  driftPpm?: number;
  driftR2?: number;
}

export interface Placement {
  clipId: string;
  trackId: string;
  /** Position on the project timeline, in seconds. */
  startSeconds: number;
  synced: boolean;
  /** Best edge quality that anchored this clip, if any. */
  quality?: number;
  /** Which connected component of the sync graph this clip belongs to. */
  groupId: number;
  driftPpm?: number;
}

export interface SyncResult {
  placements: Placement[];
  pairs: PairAlignment[];
  /** Clips that could not be matched to anything. */
  unsyncedClipIds: string[];
  /** Edges whose implied offset disagrees with the solved timeline. */
  inconsistencies: Array<{ aId: string; bId: string; errorSeconds: number }>;
  groupCount: number;
}

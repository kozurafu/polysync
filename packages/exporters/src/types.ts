import type { FrameRate } from '@polysync/timecode';

/** One clip, already solved onto the project timeline. */
export interface TimelineClip {
  id: string;
  name: string;
  /** Absolute path on the user's machine, for the NLE to relink against. */
  path: string;
  /**
   * Track this clip belongs to. One NLE track per distinct value.
   *
   * Not necessarily the device: under a one-track-per-clip layout every clip
   * gets its own value, so `trackLabel` carries the device for display.
   */
  trackId: string;
  /** What to call the track. Defaults to `trackId`. */
  trackLabel?: string;
  /** Position on the project timeline, seconds. */
  startSeconds: number;
  /** Clip duration, seconds. */
  durationSeconds: number;
  /** In-point within the source file, seconds. Almost always 0 for rushes. */
  sourceInSeconds?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  audioChannels?: number;
  width?: number;
  height?: number;
  /** False for clips the engine could not place. Marked red on import. */
  synced: boolean;
  /** Reel name for EDL. Sanitised to <= 8 characters on export. */
  reel?: string;
}

export interface TimelineProject {
  name: string;
  rate: FrameRate;
  clips: TimelineClip[];
}

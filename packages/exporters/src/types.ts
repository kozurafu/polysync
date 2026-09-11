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
  /**
   * Video and audio track, when they differ.
   *
   * A camera clip's picture and its scratch audio are laid out under separate
   * budgets — four video tracks, ten audio ones — so the two cannot always be
   * the same lane. Either falling back to `trackId` keeps the simple case
   * simple.
   */
  videoTrackId?: string;
  audioTrackId?: string;
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
  /**
   * Source timecode, seconds since midnight, when the file carried one.
   *
   * Written into the file's `<timecode>` so the NLE shows the same source
   * timecode the camera or recorder stamped, rather than starting every clip
   * at zero.
   */
  timecodeSeconds?: number;
}

export interface TimelineProject {
  name: string;
  rate: FrameRate;
  clips: TimelineClip[];
}

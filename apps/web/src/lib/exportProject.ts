/**
 * Turning a solved project into something an NLE will open.
 *
 * The one genuinely awkward thing here is the media root.
 *
 * FCP7 XML relinks by absolute path — `<pathurl>file:///Users/…</pathurl>` —
 * and a browser will never tell us one. `File.webkitRelativePath` is relative
 * to the folder that was dropped, and the File System Access API exposes no
 * filesystem path at all. That is a deliberate privacy property of the platform,
 * not an oversight, and no amount of cleverness gets around it.
 *
 * So the user supplies the root once, and we join it to the relative paths we
 * do have. Getting it wrong costs a relink in the NLE rather than a broken
 * file, and every editor has done a relink before. The EDL has no such problem:
 * it references reels, not paths.
 */

import {
  DEFAULT_FCP7_OPTIONS,
  exportEdl,
  exportFcp7Xml,
  type TimelineClip,
  type TimelineProject,
} from '@polysync/exporters';
import { RATE_25, type FrameRate } from '@polysync/timecode';
import type { SyncResult } from '@polysync/sync-core';
import type { IngestedClip } from './engine.ts';

export interface ExportInput {
  projectName: string;
  clips: IngestedClip[];
  result: SyncResult;
  deviceOf: (clipId: string) => string;
  /** Absolute folder the media was picked from, e.g. `D:\Rushes\Day1`. */
  mediaRoot: string;
  rate: FrameRate;
  /** How clips are laid onto NLE tracks. Defaults to `per-clip`. */
  trackLayout?: TrackLayout;
}

/**
 * How solved clips are distributed across NLE tracks.
 *
 * `per-device` is what PluralEyes did: one track per camera, angles stacked,
 * ready to cut between. It is the compact answer and the right one for a
 * conventional multicam edit.
 *
 * `per-clip` gives every source file a track of its own — 33 files, 33 video
 * tracks. It is the default because a track holds one clip at a time, so
 * anything sharing a track can hide behind whatever the solve put next to it,
 * and a clip you cannot see is indistinguishable from one that failed to
 * import. It costs a tall timeline and guarantees you can see everything.
 */
export type TrackLayout = 'per-clip' | 'per-device';

/** Common frame rates, as an editor names them. */
export const FRAME_RATES: Array<{ label: string; rate: FrameRate }> = [
  { label: '23.976', rate: { nominal: 24, ntsc: true, dropFrame: false } },
  { label: '24', rate: { nominal: 24, ntsc: false, dropFrame: false } },
  { label: '25', rate: RATE_25 },
  { label: '29.97 DF', rate: { nominal: 30, ntsc: true, dropFrame: true } },
  { label: '29.97 NDF', rate: { nominal: 30, ntsc: true, dropFrame: false } },
  { label: '30', rate: { nominal: 30, ntsc: false, dropFrame: false } },
  { label: '50', rate: { nominal: 50, ntsc: false, dropFrame: false } },
  { label: '59.94', rate: { nominal: 60, ntsc: true, dropFrame: false } },
  { label: '60', rate: { nominal: 60, ntsc: false, dropFrame: false } },
];

/**
 * Guess the sequence frame rate from the media.
 *
 * The most common rate among clips that actually carry one. A wrong guess makes
 * every offset land on the wrong frame, so this is offered as a default the
 * user can change rather than applied silently.
 */
export function guessFrameRate(clips: IngestedClip[]): FrameRate {
  const counts = new Map<string, { rate: FrameRate; n: number }>();
  for (const clip of clips) {
    const fps = clip.frameRate;
    if (!fps) continue;
    const match = FRAME_RATES.find((r) => {
      const actual = r.rate.ntsc ? (r.rate.nominal * 1000) / 1001 : r.rate.nominal;
      return Math.abs(actual - fps) < 0.01;
    });
    if (!match) continue;
    const entry = counts.get(match.label) ?? { rate: match.rate, n: 0 };
    entry.n++;
    counts.set(match.label, entry);
  }
  let best: { rate: FrameRate; n: number } | undefined;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best?.rate ?? RATE_25;
}

/** Join the user-supplied root to a relative path, tolerating either separator. */
export function joinMediaRoot(root: string, relativePath: string): string {
  const trimmed = root.replace(/[\\/]+$/, '');
  if (!trimmed) return relativePath;
  // Windows paths keep their backslashes until the exporter turns them into a
  // file:// URL, which normalises them.
  const separator = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  return `${trimmed}${separator}${relativePath.split('/').join(separator)}`;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function buildTimeline(input: ExportInput): TimelineProject {
  const byId = new Map(input.clips.map((c) => [c.id, c]));
  const layout = input.trackLayout ?? 'per-clip';
  // Keyed on the clip id, not its name: two cards routinely hold files of the
  // same name (`A/C0001.MP4` and `B/C0001.MP4`), and two clips sharing a track
  // is the one thing this layout exists to prevent. The readable name goes in
  // the label instead.
  const trackName = (clipId: string) => (layout === 'per-clip' ? clipId : input.deviceOf(clipId));

  const clips: TimelineClip[] = input.result.placements.map((placement) => {
    const clip = byId.get(placement.clipId);
    const device = input.deviceOf(placement.clipId);
    // The basename, not the path. In the browser a clip's `name` is its path
    // relative to the picked folder — that is what makes `pathurl` work — but
    // it is also what Premiere shows in the project panel, and `Footage/C1/
    // C1_4676.MP4` is not what anyone calls a clip.
    const name = basename(clip?.name ?? placement.clipId);
    return {
      id: placement.clipId,
      name,
      path: joinMediaRoot(input.mediaRoot, clip?.relativePath ?? placement.clipId),
      trackId: trackName(placement.clipId),
      trackLabel: layout === 'per-clip' ? `${name} (${device})` : device,
      startSeconds: placement.startSeconds,
      durationSeconds: clip?.durationSeconds ?? 0,
      sourceInSeconds: 0,
      hasVideo: clip?.probe.hasVideo ?? false,
      hasAudio: clip?.probe.hasAudio ?? true,
      audioChannels: clip?.probe.channels,
      width: clip?.probe.width,
      height: clip?.probe.height,
      synced: placement.synced,
      reel: device,
    };
  });

  return { name: input.projectName, rate: input.rate, clips };
}

export interface ExportedFile {
  filename: string;
  content: string;
}

export function exportFiles(input: ExportInput, format: 'fcp7' | 'edl'): ExportedFile[] {
  const project = buildTimeline(input);
  const safeName = input.projectName.replace(/[^A-Za-z0-9._-]+/g, '_') || 'polysync';

  if (format === 'fcp7') {
    return [
      {
        filename: `${safeName}_synced.xml`,
        content: exportFcp7Xml(project, DEFAULT_FCP7_OPTIONS),
      },
    ];
  }

  // CMX3600 is single-track by design, so one file per device.
  const perTrack = exportEdl(project);
  return [...perTrack.entries()].map(([trackId, content]) => ({
    filename: `${safeName}_${trackId}.edl`,
    content,
  }));
}

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
  /** How clips are laid onto NLE tracks. Defaults to `per-device`. */
  trackLayout?: TrackLayout;
  /** Track budget for the per-device layout. Defaults to `DEFAULT_TRACK_LIMITS`. */
  limits?: TrackLimits;
}

/**
 * How solved clips are distributed across NLE tracks.
 *
 * `per-device` is what PluralEyes did, and what the app's own timeline shows:
 * one track per camera, angles stacked, ready to cut between. It is the
 * default, because it is the layout an editor actually cuts from.
 *
 * `per-clip` gives every source file a track of its own — 33 files, 33 video
 * tracks. Nothing can ever hide behind anything, at the cost of a timeline too
 * tall to read. Useful when a solve is under suspicion and you want to see
 * every clip laid out separately.
 */
export type TrackLayout = 'per-clip' | 'per-device';

/**
 * How many tracks the per-device layout may use before it starts packing.
 *
 * Four video, because four angles is a large multicam shoot and a taller stack
 * than that is unreadable. Ten audio, because the budget has to cover the sound
 * recorder *plus* every camera's scratch audio, and FCP7 XML has no notion of a
 * stereo clip on one timeline track — a two-channel source is two clipitems on
 * two tracks. One recorder and four stereo cameras is nine.
 *
 * Both are targets rather than hard limits. A clip is never dropped and never
 * hidden to respect them: if packing cannot fit a clip onto an existing track
 * without covering something already there, it gets another track and
 * `trackOverflow` says so.
 */
export interface TrackLimits {
  maxVideoTracks: number;
  maxAudioTracks: number;
}

export const DEFAULT_TRACK_LIMITS: TrackLimits = {
  maxVideoTracks: 4,
  maxAudioTracks: 10,
};

interface Span {
  from: number;
  to: number;
}

/** Would this clip cover something already on the lane? */
function collides(lane: Span[], span: Span): boolean {
  // Touching end-to-start is fine — that is how a camera's own takes sit.
  return lane.some((s) => span.from < s.to && s.from < span.to);
}

/**
 * Assign each device a lane, packing only when the budget runs out.
 *
 * Devices are laid out in the given order, each taking a lane of its own while
 * lanes remain. Past the limit a device joins the first lane whose clips it
 * does not overlap — two cameras that never rolled at the same time can share
 * a track without either disappearing — and only when every lane collides does
 * it take a new one beyond the budget.
 *
 * Returns the lane index per device, and how many lanes were needed.
 */
export function packLanes(
  devices: Array<{ device: string; spans: Span[]; cost: number }>,
  budget: number,
): { laneOf: Map<string, number>; lanes: Span[][]; overflowed: boolean } {
  const laneOf = new Map<string, number>();
  const lanes: Span[][] = [];
  // A lane can cost more than one track — a stereo source occupies two — so
  // the budget is counted in tracks and spent as lanes are opened.
  let spent = 0;
  let overflowed = false;

  for (const { device, spans, cost } of devices) {
    const roomForNewLane = spent + cost <= budget;
    let index = roomForNewLane ? -1 : lanes.findIndex((lane) => !spans.some((s) => collides(lane, s)));
    if (index === -1) {
      if (!roomForNewLane) overflowed = true;
      index = lanes.length;
      lanes.push([]);
      spent += cost;
    }
    lanes[index].push(...spans);
    laneOf.set(device, index);
  }
  return { laneOf, lanes, overflowed };
}

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
  const layout = input.trackLayout ?? 'per-device';
  // Keyed on the clip id, not its name: two cards routinely hold files of the
  // same name (`A/C0001.MP4` and `B/C0001.MP4`), and two clips sharing a track
  // is the one thing the per-clip layout exists to prevent. The readable name
  // goes in the label instead.
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
      timecodeSeconds: clip?.timecodeSeconds,
    };
  });

  if (layout === 'per-device') assignDeviceLanes(clips, input.limits ?? DEFAULT_TRACK_LIMITS);

  return { name: input.projectName, rate: input.rate, clips };
}

/**
 * Give each device a video lane and an audio lane, within the track budget.
 *
 * The two are packed separately because they are spent differently: a camera
 * costs one video track and two audio ones, and the sound recorder costs no
 * video at all. Devices are ordered so that the supplied audio — anything with
 * no picture — is laid out first and lands on A1, which is where an editor
 * looks for it.
 */
function assignDeviceLanes(clips: TimelineClip[], limits: TrackLimits): void {
  const byDevice = new Map<string, TimelineClip[]>();
  for (const clip of clips) {
    const list = byDevice.get(clip.trackId);
    if (list) list.push(clip);
    else byDevice.set(clip.trackId, [clip]);
  }

  const devices = [...byDevice.entries()]
    .map(([device, on]) => ({
      device,
      on,
      audioOnly: on.every((c) => !c.hasVideo),
      start: Math.min(...on.map((c) => c.startSeconds)),
      channels: Math.max(1, ...on.map((c) => c.audioChannels ?? 2)),
    }))
    .sort((a, b) => Number(a.audioOnly) - Number(b.audioOnly) || a.start - b.start);

  const spansOf = (on: TimelineClip[]) =>
    on.map((c) => ({ from: c.startSeconds, to: c.startSeconds + c.durationSeconds }));

  const video = packLanes(
    devices
      .filter((d) => d.on.some((c) => c.hasVideo))
      .map((d) => ({ device: d.device, spans: spansOf(d.on.filter((c) => c.hasVideo)), cost: 1 })),
    limits.maxVideoTracks,
  );

  // Audio is laid out recorder-first, so its lane 0 is A1.
  const audio = packLanes(
    [...devices]
      .filter((d) => d.on.some((c) => c.hasAudio))
      .sort((a, b) => Number(a.audioOnly) - Number(b.audioOnly) || a.start - b.start)
      .map((d) => ({
        device: d.device,
        spans: spansOf(d.on.filter((c) => c.hasAudio)),
        cost: d.channels,
      })),
    limits.maxAudioTracks,
  );

  for (const clip of clips) {
    const v = video.laneOf.get(clip.trackId);
    const a = audio.laneOf.get(clip.trackId);
    // Padded so the lane ids sort in lane order, which is the order the tracks
    // are emitted in.
    if (v !== undefined) clip.videoTrackId = `V${String(v).padStart(3, '0')}`;
    if (a !== undefined) clip.audioTrackId = `A${String(a).padStart(3, '0')}`;
  }
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

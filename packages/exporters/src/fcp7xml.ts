import { secondsToFrames, type FrameRate } from '@polysync/timecode';
import type { TimelineClip, TimelineProject } from './types.js';

/**
 * FCP7 XML (XMEML v5) writer.
 *
 * Deprecated for over a decade and still the most reliable interchange in the
 * industry: Premiere Pro, DaVinci Resolve, Vegas and Lightworks all read it.
 * Adobe publishes no specification, so this follows the legacy Final Cut Pro 7
 * DTD and the shape real exports take.
 *
 * Note the one real precision loss: XMEML addresses time in whole frames, so a
 * sub-frame offset is rounded here. FCPXML and OTIO keep it.
 */

export interface Fcp7Options {
  /**
   * Colour unsynced clips so they stand out in the NLE. Premiere's
   * "Display the project item name and label color for all instances" project
   * setting silently overrides this — warn the user in the UI, because the fix
   * lives in Premiere, not here.
   */
  colourUnsynced: boolean;
  /** Label colour applied to unsynced clips. */
  unsyncedLabel: string;
}

export const DEFAULT_FCP7_OPTIONS: Fcp7Options = {
  colourUnsynced: true,
  unsyncedLabel: 'Rose',
};

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A filename reduced to something an XML `ID` attribute can legally hold:
 * letters, digits, hyphen, underscore and full stop, and never leading with a
 * digit. Two different clips must not collide, so anything else becomes `_`
 * rather than being dropped.
 */
export function idSlug(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[^A-Za-z_]+/, '_');
  return cleaned || '_';
}

/** Absolute path to a `file://` URL, percent-encoded per component. */
export function pathToFileUrl(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const withLeadingSlash = normalised.startsWith('/') ? normalised : `/${normalised}`;
  return `file://${withLeadingSlash.split('/').map(encodeURIComponent).join('/').replace(/^%2F/, '/')}`;
}

function rateXml(rate: FrameRate, indent: string): string {
  return [
    `${indent}<rate>`,
    `${indent}  <timebase>${rate.nominal}</timebase>`,
    `${indent}  <ntsc>${rate.ntsc ? 'TRUE' : 'FALSE'}</ntsc>`,
    `${indent}</rate>`,
  ].join('\n');
}

/**
 * Emit one `<clipitem>`. The first time a source file appears it is defined in
 * full; afterwards it is referenced by id, because repeating the definition
 * bloats the file and confuses Premiere's importer.
 */
function clipItemXml(
  clip: TimelineClip,
  project: TimelineProject,
  mediaType: 'video' | 'audio',
  seenFiles: Set<string>,
  opts: Fcp7Options,
  channel?: number,
): string {
  const rate = project.rate;
  const start = secondsToFrames(clip.startSeconds, rate);
  const duration = secondsToFrames(clip.durationSeconds, rate);
  const inPoint = secondsToFrames(clip.sourceInSeconds ?? 0, rate);
  // XML ID-typed attributes cannot contain spaces, and filenames very much can
  // — a real export carried `clipitem- C2_4928.MP4-video`, from a file whose
  // name began with a space. Slugged rather than escaped, because escaping
  // produces a valid document with an invalid identifier in it.
  const slug = idSlug(clip.id);
  const fileId = `file-${slug}`;
  const itemId = `clipitem-${slug}-${mediaType}${channel ? `-${channel}` : ''}`;

  const lines: string[] = [];
  lines.push(`        <clipitem id="${escapeXml(itemId)}">`);
  lines.push(`          <name>${escapeXml(clip.name)}</name>`);
  lines.push(`          <enabled>TRUE</enabled>`);
  lines.push(`          <duration>${duration}</duration>`);
  lines.push(rateXml(rate, '          '));
  lines.push(`          <start>${start}</start>`);
  lines.push(`          <end>${start + duration}</end>`);
  lines.push(`          <in>${inPoint}</in>`);
  lines.push(`          <out>${inPoint + duration}</out>`);

  if (seenFiles.has(fileId)) {
    lines.push(`          <file id="${escapeXml(fileId)}"/>`);
  } else {
    seenFiles.add(fileId);
    lines.push(`          <file id="${escapeXml(fileId)}">`);
    lines.push(`            <name>${escapeXml(clip.name)}</name>`);
    lines.push(`            <pathurl>${escapeXml(pathToFileUrl(clip.path))}</pathurl>`);
    lines.push(rateXml(rate, '            '));
    lines.push(`            <duration>${duration}</duration>`);
    lines.push(`            <media>`);
    if (clip.hasVideo) {
      lines.push(`              <video>`);
      lines.push(`                <samplecharacteristics>`);
      if (clip.width && clip.height) {
        lines.push(`                  <width>${clip.width}</width>`);
        lines.push(`                  <height>${clip.height}</height>`);
        // Without these two the importer is free to assume anamorphic pixels
        // or interlaced fields and reshape the picture accordingly.
        lines.push(`                  <pixelaspectratio>square</pixelaspectratio>`);
        lines.push(`                  <fielddominance>none</fielddominance>`);
      }
      lines.push(rateXml(rate, '                  '));
      lines.push(`                </samplecharacteristics>`);
      lines.push(`              </video>`);
    }
    if (clip.hasAudio) {
      lines.push(`              <audio>`);
      lines.push(`                <channelcount>${clip.audioChannels ?? 2}</channelcount>`);
      lines.push(`              </audio>`);
    }
    lines.push(`            </media>`);
    lines.push(`          </file>`);
  }

  if (mediaType === 'audio' && channel != null) {
    lines.push(`          <sourcetrack>`);
    lines.push(`            <mediatype>audio</mediatype>`);
    lines.push(`            <trackindex>${channel}</trackindex>`);
    lines.push(`          </sourcetrack>`);
  } else if (mediaType === 'video') {
    lines.push(`          <sourcetrack>`);
    lines.push(`            <mediatype>video</mediatype>`);
    lines.push(`            <trackindex>1</trackindex>`);
    lines.push(`          </sourcetrack>`);
  }

  if (opts.colourUnsynced && !clip.synced) {
    lines.push(`          <labels>`);
    lines.push(`            <label2>${escapeXml(opts.unsyncedLabel)}</label2>`);
    lines.push(`          </labels>`);
  }

  lines.push(`        </clipitem>`);
  return lines.join('\n');
}

/**
 * The tracks to emit, in the order the NLE will number them.
 *
 * Earliest clip first, so V1 is the track that starts the sequence rather than
 * whichever track happens to sort first alphabetically. Ties break on the name,
 * so the output is deterministic either way.
 */
function trackIds(clips: TimelineClip[]): string[] {
  const firstStart = new Map<string, number>();
  for (const clip of clips) {
    const seen = firstStart.get(clip.trackId);
    if (seen === undefined || clip.startSeconds < seen) {
      firstStart.set(clip.trackId, clip.startSeconds);
    }
  }
  return [...firstStart.keys()].sort((a, b) => {
    const byStart = (firstStart.get(a) ?? 0) - (firstStart.get(b) ?? 0);
    return byStart !== 0 ? byStart : a.localeCompare(b);
  });
}

/**
 * What to write in the track's comment.
 *
 * `trackLabel` when the caller supplied one, because under a per-clip layout
 * the track id is a unique key rather than anything worth reading — repeating
 * it alongside the label just makes the comment twice as long and no clearer.
 */
function trackLabel(clips: TimelineClip[], trackId: string): string {
  return clips.find((c) => c.trackId === trackId)?.trackLabel || trackId;
}

/**
 * The frame size the sequence should be built at.
 *
 * The most common size among the clips that have picture, breaking ties on the
 * larger frame. Most common rather than largest, because a shoot is usually one
 * format plus the odd outlier, and building the sequence around the outlier
 * would scale every other clip; and larger on a tie, because scaling down loses
 * less than scaling up.
 */
export function sequenceFrameSize(
  clips: TimelineClip[],
): { width: number; height: number } | undefined {
  const tally = new Map<string, { width: number; height: number; count: number }>();
  for (const clip of clips) {
    if (!clip.hasVideo || !clip.width || !clip.height) continue;
    const key = `${clip.width}x${clip.height}`;
    const seen = tally.get(key);
    if (seen) seen.count++;
    else tally.set(key, { width: clip.width, height: clip.height, count: 1 });
  }
  const ranked = [...tally.values()].sort(
    (a, b) => b.count - a.count || b.width * b.height - a.width * a.height,
  );
  return ranked[0] ? { width: ranked[0].width, height: ranked[0].height } : undefined;
}

export function exportFcp7Xml(
  project: TimelineProject,
  options: Partial<Fcp7Options> = {},
): string {
  const opts = { ...DEFAULT_FCP7_OPTIONS, ...options };
  const rate = project.rate;
  const seenFiles = new Set<string>();

  const end = project.clips.reduce(
    (max, c) => Math.max(max, secondsToFrames(c.startSeconds + c.durationSeconds, rate)),
    0,
  );

  const videoTracks = trackIds(project.clips.filter((c) => c.hasVideo));
  const audioTracks = trackIds(project.clips.filter((c) => c.hasAudio));

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<!DOCTYPE xmeml>`);
  lines.push(`<xmeml version="5">`);
  lines.push(`  <sequence id="sequence-1">`);
  lines.push(`    <name>${escapeXml(project.name)}</name>`);
  lines.push(`    <duration>${end}</duration>`);
  lines.push(rateXml(rate, '    '));
  lines.push(`    <media>`);

  lines.push(`      <video>`);
  // The sequence's own format. Its absence is why imported timelines came out
  // the wrong shape: with no `<format>` the NLE has nothing to build sequence
  // settings from and invents them, so 3840x2160 rushes landed in whatever
  // Premiere guessed and were scaled to fit it.
  const frame = sequenceFrameSize(project.clips);
  if (frame) {
    lines.push(`        <format>`);
    lines.push(`          <samplecharacteristics>`);
    lines.push(rateXml(rate, '            '));
    lines.push(`            <width>${frame.width}</width>`);
    lines.push(`            <height>${frame.height}</height>`);
    lines.push(`            <pixelaspectratio>square</pixelaspectratio>`);
    lines.push(`            <fielddominance>none</fielddominance>`);
    lines.push(`          </samplecharacteristics>`);
    lines.push(`        </format>`);
  }
  for (const trackId of videoTracks) {
    lines.push(`        <track>`);
    lines.push(`          <!-- ${escapeXml(trackLabel(project.clips, trackId))} -->`);
    for (const clip of project.clips.filter((c) => c.trackId === trackId && c.hasVideo)) {
      lines.push(clipItemXml(clip, project, 'video', seenFiles, opts));
    }
    lines.push(`          <enabled>TRUE</enabled>`);
    lines.push(`          <locked>FALSE</locked>`);
    lines.push(`        </track>`);
  }
  lines.push(`      </video>`);

  // Every audio source gets its own track. PluralEyes used only the topmost
  // overlapping audio-only track on Premiere export, which silently dropped
  // additional recorders on multi-recorder shoots.
  //
  // And every *channel* gets its own track too. FCP7 XML has no notion of a
  // stereo clip on one timeline track: a two-channel source is two clipitems,
  // one per track, distinguished by `<trackindex>`. Emitting only trackindex 1
  // brings in half the audio at best and, on a track where clips overlap,
  // nothing at all.
  lines.push(`      <audio>`);
  lines.push(`        <format>`);
  lines.push(`          <samplecharacteristics>`);
  lines.push(`            <depth>16</depth>`);
  lines.push(`            <samplerate>48000</samplerate>`);
  lines.push(`          </samplecharacteristics>`);
  lines.push(`        </format>`);
  for (const trackId of audioTracks) {
    const clipsOnTrack = project.clips.filter((c) => c.trackId === trackId && c.hasAudio);
    const channels = Math.max(1, ...clipsOnTrack.map((c) => c.audioChannels ?? 2));
    for (let channel = 1; channel <= channels; channel++) {
      lines.push(`        <track>`);
      lines.push(`          <!-- ${escapeXml(trackLabel(project.clips, trackId))} ch${channel} -->`);
      for (const clip of clipsOnTrack) {
        // A mono source has nothing on channel 2; asking for it makes Premiere
        // drop the whole clipitem.
        if (channel > (clip.audioChannels ?? 2)) continue;
        lines.push(clipItemXml(clip, project, 'audio', seenFiles, opts, channel));
      }
      lines.push(`          <enabled>TRUE</enabled>`);
      lines.push(`          <locked>FALSE</locked>`);
      lines.push(`        </track>`);
    }
  }
  lines.push(`      </audio>`);

  lines.push(`    </media>`);
  lines.push(`  </sequence>`);
  lines.push(`</xmeml>`);
  return lines.join('\n') + '\n';
}

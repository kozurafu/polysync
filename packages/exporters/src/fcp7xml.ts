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
  const fileId = `file-${clip.id}`;
  const itemId = `clipitem-${clip.id}-${mediaType}${channel ? `-${channel}` : ''}`;

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

/** Stable, sorted list of track ids. */
function trackIds(clips: TimelineClip[]): string[] {
  return [...new Set(clips.map((c) => c.trackId))].sort();
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
  for (const trackId of videoTracks) {
    lines.push(`        <track>`);
    lines.push(`          <!-- ${escapeXml(trackId)} -->`);
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
  lines.push(`      <audio>`);
  for (const trackId of audioTracks) {
    lines.push(`        <track>`);
    lines.push(`          <!-- ${escapeXml(trackId)} -->`);
    for (const clip of project.clips.filter((c) => c.trackId === trackId && c.hasAudio)) {
      lines.push(clipItemXml(clip, project, 'audio', seenFiles, opts, 1));
    }
    lines.push(`          <enabled>TRUE</enabled>`);
    lines.push(`          <locked>FALSE</locked>`);
    lines.push(`        </track>`);
  }
  lines.push(`      </audio>`);

  lines.push(`    </media>`);
  lines.push(`  </sequence>`);
  lines.push(`</xmeml>`);
  return lines.join('\n') + '\n';
}

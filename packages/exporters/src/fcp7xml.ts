import { framesToTimecode, secondsToFrames, type FrameRate } from '@polysync/timecode';
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
 * Where one clipitem sits, once the whole sequence has been laid out.
 *
 * Links need this: a `<link>` addresses its partner by track index and clip
 * index, not by id alone, so nothing can be written until every clipitem's
 * position is known. Hence a planning pass before any XML is emitted.
 */
interface Slot {
  clip: TimelineClip;
  mediaType: 'video' | 'audio';
  /** Audio only: which channel of the source this clipitem carries. */
  channel?: number;
  /** 1-based index of the track within its media type — V1, A3 and so on. */
  trackIndex: number;
  /** 1-based index of this clipitem along that track. */
  clipIndex: number;
  itemId: string;
}

/**
 * Emit one `<clipitem>`. The first time a source file appears it is defined in
 * full; afterwards it is referenced by id, because repeating the definition
 * bloats the file and confuses Premiere's importer.
 *
 * Element order follows a real Final Cut Pro 7 export rather than convenience.
 * Premiere's importer is more forgiving than the DTD, but not reliably so, and
 * matching the reference implementation costs nothing.
 */
function clipItemXml(
  slot: Slot,
  siblings: Slot[],
  project: TimelineProject,
  seenFiles: Set<string>,
  opts: Fcp7Options,
): string {
  const { clip, mediaType, channel } = slot;
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

  const lines: string[] = [];
  lines.push(`        <clipitem id="${escapeXml(slot.itemId)}">`);
  lines.push(`          <name>${escapeXml(clip.name)}</name>`);
  lines.push(`          <duration>${duration}</duration>`);
  lines.push(rateXml(rate, '          '));
  lines.push(`          <in>${inPoint}</in>`);
  lines.push(`          <out>${inPoint + duration}</out>`);
  lines.push(`          <start>${start}</start>`);
  lines.push(`          <end>${start + duration}</end>`);
  if (mediaType === 'video') {
    lines.push(`          <pixelaspectratio>square</pixelaspectratio>`);
    lines.push(`          <enabled>TRUE</enabled>`);
    lines.push(`          <anamorphic>FALSE</anamorphic>`);
    lines.push(`          <alphatype>none</alphatype>`);
  } else {
    lines.push(`          <enabled>TRUE</enabled>`);
  }

  // Every clipitem cut from one source file must name the same master clip, or
  // the importer treats each as its own project item — 37 clips becoming 100
  // unrelated items, with a stereo pair's two channels no longer recognisably
  // the same clip.
  lines.push(`          <masterclipid>masterclip-${escapeXml(slug)}</masterclipid>`);

  if (opts.colourUnsynced && !clip.synced) {
    lines.push(`          <labels>`);
    lines.push(`            <label2>${escapeXml(opts.unsyncedLabel)}</label2>`);
    lines.push(`          </labels>`);
  }

  if (seenFiles.has(fileId)) {
    lines.push(`          <file id="${escapeXml(fileId)}"/>`);
  } else {
    seenFiles.add(fileId);
    lines.push(`          <file id="${escapeXml(fileId)}">`);
    lines.push(`            <name>${escapeXml(clip.name)}</name>`);
    lines.push(`            <pathurl>${escapeXml(pathToFileUrl(clip.path))}</pathurl>`);
    lines.push(rateXml(rate, '            '));
    lines.push(`            <duration>${duration}</duration>`);
    if (clip.timecodeSeconds !== undefined) {
      lines.push(timecodeXml(clip.timecodeSeconds, rate, '            '));
    }
    lines.push(`            <media>`);
    if (clip.hasVideo) {
      lines.push(`              <video>`);
      lines.push(`                <duration>${duration}</duration>`);
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
      lines.push(`                <samplecharacteristics>`);
      lines.push(`                  <depth>16</depth>`);
      lines.push(`                  <samplerate>48000</samplerate>`);
      lines.push(`                </samplecharacteristics>`);
      lines.push(`                <channelcount>${clip.audioChannels ?? 2}</channelcount>`);
      lines.push(`              </audio>`);
    }
    lines.push(`            </media>`);
    lines.push(`          </file>`);
  }

  lines.push(`          <sourcetrack>`);
  lines.push(`            <mediatype>${mediaType}</mediatype>`);
  // Audio names the source channel it takes; video does not, matching FCP.
  if (mediaType === 'audio' && channel != null) {
    lines.push(`            <trackindex>${channel}</trackindex>`);
  }
  lines.push(`          </sourcetrack>`);

  // Tie this clipitem to the others cut from the same source, so Premiere
  // treats a clip's picture and its two audio channels as one linked item.
  // Without these, nudging the video leaves its audio behind and the timeline
  // is no longer the thing the solve produced. Each member lists the whole
  // group, itself included — that is the convention FCP writes.
  if (siblings.length > 1) {
    for (const sibling of siblings) {
      lines.push(`          <link>`);
      lines.push(`            <linkclipref>${escapeXml(sibling.itemId)}</linkclipref>`);
      lines.push(`            <mediatype>${sibling.mediaType}</mediatype>`);
      lines.push(`            <trackindex>${sibling.trackIndex}</trackindex>`);
      lines.push(`            <clipindex>${sibling.clipIndex}</clipindex>`);
      lines.push(`          </link>`);
    }
  }

  lines.push(`        </clipitem>`);
  return lines.join('\n');
}

/** A `<timecode>` block, as both the sequence and each file want one. */
function timecodeXml(seconds: number, rate: FrameRate, indent: string): string {
  const frame = secondsToFrames(seconds, rate);
  return [
    `${indent}<timecode>`,
    rateXml(rate, `${indent}  `),
    `${indent}  <string>${framesToTimecode(frame, rate)}</string>`,
    `${indent}  <frame>${frame}</frame>`,
    `${indent}  <displayformat>${rate.dropFrame ? 'DF' : 'NDF'}</displayformat>`,
    `${indent}</timecode>`,
  ].join('\n');
}

/**
 * A stable UUID for the sequence, derived from its name.
 *
 * Premiere wants one, and deriving it rather than randomising means exporting
 * the same project twice produces the same document — which makes the output
 * diffable and keeps re-imports from multiplying sequences.
 */
function sequenceUuid(name: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < name.length; i++) {
    h1 = Math.imul(h1 ^ name.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + name.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const a = hex(h1);
  const b = hex(h2);
  const c = hex((h1 ^ h2) >>> 0);
  const d = hex(Math.imul(h1 + h2, 0xc2b2ae35) >>> 0);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
}

/**
 * The tracks to emit, in the order the NLE will number them.
 *
 * Earliest clip first, so V1 is the track that starts the sequence rather than
 * whichever track happens to sort first alphabetically. Ties break on the name,
 * so the output is deterministic either way.
 */
function trackIds(clips: TimelineClip[], of: (c: TimelineClip) => string): string[] {
  const firstStart = new Map<string, number>();
  const cameraBorne = new Set<string>();
  for (const clip of clips) {
    const id = of(clip);
    const seen = firstStart.get(id);
    if (seen === undefined || clip.startSeconds < seen) firstStart.set(id, clip.startSeconds);
    if (clip.hasVideo) cameraBorne.add(id);
  }
  return [...firstStart.keys()].sort((a, b) => {
    // A track carrying nothing but audio-only sources — the sound recorder —
    // outranks any camera's scratch audio, whatever the clock says. A1 is
    // where an editor expects the good audio, and a camera that happened to
    // roll first should not push it down the stack.
    const byKind = Number(cameraBorne.has(a)) - Number(cameraBorne.has(b));
    if (byKind !== 0) return byKind;
    const byStart = (firstStart.get(a) ?? 0) - (firstStart.get(b) ?? 0);
    return byStart !== 0 ? byStart : a.localeCompare(b);
  });
}

export const videoTrackOf = (clip: TimelineClip): string => clip.videoTrackId ?? clip.trackId;
export const audioTrackOf = (clip: TimelineClip): string => clip.audioTrackId ?? clip.trackId;

/**
 * What to write in the track's comment.
 *
 * `trackLabel` when the caller supplied one, because under a per-clip layout
 * the track id is a unique key rather than anything worth reading — repeating
 * it alongside the label just makes the comment twice as long and no clearer.
 */
function trackLabel(
  clips: TimelineClip[],
  trackId: string,
  of: (c: TimelineClip) => string,
): string {
  // A packed track can hold more than one device; name them all rather than
  // whichever happened to land there first.
  const labels = [...new Set(clips.filter((c) => of(c) === trackId).map((c) => c.trackLabel || of(c)))];
  return labels.length > 1 ? labels.join(' + ') : (labels[0] ?? trackId);
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

  const videoTracks = trackIds(project.clips.filter((c) => c.hasVideo), videoTrackOf);
  const audioTracks = trackIds(project.clips.filter((c) => c.hasAudio), audioTrackOf);

  // ---- plan first, emit second --------------------------------------------
  // A `<link>` addresses its partners by track and clip index, so every
  // clipitem's position has to be known before the first one can be written.
  const slots: Slot[] = [];
  const onVideoTrack = (trackId: string) =>
    project.clips
      .filter((c) => videoTrackOf(c) === trackId && c.hasVideo)
      .sort((a, b) => a.startSeconds - b.startSeconds);

  videoTracks.forEach((trackId, t) => {
    onVideoTrack(trackId).forEach((clip, i) => {
      slots.push({
        clip,
        mediaType: 'video',
        trackIndex: t + 1,
        clipIndex: i + 1,
        itemId: `clipitem-${idSlug(clip.id)}-video`,
      });
    });
  });

  // Audio track numbering runs across every channel of every track, because
  // that is what the NLE counts: A1, A2, A3 are timeline tracks, and a stereo
  // source occupies two of them.
  const audioLanes: Array<{ trackId: string; channel: number; clips: TimelineClip[] }> = [];
  for (const trackId of audioTracks) {
    const clipsOnTrack = project.clips
      .filter((c) => audioTrackOf(c) === trackId && c.hasAudio)
      .sort((a, b) => a.startSeconds - b.startSeconds);
    const channels = Math.max(1, ...clipsOnTrack.map((c) => c.audioChannels ?? 2));
    for (let channel = 1; channel <= channels; channel++) {
      // A mono source has nothing on channel 2; asking for it makes Premiere
      // drop the whole clipitem.
      audioLanes.push({
        trackId,
        channel,
        clips: clipsOnTrack.filter((c) => channel <= (c.audioChannels ?? 2)),
      });
    }
  }
  audioLanes.forEach((lane, t) => {
    lane.clips.forEach((clip, i) => {
      slots.push({
        clip,
        mediaType: 'audio',
        channel: lane.channel,
        trackIndex: t + 1,
        clipIndex: i + 1,
        itemId: `clipitem-${idSlug(clip.id)}-audio-${lane.channel}`,
      });
    });
  });

  // Link groups: one per source clip, holding its picture and every channel.
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const list = groups.get(slot.clip.id);
    if (list) list.push(slot);
    else groups.set(slot.clip.id, [slot]);
  }
  const emit = (slot: Slot) =>
    clipItemXml(slot, groups.get(slot.clip.id) ?? [slot], project, seenFiles, opts);

  // ---- emit ----------------------------------------------------------------
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<!DOCTYPE xmeml>`);
  lines.push(`<xmeml version="5">`);
  lines.push(`  <sequence id="sequence-1">`);
  lines.push(`    <uuid>${sequenceUuid(project.name)}</uuid>`);
  lines.push(`    <updatebehavior>add</updatebehavior>`);
  lines.push(`    <name>${escapeXml(project.name)}</name>`);
  lines.push(`    <duration>${end}</duration>`);
  lines.push(rateXml(rate, '    '));
  // Where the sequence starts. Left out, the importer picks its own start and
  // every clip's position is read against a different origin than the one the
  // solve measured.
  lines.push(timecodeXml(0, rate, '    '));
  lines.push(`    <in>-1</in>`);
  lines.push(`    <out>-1</out>`);
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
    lines.push(`            <colordepth>24</colordepth>`);
    lines.push(`          </samplecharacteristics>`);
    lines.push(`        </format>`);
  }
  videoTracks.forEach((trackId, t) => {
    lines.push(`        <track>`);
    lines.push(`          <!-- ${escapeXml(trackLabel(project.clips, trackId, videoTrackOf))} -->`);
    for (const slot of slots.filter((s) => s.mediaType === 'video' && s.trackIndex === t + 1)) {
      lines.push(emit(slot));
    }
    lines.push(`          <enabled>TRUE</enabled>`);
    lines.push(`          <locked>FALSE</locked>`);
    lines.push(`        </track>`);
  });
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
  lines.push(`        <numOutputChannels>2</numOutputChannels>`);
  lines.push(`        <format>`);
  lines.push(`          <samplecharacteristics>`);
  lines.push(`            <depth>16</depth>`);
  lines.push(`            <samplerate>48000</samplerate>`);
  lines.push(`          </samplecharacteristics>`);
  lines.push(`        </format>`);
  // The master bus. Without it the importer has no output to route tracks to,
  // and an audio track with nowhere to go is where imported audio quietly
  // stops appearing.
  lines.push(`        <outputs>`);
  lines.push(`          <group>`);
  lines.push(`            <index>1</index>`);
  lines.push(`            <numchannels>2</numchannels>`);
  lines.push(`            <downmix>0</downmix>`);
  lines.push(`            <channel>`);
  lines.push(`              <index>1</index>`);
  lines.push(`            </channel>`);
  lines.push(`            <channel>`);
  lines.push(`              <index>2</index>`);
  lines.push(`            </channel>`);
  lines.push(`          </group>`);
  lines.push(`        </outputs>`);
  audioLanes.forEach((lane, t) => {
    lines.push(`        <track>`);
    lines.push(
      `          <!-- ${escapeXml(trackLabel(project.clips, lane.trackId, audioTrackOf))} ch${lane.channel} -->`,
    );
    for (const slot of slots.filter((s) => s.mediaType === 'audio' && s.trackIndex === t + 1)) {
      lines.push(emit(slot));
    }
    lines.push(`          <enabled>TRUE</enabled>`);
    lines.push(`          <locked>FALSE</locked>`);
    // Which side of the master this track feeds — taken from the *source*
    // channel, not the track's position. Alternating by position looks right
    // until an odd number of tracks precedes a stereo pair: a single mono
    // recorder on A1 is enough to shift every pair after it and swap left for
    // right on all of them.
    lines.push(`          <outputchannelindex>${((lane.channel - 1) % 2) + 1}</outputchannelindex>`);
    lines.push(`        </track>`);
  });
  lines.push(`      </audio>`);

  lines.push(`    </media>`);
  lines.push(`  </sequence>`);
  lines.push(`</xmeml>`);
  return lines.join('\n');
}

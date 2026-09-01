import { framesToTimecode, secondsToFrames } from '@polysync/timecode';
import type { TimelineProject } from './types.js';

/**
 * CMX3600 EDL writer.
 *
 * PluralEyes never supported EDL in any version, which left EDIUS, Lightworks
 * and anything else without an XML path with no route in at all. It is ~80
 * lines and it is the universal fallback, so there is no good reason not to.
 *
 * The format is single-track by design, so one EDL is emitted per track and the
 * caller writes them as separate files.
 */

export interface EdlOptions {
  /** Timecode of the first frame of the record timeline. */
  recordStartSeconds: number;
}

export const DEFAULT_EDL_OPTIONS: EdlOptions = { recordStartSeconds: 0 };

/**
 * CMX3600 reel names are limited to 8 characters from a restricted alphabet.
 * Collisions are resolved by suffixing, and the caller should emit the mapping
 * as comments so a human can work out which reel was which.
 */
export function sanitiseReel(name: string, taken: Set<string>): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 8) || 'REEL';
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let i = 1; i < 1000; i++) {
    const suffix = String(i);
    const candidate = base.slice(0, 8 - suffix.length) + suffix;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Cannot allocate a unique reel name for ${name}`);
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** Emit one EDL per track. Returns a map of track id to EDL text. */
export function exportEdl(
  project: TimelineProject,
  options: Partial<EdlOptions> = {},
): Map<string, string> {
  const opts = { ...DEFAULT_EDL_OPTIONS, ...options };
  const rate = project.rate;
  const out = new Map<string, string>();
  const trackIds = [...new Set(project.clips.map((c) => c.trackId))].sort();

  for (const trackId of trackIds) {
    const clips = project.clips
      .filter((c) => c.trackId === trackId)
      .sort((a, b) => a.startSeconds - b.startSeconds);

    const taken = new Set<string>();
    const reelMap = new Map<string, string>();
    const lines: string[] = [];

    lines.push(`TITLE: ${project.name.toUpperCase()} ${trackId.toUpperCase()}`.slice(0, 70));
    lines.push(`FCM: ${rate.dropFrame ? 'DROP FRAME' : 'NON-DROP FRAME'}`);
    lines.push('');

    clips.forEach((clip, i) => {
      const reel = clip.reel
        ? sanitiseReel(clip.reel, taken)
        : sanitiseReel(clip.name.replace(/\.[^.]+$/, ''), taken);
      reelMap.set(reel, clip.name);

      const srcIn = secondsToFrames(clip.sourceInSeconds ?? 0, rate);
      const dur = secondsToFrames(clip.durationSeconds, rate);
      const recIn = secondsToFrames(clip.startSeconds + opts.recordStartSeconds, rate);

      const channels = clip.hasVideo && clip.hasAudio ? 'AA/V' : clip.hasVideo ? 'V' : 'AA';

      lines.push(
        [
          String(i + 1).padStart(3, '0'),
          ' ',
          pad(reel, 8),
          ' ',
          pad(channels, 5),
          ' ',
          pad('C', 8),
          ' ',
          framesToTimecode(srcIn, rate),
          ' ',
          framesToTimecode(srcIn + dur, rate),
          ' ',
          framesToTimecode(recIn, rate),
          ' ',
          framesToTimecode(recIn + dur, rate),
        ].join(''),
      );
      lines.push(`* FROM CLIP NAME: ${clip.name}`);
      if (!clip.synced) lines.push(`* COMMENT: UNSYNCED`);
    });

    lines.push('');
    lines.push('* REEL MAP');
    for (const [reel, name] of reelMap) lines.push(`* ${pad(reel, 8)} ${name}`);

    out.set(trackId, lines.join('\n') + '\n');
  }

  return out;
}

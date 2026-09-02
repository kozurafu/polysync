/**
 * SMPTE timecode arithmetic.
 *
 * Deliberately dependency-free and small. Drop-frame is the only genuinely
 * tricky part: at 29.97 and 59.94 fps, two (or four) frame *numbers* are
 * skipped at the start of every minute except every tenth minute, so that the
 * label tracks wall-clock time. Nothing is dropped from the media — only from
 * the counting.
 */

export interface FrameRate {
  /** Nominal integer rate used for the FF field: 24, 25, 30, 50, 60. */
  nominal: number;
  /** True for 23.976 / 29.97 / 59.94 — the /1.001 rates. */
  ntsc: boolean;
  /** True if the count skips frame numbers to track wall clock. Only valid for NTSC 30/60. */
  dropFrame: boolean;
}

export const RATE_25: FrameRate = { nominal: 25, ntsc: false, dropFrame: false };
export const RATE_24: FrameRate = { nominal: 24, ntsc: false, dropFrame: false };
export const RATE_2997_DF: FrameRate = { nominal: 30, ntsc: true, dropFrame: true };
export const RATE_2997_NDF: FrameRate = { nominal: 30, ntsc: true, dropFrame: false };
export const RATE_30: FrameRate = { nominal: 30, ntsc: false, dropFrame: false };

/** Actual frames per second, e.g. 30000/1001 for NTSC 30. */
export function fps(rate: FrameRate): number {
  return rate.ntsc ? (rate.nominal * 1000) / 1001 : rate.nominal;
}

export function secondsToFrames(seconds: number, rate: FrameRate): number {
  return Math.round(seconds * fps(rate));
}

export function framesToSeconds(frames: number, rate: FrameRate): number {
  return frames / fps(rate);
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/**
 * Frame count to `HH:MM:SS:FF` (or `HH:MM:SS;FF` for drop-frame, the
 * conventional marker).
 */
export function framesToTimecode(frames: number, rate: FrameRate): string {
  const negative = frames < 0;
  let f = Math.abs(Math.round(frames));
  const n = rate.nominal;

  if (rate.dropFrame) {
    if (n !== 30 && n !== 60) throw new Error(`drop-frame is undefined at ${n} fps`);
    const dropPerMinute = n / 15; // 2 at 30 fps, 4 at 60
    const framesPer10Min = n * 60 * 10 - dropPerMinute * 9;
    const framesPerMin = n * 60 - dropPerMinute;

    const tenMinBlocks = Math.floor(f / framesPer10Min);
    let rem = f % framesPer10Min;
    // The first minute of each 10-minute block drops nothing.
    const firstMinute = n * 60;
    let minutes = tenMinBlocks * 10;
    if (rem >= firstMinute) {
      rem -= firstMinute;
      minutes += 1 + Math.floor(rem / framesPerMin);
      rem = rem % framesPerMin;
      f = rem + dropPerMinute; // re-add the dropped numbers for the FF field
    } else {
      f = rem;
    }
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    const ss = Math.floor(f / n);
    const ff = f % n;
    return `${negative ? '-' : ''}${pad(hh)}:${pad(mm)}:${pad(ss)};${pad(ff)}`;
  }

  const ff = f % n;
  const totalSeconds = Math.floor(f / n);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${negative ? '-' : ''}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** Parse `HH:MM:SS:FF` or `HH:MM:SS;FF` back to a frame count. */
export function timecodeToFrames(tc: string, rate: FrameRate): number {
  const m = /^(-)?(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(tc.trim());
  if (!m) throw new Error(`Not a timecode: ${tc}`);
  const sign = m[1] ? -1 : 1;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  const ss = Number(m[4]);
  const ff = Number(m[5]);
  const n = rate.nominal;

  if (rate.dropFrame) {
    const dropPerMinute = n / 15;
    const totalMinutes = hh * 60 + mm;
    const dropped = dropPerMinute * (totalMinutes - Math.floor(totalMinutes / 10));
    return sign * (((hh * 3600 + mm * 60 + ss) * n + ff) - dropped);
  }
  return sign * ((hh * 3600 + mm * 60 + ss) * n + ff);
}

export function secondsToTimecode(seconds: number, rate: FrameRate): string {
  return framesToTimecode(secondsToFrames(seconds, rate), rate);
}

/** Seconds since midnight for a timecode — the form the sync engine wants. */
export function timecodeToSeconds(tc: string, rate: FrameRate): number {
  return framesToSeconds(timecodeToFrames(tc, rate), rate);
}

export * from './bwf.js';
export * from './tmcd.js';

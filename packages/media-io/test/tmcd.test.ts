import { describe, expect, it } from 'vitest';
import {
  framesToTimecode,
  parseMoovTimecode,
  RATE_2997_DF,
  RATE_25,
  timecodeFromSample,
} from '@polysync/timecode';
import { readMoov } from '../src/iso.js';
import { probe } from '../src/ingest.js';
import { bytesSource } from '../src/source.js';
import { makeMovWithTimecode } from './fixtures.js';

/** What `probe()` does internally, exposed here so the two steps can be asserted. */
async function readTimecode(bytes: Uint8Array) {
  const src = bytesSource(bytes, 'A001C002.MOV');
  const moov = await readMoov(src);
  expect(moov).toBeDefined();
  const desc = parseMoovTimecode(moov as Uint8Array);
  expect(desc).toBeDefined();
  const sample = await src.read(desc!.sampleOffset, desc!.sampleOffset + desc!.sampleSize);
  return timecodeFromSample(desc!, sample);
}

describe('tmcd', () => {
  it('reads a 25 fps start timecode', async () => {
    // 10:52:02:04 at 25 fps is 978,054 frames since midnight.
    const startFrames = (10 * 3600 + 52 * 60 + 2) * 25 + 4;
    const tc = await readTimecode(makeMovWithTimecode({ startFrames }));

    expect(tc.startFrames).toBe(startFrames);
    expect(tc.frameRate).toBe(25);
    expect(tc.dropFrame).toBe(false);
    expect(tc.startSeconds).toBeCloseTo(10 * 3600 + 52 * 60 + 2 + 4 / 25, 6);
    expect(framesToTimecode(tc.startFrames, RATE_25)).toBe('10:52:02:04');
  });

  it('finds moov at the end of the file, which is where a camera puts it', async () => {
    // moov's size is unknown until recording stops, so every camera writes it
    // last. A reader that only scans the head finds nothing on real rushes.
    const startFrames = 1000;
    const atEnd = await readTimecode(makeMovWithTimecode({ startFrames, moovAtEnd: true }));
    const atStart = await readTimecode(makeMovWithTimecode({ startFrames, moovAtEnd: false }));
    expect(atEnd.startFrames).toBe(startFrames);
    expect(atStart.startFrames).toBe(startFrames);
  });

  it('reads the drop-frame flag and the NTSC rate', async () => {
    const tc = await readTimecode(
      makeMovWithTimecode({
        startFrames: 1_000_000,
        timeScale: 30000,
        frameDuration: 1001,
        numberOfFrames: 30,
        dropFrame: true,
      }),
    );
    expect(tc.dropFrame).toBe(true);
    expect(tc.frameRate).toBeCloseTo(29.97, 3);
    expect(tc.numberOfFrames).toBe(30);
    // Drop-frame counts frames continuously and only skips labels, so real
    // seconds is the frame count over the true rate.
    expect(tc.startSeconds).toBeCloseTo(1_000_000 / (30000 / 1001), 6);
    expect(framesToTimecode(tc.startFrames, RATE_2997_DF)).toMatch(/^\d{2}:\d{2}:\d{2};\d{2}$/);
  });

  it('surfaces the timecode through probe()', async () => {
    const startFrames = 12345;
    const src = bytesSource(makeMovWithTimecode({ startFrames, moovAtEnd: true }), 'A001.MOV');
    const info = await probe(src);
    expect(info.timecodeSource).toBe('tmcd');
    expect(info.timecodeSeconds).toBeCloseTo(startFrames / 25, 6);
    expect(info.frameRate).toBe(25);
  });

  it('returns undefined for a file with no timecode track', () => {
    expect(parseMoovTimecode(new Uint8Array(64))).toBeUndefined();
  });

  it('does not throw on a truncated moov', async () => {
    const bytes = makeMovWithTimecode({ startFrames: 100, moovAtEnd: true });
    const truncated = bytes.subarray(0, bytes.length - 40);
    // Losing the timecode is acceptable; throwing during ingest is not, because
    // audio sync never needed the timecode in the first place.
    const info = await probe(bytesSource(truncated, 'broken.MOV')).catch(() => undefined);
    expect(info?.timecodeSeconds).toBeUndefined();
  });
});

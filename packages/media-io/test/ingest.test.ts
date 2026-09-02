import { describe, expect, it } from 'vitest';
import { designLowpass, firFilter, syncProject, type AudioClip } from '@polysync/sync-core';
import { ingest, probe } from '../src/ingest.js';
import { bytesSource } from '../src/source.js';
import { makeWav, noiseBurst } from './fixtures.js';

const SR = 48000;

/**
 * A shoot: one clean recorder feed and cameras hearing the same event through
 * a cheap on-board mic from across the room.
 *
 * The degradation is the point. A camera mic is 20-30 dB down, band-limited to
 * roughly 250 Hz - 5 kHz, and carries its own noise floor. Raw waveform
 * correlation between that and a boom is close to worthless, which is why the
 * engine uses PHAT weighting — and why a test on undegraded copies of the same
 * signal would prove nothing at all.
 */
function scratchMic(master: Float64Array, from: number, frames: number, seed: number): Float64Array {
  const window = master.subarray(from, from + frames);
  const band = firFilter(Float64Array.from(window), designLowpass(5000 / SR, 127));
  const noise = noiseBurst(frames, seed);
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    // ~26 dB down, plus an independent noise floor.
    out[i] = band[i] * 0.05 + noise[i] * 0.004;
  }
  return out;
}

function cleanFeed(master: Float64Array, from: number, frames: number): Float64Array {
  return Float64Array.from(master.subarray(from, from + frames));
}

describe('ingest', () => {
  it('reads a BWF start timecode and channel names through probe()', async () => {
    const ixml = `<BWFXML><SPEED><TIMECODE_RATE>25/1</TIMECODE_RATE>
      <TIMECODE_FLAG>NDF</TIMECODE_FLAG></SPEED>
      <TRACK_LIST><TRACK><CHANNEL_INDEX>1</CHANNEL_INDEX><NAME>Boom</NAME></TRACK>
      <TRACK><CHANNEL_INDEX>2</CHANNEL_INDEX><NAME>Lav1</NAME></TRACK></TRACK_LIST></BWFXML>`;
    const seconds = 10 * 3600 + 52 * 60 + 2;
    const bytes = makeWav({
      channels: 2,
      frames: SR,
      timeReference: seconds * SR,
      ixml,
    });

    const info = await probe(bytesSource(bytes, 'MIX_001.WAV'));
    expect(info.timecodeSource).toBe('bext');
    expect(info.timecodeSeconds).toBeCloseTo(seconds, 6);
    expect(info.channelNames).toEqual(['Boom', 'Lav1']);
    expect(info.frameRate).toBe(25);
    expect(info.channels).toBe(2);
    expect(info.hasVideo).toBe(false);
    expect(info.decodable).toBe(true);
  });

  it('decodes to the working rate rather than the native rate', async () => {
    const bytes = makeWav({ frames: SR * 4, sampleRate: SR });
    const { clip } = await ingest(bytesSource(bytes, 'x.wav'), 'c1');
    // The default policy picks 16 kHz: 62 us of resolution before parabolic
    // interpolation, which is about 1/640th of a frame at 25 fps.
    expect(clip.sampleRate).toBe(16000);
    expect(clip.samples.length).toBeCloseTo(16000 * 4, -2);
  });

  it('honours an explicit working rate', async () => {
    const bytes = makeWav({ frames: SR, sampleRate: SR });
    const { clip } = await ingest(bytesSource(bytes, 'x.wav'), 'c1', { workingRate: 8000 });
    expect(clip.sampleRate).toBe(8000);
  });

  it('reports progress and finishes at 1', async () => {
    const seen: number[] = [];
    const bytes = makeWav({ frames: SR * 2, sampleRate: SR });
    await ingest(bytesSource(bytes, 'x.wav'), 'c1', { onProgress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(1);
    expect(Math.min(...seen)).toBeGreaterThan(0);
  });

  it('explains an undecodable file instead of failing opaquely', async () => {
    // "Could not prepare media to synchronize" told PluralEyes users nothing.
    // Name the file, name the codec, say what to do.
    const bytes = makeWav({ frames: 100 });
    const info = await probe(bytesSource(bytes, 'ok.wav'));
    expect(info.undecodableReason).toBeUndefined();

    const notMedia = bytesSource(new Uint8Array(4096), 'mystery.dat');
    await expect(ingest(notMedia, 'c1')).rejects.toThrow();
  });
});

describe('ingest into syncProject', () => {
  it('solves a three-device shoot end to end, from file bytes to placements', async () => {
    // 60 s of source material; each device sees a different 30 s window of it.
    const master = noiseBurst(SR * 60, 99);
    const clipFrames = SR * 30;

    // Ground truth, in seconds from the start of the recorder's clip.
    const recorderStart = SR * 5;
    const camAStart = SR * 11; // +6 s
    const camBStart = SR * 18; // +13 s

    const files: Array<{ id: string; track: string; name: string; bytes: Uint8Array }> = [
      {
        id: 'rec',
        track: 'REC',
        name: 'MIX_001.WAV',
        bytes: makeWav({
          sampleRate: SR,
          frames: clipFrames,
          signals: [cleanFeed(master, recorderStart, clipFrames)],
          bitsPerSample: 24,
        }),
      },
      {
        id: 'camA',
        track: 'CAM_A',
        name: 'A001C001.WAV',
        bytes: makeWav({
          sampleRate: SR,
          frames: clipFrames,
          signals: [scratchMic(master, camAStart, clipFrames, 21)],
        }),
      },
      {
        id: 'camB',
        track: 'CAM_B',
        name: 'B001C001.WAV',
        bytes: makeWav({
          sampleRate: SR,
          frames: clipFrames,
          signals: [scratchMic(master, camBStart, clipFrames, 22)],
        }),
      },
    ];

    const clips: AudioClip[] = [];
    for (const file of files) {
      const { clip, probe: info } = await ingest(bytesSource(file.bytes, file.name), file.id);
      expect(info.durationSeconds).toBeCloseTo(30, 3);
      clips.push({ ...clip, trackId: file.track });
    }

    const result = syncProject(clips);

    expect(result.unsyncedClipIds).toEqual([]);
    expect(result.groupCount).toBe(1);
    expect(result.inconsistencies).toEqual([]);

    const at = (id: string) =>
      result.placements.find((p) => p.clipId === id)?.startSeconds as number;
    const origin = at('rec');
    // Everything is relative, so measure each camera against the recorder.
    expect(at('camA') - origin).toBeCloseTo((camAStart - recorderStart) / SR, 2);
    expect(at('camB') - origin).toBeCloseTo((camBStart - recorderStart) / SR, 2);

    for (const placement of result.placements) {
      expect(placement.synced, `${placement.clipId} synced`).toBe(true);
      expect(placement.quality as number, `${placement.clipId} quality`).toBeGreaterThan(0.3);
    }
  }, 60_000);

  it('refuses to place material from a different shoot', async () => {
    const master = noiseBurst(SR * 40, 5);
    const stranger = noiseBurst(SR * 20, 4242); // unrelated recording
    const frames = SR * 20;

    const build = async (id: string, signal: Float64Array, name: string) => {
      const bytes = makeWav({ sampleRate: SR, frames: signal.length, signals: [signal] });
      const { clip } = await ingest(bytesSource(bytes, name), id);
      return { ...clip, trackId: id.toUpperCase() };
    };

    const clips = [
      await build('rec', cleanFeed(master, 0, frames), 'MIX.WAV'),
      await build('camA', scratchMic(master, SR * 4, frames, 31), 'A001.WAV'),
      await build('other', stranger, 'ELSEWHERE.WAV'),
    ];

    const result = syncProject(clips);
    // The tool that places a clip confidently and wrongly is worse than the one
    // that says it does not know.
    expect(result.unsyncedClipIds).toContain('other');
    expect(result.unsyncedClipIds).not.toContain('camA');
  }, 60_000);
});

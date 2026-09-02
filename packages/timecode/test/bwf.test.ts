import { describe, expect, it } from 'vitest';
import { bwfStartSeconds, ixmlFrameRate, parseBext, parseIXml } from '../src/bwf.js';
import { framesToTimecode, RATE_25, secondsToFrames } from '../src/index.js';

function makeBextBytes(timeReference: number, extra: Partial<Record<string, string>> = {}): Uint8Array {
  const out = new Uint8Array(602);
  const write = (s: string, at: number) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i) & 0xff;
  };
  write(extra.description ?? 'sSPEED=025.000-ND', 0);
  write(extra.originator ?? 'Sound Devices 833', 256);
  write('2026-09-02', 320);
  write('10:52:02', 330);
  const view = new DataView(out.buffer);
  view.setUint32(338, timeReference >>> 0, true);
  view.setUint32(342, Math.floor(timeReference / 0x1_0000_0000), true);
  view.setUint16(346, 1, true);
  return out;
}

describe('parseBext', () => {
  it('reads the fields a recorder writes', () => {
    const bext = parseBext(makeBextBytes(48000 * 3600));
    expect(bext?.originator).toBe('Sound Devices 833');
    expect(bext?.originationDate).toBe('2026-09-02');
    expect(bext?.originationTime).toBe('10:52:02');
    expect(bext?.timeReference).toBe(48000 * 3600);
    expect(bext?.version).toBe(1);
  });

  it('recombines the two halves of the 64-bit sample count', () => {
    // TimeReference is stored as two 32-bit words, and the high one is not
    // decorative: at 96 kHz it becomes non-zero after 12h25m, and at 192 kHz
    // after 6h12m. An afternoon session on a high-rate recorder overflows it,
    // and a reader that takes only the low word lands half a day out.
    const seconds = 20 * 3600; // 20:00:00, an ordinary evening timecode
    const samples = seconds * 96000;
    expect(samples).toBeGreaterThan(0xffffffff);

    const bext = parseBext(makeBextBytes(samples));
    expect(bext?.timeReference).toBe(samples);
    expect(bwfStartSeconds(bext, undefined, 96000)).toBeCloseTo(seconds, 6);

    // What the low word alone would have given: 32,187 seconds out.
    const lowWordOnly = samples >>> 0;
    expect(Math.abs(lowWordOnly / 96000 - seconds)).toBeGreaterThan(30000);
  });

  it('returns undefined for a chunk too short to be a bext', () => {
    expect(parseBext(new Uint8Array(100))).toBeUndefined();
  });
});

describe('parseIXml', () => {
  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<BWFXML>
  <IXML_VERSION>2.10</IXML_VERSION>
  <PROJECT>Shoot Day 1</PROJECT>
  <SCENE>12A</SCENE>
  <TAKE>3</TAKE>
  <NOTE>Wind on the boom</NOTE>
  <SPEED>
    <NOTE>speed block</NOTE>
    <TIMECODE_RATE>30000/1001</TIMECODE_RATE>
    <TIMECODE_FLAG>DF</TIMECODE_FLAG>
    <FILE_SAMPLE_RATE>48000</FILE_SAMPLE_RATE>
    <TIMECODE_SAMPLE_RATE>48048</TIMECODE_SAMPLE_RATE>
  </SPEED>
  <TRACK_LIST>
    <TRACK_COUNT>3</TRACK_COUNT>
    <TRACK><CHANNEL_INDEX>1</CHANNEL_INDEX><NAME>Boom</NAME></TRACK>
    <TRACK><CHANNEL_INDEX>2</CHANNEL_INDEX><NAME>Lav1</NAME></TRACK>
    <TRACK><CHANNEL_INDEX>3</CHANNEL_INDEX><NAME>Lav2</NAME></TRACK>
  </TRACK_LIST>
</BWFXML>`;

  it('reads the timecode rate as a rational', () => {
    const ixml = parseIXml(sample);
    expect(ixml.timecodeRate).toEqual({ numerator: 30000, denominator: 1001 });
    expect(ixmlFrameRate(ixml)).toBeCloseTo(29.97, 3);
    expect(ixml.dropFrame).toBe(true);
  });

  it('reads channel names, so the UI can say Boom rather than ch1', () => {
    expect(parseIXml(sample).trackNames).toEqual(['Boom', 'Lav1', 'Lav2']);
  });

  it('keeps the timecode sample rate separate from the file sample rate', () => {
    // On a pull-up/pull-down recording these differ, and dividing by the wrong
    // one gives a start offset that drifts — the classic undiagnosable bug.
    const ixml = parseIXml(sample);
    expect(ixml.fileSampleRate).toBe(48000);
    expect(ixml.timecodeSampleRate).toBe(48048);

    const bext = parseBext(makeBextBytes(48048 * 100));
    expect(bwfStartSeconds(bext, ixml, 48000)).toBeCloseTo(100, 6);
    // Using the file rate instead would put the clip 100 ms late.
    expect(bwfStartSeconds(bext, undefined, 48000)).toBeCloseTo(100.1, 3);
  });

  it('survives the unescaped ampersand real recorders write into scene names', () => {
    const ixml = parseIXml('<BWFXML><SCENE>Bride & Groom</SCENE><TAKE>1</TAKE></BWFXML>');
    expect(ixml.scene).toBe('Bride & Groom');
    expect(ixml.take).toBe('1');
  });

  it('decodes entities where they are used properly', () => {
    expect(parseIXml('<BWFXML><NOTE>a &amp; b &lt;c&gt;</NOTE></BWFXML>').note).toBe('a & b <c>');
  });

  it('returns an empty result rather than throwing on junk', () => {
    expect(parseIXml('not xml at all')).toEqual({
      project: undefined,
      scene: undefined,
      take: undefined,
      note: undefined,
    });
  });

  it('falls back to document order when a track has no channel index', () => {
    const ixml = parseIXml(
      '<TRACK_LIST><TRACK><NAME>A</NAME></TRACK><TRACK><NAME>B</NAME></TRACK></TRACK_LIST>',
    );
    expect(ixml.trackNames).toEqual(['A', 'B']);
  });
});

describe('bext to displayable timecode', () => {
  it('lands on the timecode the recorder was showing', () => {
    // 10:52:02:04 at 25 fps.
    const seconds = 10 * 3600 + 52 * 60 + 2 + 4 / 25;
    const bext = parseBext(makeBextBytes(Math.round(seconds * 48000)));
    const start = bwfStartSeconds(bext, undefined, 48000);
    expect(start).toBeDefined();
    expect(framesToTimecode(secondsToFrames(start as number, RATE_25), RATE_25)).toBe(
      '10:52:02:04',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { RATE_25, RATE_2997_DF, framesToTimecode, timecodeToFrames } from '@polysync/timecode';
import { exportEdl, exportFcp7Xml, pathToFileUrl, sanitiseReel } from '../src/index.js';
import type { TimelineProject } from '../src/index.js';

const project: TimelineProject = {
  name: 'Shoot Day 01',
  rate: RATE_25,
  clips: [
    {
      id: 'rec1',
      name: 'ZOOM0007.WAV',
      path: '/Volumes/Card A/AUDIO/ZOOM0007.WAV',
      trackId: 'REC',
      startSeconds: 0,
      durationSeconds: 120,
      hasVideo: false,
      hasAudio: true,
      audioChannels: 2,
      synced: true,
    },
    {
      id: 'camA1',
      name: 'A001C002.MOV',
      path: '/Volumes/Card B/DCIM/100CANON/A001C002.MOV',
      trackId: 'CAM_A',
      startSeconds: 8.04,
      durationSeconds: 60,
      hasVideo: true,
      hasAudio: true,
      width: 3840,
      height: 2160,
      synced: true,
    },
    {
      id: 'orphan',
      name: 'B002 & misc.MOV',
      path: '/Volumes/Card C/B002 & misc.MOV',
      trackId: 'CAM_B',
      startSeconds: 200,
      durationSeconds: 30,
      hasVideo: true,
      hasAudio: true,
      synced: false,
    },
  ],
};

describe('timecode', () => {
  it('round-trips non-drop-frame', () => {
    const tc = framesToTimecode(90_000, RATE_25); // 1 hour
    expect(tc).toBe('01:00:00:00');
    expect(timecodeToFrames(tc, RATE_25)).toBe(90_000);
  });

  it('round-trips drop-frame across a minute boundary', () => {
    for (const frames of [0, 1799, 1800, 1801, 17_982, 107_892, 1_000_000]) {
      const tc = framesToTimecode(frames, RATE_2997_DF);
      expect(timecodeToFrames(tc, RATE_2997_DF)).toBe(frames);
    }
  });

  it('skips frame numbers 00 and 01 at the start of a drop-frame minute', () => {
    // Frame 1800 is 00:01:00 in real time; drop-frame labels it ;02.
    expect(framesToTimecode(1800, RATE_2997_DF)).toBe('00:01:00;02');
    // But not at the tenth minute.
    expect(framesToTimecode(17_982, RATE_2997_DF)).toBe('00:10:00;00');
  });
});

describe('FCP7 XML export', () => {
  const xml = exportFcp7Xml(project);

  it('is well-formed XMEML v5', () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<!DOCTYPE xmeml>');
    expect(xml).toContain('<xmeml version="5">');
    expect(xml.trimEnd().endsWith('</xmeml>')).toBe(true);
    // Every opened tag is closed.
    const opens = (xml.match(/<sequence\b/g) ?? []).length;
    const closes = (xml.match(/<\/sequence>/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('places clips at the correct frame', () => {
    // 8.04 s at 25 fps = frame 201.
    expect(xml).toContain('<start>201</start>');
    expect(xml).toContain('<end>1701</end>');
  });

  it('gives every device its own audio track, not just the topmost', () => {
    // The sequence-level <audio> block is the one indented six spaces; the
    // others are inside <file><media>.
    const start = xml.indexOf('\n      <audio>');
    const audioBlock = xml.slice(start, xml.indexOf('\n      </audio>'));
    expect(audioBlock).toContain('<!-- REC ch1 -->');
    expect(audioBlock).toContain('<!-- CAM_A ch1 -->');
    expect(audioBlock).toContain('<!-- CAM_B ch1 -->');
  });

  it('gives every source channel its own track', () => {
    // FCP7 XML has no stereo-clip-on-one-track concept: a two-channel source
    // is two clipitems on two tracks, told apart by <trackindex>. Emitting
    // only trackindex 1 brings in half the audio at best.
    const start = xml.indexOf('\n      <audio>');
    const audioBlock = xml.slice(start, xml.indexOf('\n      </audio>'));
    expect(audioBlock).toContain('<!-- CAM_A ch2 -->');
    expect(audioBlock).toContain('<trackindex>2</trackindex>');
    // Three stereo sources, two channels each.
    expect((audioBlock.match(/<track>/g) ?? []).length).toBe(6);
  });

  it('colours unsynced clips and leaves synced ones alone', () => {
    expect(xml).toContain('<label2>Rose</label2>');
    // The one unsynced clip has picture and two channels of sound, so it
    // contributes one video and two audio clipitems — three labels, and none
    // from the synced clips.
    expect((xml.match(/<label2>/g) ?? []).length).toBe(3);
  });

  it('escapes XML metacharacters in names', () => {
    expect(xml).toContain('B002 &amp; misc.MOV');
    expect(xml).not.toContain('B002 & misc.MOV');
  });

  it('defines each source file once and references it thereafter', () => {
    // One full definition on the video clipitem; one bare reference per audio
    // channel. Repeating the definition bloats the file and confuses Premiere.
    expect((xml.match(/<file id="file-camA1">/g) ?? []).length).toBe(1);
    expect((xml.match(/<file id="file-camA1"\/>/g) ?? []).length).toBe(2);
  });

  it('produces XML ids a parser will accept, whatever the file is called', () => {
    // A real export carried `clipitem- C2_4928.MP4-video`, from a file whose
    // name began with a space. XML ID attributes cannot contain spaces.
    const ids = [...xml.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id, `bad XML id: ${JSON.stringify(id)}`).toMatch(/^[A-Za-z_][A-Za-z0-9._-]*$/);
    }
  });

  it('can turn off unsynced colouring', () => {
    expect(exportFcp7Xml(project, { colourUnsynced: false })).not.toContain('<label2>');
  });
});

describe('pathToFileUrl', () => {
  it('percent-encodes spaces but keeps separators', () => {
    expect(pathToFileUrl('/Volumes/Card A/x y.mov')).toBe('file:///Volumes/Card%20A/x%20y.mov');
  });

  it('normalises Windows paths', () => {
    expect(pathToFileUrl('D:\\Rushes\\A001.MOV')).toBe('file:///D%3A/Rushes/A001.MOV');
  });
});

describe('EDL export', () => {
  const edls = exportEdl(project);

  it('emits one EDL per track', () => {
    expect([...edls.keys()].sort()).toEqual(['CAM_A', 'CAM_B', 'REC']);
  });

  it('has a CMX3600 header and correctly formatted events', () => {
    const edl = edls.get('CAM_A')!;
    expect(edl).toContain('FCM: NON-DROP FRAME');
    expect(edl).toMatch(/^001\s+\S+\s+AA\/V\s+C\s+00:00:00:00 00:01:00:00 00:00:08:01 00:01:08:01$/m);
  });

  it('flags unsynced clips in a comment', () => {
    expect(edls.get('CAM_B')!).toContain('* COMMENT: UNSYNCED');
    expect(edls.get('CAM_A')!).not.toContain('UNSYNCED');
  });

  it('includes a reel map so 8-character reels stay traceable', () => {
    expect(edls.get('CAM_B')!).toContain('* REEL MAP');
    expect(edls.get('CAM_B')!).toContain('B002 & misc.MOV');
  });
});

describe('sanitiseReel', () => {
  it('truncates to 8 characters and strips illegal characters', () => {
    expect(sanitiseReel('A001C002 take-3.MOV', new Set())).toBe('A001C002');
  });

  it('resolves collisions without exceeding 8 characters', () => {
    const taken = new Set<string>();
    const a = sanitiseReel('A001C002x', taken);
    const b = sanitiseReel('A001C002y', taken);
    expect(a).toBe('A001C002');
    expect(b).toBe('A001C001');
    expect(b.length).toBeLessThanOrEqual(8);
  });

  it('falls back to REEL for a name with nothing usable in it', () => {
    expect(sanitiseReel('!!!', new Set())).toBe('REEL');
  });
});

describe('track layout', () => {
  it('numbers tracks from the start of the sequence, not alphabetically', () => {
    // V1 should be the track that opens the sequence. Sorting track ids by name
    // put whichever device happened to sort first on V1, which for a project
    // whose recorder is called REC and whose cameras are CAM_* meant the
    // cameras came first and the sound sat under them.
    const xml = exportFcp7Xml(project);
    const order = [...xml.matchAll(/<!-- ([^-]+?) -->/g)].map((m) => m[1].trim());
    expect(order[0]).toBe('CAM_A');
  });

  it('keeps two clips of the same name on separate tracks', () => {
    // Two cards, both writing C0001.MP4. Under a one-track-per-clip layout
    // these must not land on the same track — that is the entire point of the
    // layout — so the track key has to be the clip id and not its name.
    const collide: TimelineProject = {
      name: 'Two cards',
      rate: RATE_25,
      clips: [
        {
          id: 'a-C0001',
          name: 'C0001.MP4',
          path: '/x/A/C0001.MP4',
          trackId: 'a-C0001',
          trackLabel: 'C0001.MP4 (FOOTAGE-A)',
          startSeconds: 0,
          durationSeconds: 10,
          hasVideo: true,
          hasAudio: false,
          synced: true,
        },
        {
          id: 'b-C0001',
          name: 'C0001.MP4',
          path: '/x/B/C0001.MP4',
          trackId: 'b-C0001',
          trackLabel: 'C0001.MP4 (FOOTAGE-B)',
          startSeconds: 3,
          durationSeconds: 10,
          hasVideo: true,
          hasAudio: false,
          synced: true,
        },
      ],
    };
    const xml = exportFcp7Xml(collide);
    // Neither clip has audio, so every track in the document is a video track.
    expect(xml.match(/<track>/g)).toHaveLength(2);
    expect(xml).toContain('C0001.MP4 (FOOTAGE-A)');
    expect(xml).toContain('C0001.MP4 (FOOTAGE-B)');
    // Both clipitems must survive with distinct ids, or one clip vanishes.
    expect(xml).toContain('clipitem-a-C0001-video');
    expect(xml).toContain('clipitem-b-C0001-video');
  });
});

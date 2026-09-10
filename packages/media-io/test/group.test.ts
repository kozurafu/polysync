import { describe, expect, it } from 'vitest';
import { groupClips, type GroupInput } from '../src/group.js';
import { identityKey, relink, type FileIdentity } from '../src/identity.js';

function inputs(...paths: string[]): GroupInput[] {
  return paths.map((path, i) => ({ id: `c${i}`, path }));
}

function deviceOf(result: ReturnType<typeof groupClips>, clipId: string): string | undefined {
  return result.assignments.find((a) => a.clipId === clipId)?.deviceId;
}

describe('groupClips', () => {
  it('groups by camera-card structure, naming the device from the folder above it', () => {
    const result = groupClips(
      inputs(
        'CAM_A/PRIVATE/AVCHD/BDMV/STREAM/00000.MTS',
        'CAM_A/PRIVATE/AVCHD/BDMV/STREAM/00001.MTS',
        'CAM_B/PRIVATE/AVCHD/BDMV/STREAM/00000.MTS',
      ),
    );
    expect(result.basis).toBe('card-structure');
    expect(deviceOf(result, 'c0')).toBe('CAM_A');
    expect(deviceOf(result, 'c2')).toBe('CAM_B');
    expect(result.deviceIds).toEqual(['CAM_A', 'CAM_B']);
  });

  it('separates cameras that sit inside a shared parent folder', () => {
    // Reported 2026-09-10 from a real 249-file project laid out exactly like
    // this. Keying on the first path segment called both cameras FOOTAGE, and
    // since a device cannot match itself, C1 and C2 — the two most likely
    // things in the project to sync — became the one pair the engine would
    // never look at.
    const result = groupClips(
      inputs(
        'Audio/260821_140448_Tr1.WAV',
        'Audio/260821_153800_Tr1.WAV',
        'Footage/C1/C1_4676.MP4',
        'Footage/C1/C1_4677.MP4',
        'Footage/C2/C2_4737.MP4',
        'Footage/C2/C2_4738.MP4',
      ),
    );
    expect(result.basis).toBe('directory');
    expect(deviceOf(result, 'c0')).toBe('AUDIO');
    expect(deviceOf(result, 'c2')).toBe('FOOTAGE-C1');
    expect(deviceOf(result, 'c4')).toBe('FOOTAGE-C2');
    expect(result.deviceIds).toHaveLength(3);
  });

  it('does not go deeper than it needs to', () => {
    // One camera's rushes filed by date. Splitting on the day would invent
    // three devices out of one, and each would then be barred from matching
    // the others.
    const result = groupClips(
      inputs(
        'CAM_A/day1/a.mov',
        'CAM_A/day2/b.mov',
        'CAM_A/day3/c.mov',
        'REC/mix.wav',
      ),
    );
    expect(result.deviceIds).toEqual(['CAM_A', 'REC']);
  });

  it('keeps a clip that sits beside the camera folders rather than failing', () => {
    const result = groupClips(
      inputs('Footage/C1/a.mov', 'Footage/C2/b.mov', 'Audio/mix.wav'),
    );
    expect(result.basis).toBe('directory');
    expect(deviceOf(result, 'c2')).toBe('AUDIO');
  });

  it('splits two cards that use identical default filenames', () => {
    // Two Sony bodies both start at C0001. The folder names say nothing, but
    // one device cannot write the same filename twice, so the collision is
    // proof on its own.
    const result = groupClips(
      inputs(
        'Footage/A/C0001.MP4',
        'Footage/A/C0002.MP4',
        'Footage/B/C0001.MP4',
        'Footage/B/C0002.MP4',
      ),
    );
    expect(result.deviceIds).toEqual(['FOOTAGE-A', 'FOOTAGE-B']);
  });

  it('does not split one camera filed by date, whatever the reel numbers say', () => {
    const result = groupClips(
      inputs(
        'CAM_A/day1/A001C001.MOV',
        'CAM_A/day1/A001C002.MOV',
        'CAM_A/day2/A002C001.MOV',
        'REC/mix.wav',
      ),
    );
    expect(result.deviceIds).toEqual(['CAM_A', 'REC']);
  });

  it('recognises XDCAM BPAV and P2 Contents layouts', () => {
    const xdcam = groupClips(
      inputs('CardOne/BPAV/CLPR/CLIP0001/CLIP0001.MP4', 'CardTwo/BPAV/CLPR/CLIP0001/CLIP0001.MP4'),
    );
    expect(xdcam.basis).toBe('card-structure');
    expect(xdcam.deviceIds).toEqual(['CARDONE', 'CARDTWO']);

    const p2 = groupClips(
      inputs('P2_A/CONTENTS/VIDEO/0001AB.MXF', 'P2_B/CONTENTS/VIDEO/0002AB.MXF'),
    );
    expect(p2.basis).toBe('card-structure');
    expect(p2.deviceIds).toEqual(['P2_A', 'P2_B']);
  });

  it('warns when an AVCHD stream has been dragged out of its card folder', () => {
    // This is the commonest reason a spanned clip syncs as loose fragments,
    // and PluralEyes gave no hint at all when it happened.
    const result = groupClips([
      { id: 'a', path: 'CAM_A/PRIVATE/AVCHD/BDMV/STREAM/00000.MTS' },
      { id: 'b', path: '00001.MTS' },
    ]);
    expect(result.warnings.join(' ')).toMatch(/outside its card folder/);
  });

  it('groups by top-level folder, which is how people actually organise a shoot', () => {
    const result = groupClips(
      inputs('CamA/clip1.mov', 'CamA/clip2.mov', 'Recorder/ZOOM0001.WAV'),
    );
    expect(result.basis).toBe('directory');
    expect(deviceOf(result, 'c0')).toBe('CAMA');
    expect(deviceOf(result, 'c2')).toBe('RECORDER');
  });

  it('falls back to the filename reel when everything sits in one folder', () => {
    // Canon writes A001C002: the reel is A001 and the clip is C002, so
    // grouping on the leading letter alone would merge every card into one.
    const result = groupClips(
      inputs('A001C001_260902.MOV', 'A001C002_260902.MOV', 'B001C001_260902.MOV'),
    );
    expect(result.basis).toBe('filename-prefix');
    expect(deviceOf(result, 'c0')).toBe('A001');
    expect(deviceOf(result, 'c1')).toBe('A001');
    expect(deviceOf(result, 'c2')).toBe('B001');
  });

  it('separates a Zoom recorder from GoPro clips by filename prefix', () => {
    const result = groupClips(inputs('ZOOM0001.WAV', 'ZOOM0002.WAV', 'GX010123.MP4'));
    expect(result.basis).toBe('filename-prefix');
    expect(deviceOf(result, 'c0')).toBe('ZOOM');
    expect(deviceOf(result, 'c2')).toBe('GX');
  });

  it('uses container metadata when the filenames say nothing', () => {
    const result = groupClips([
      { id: 'c0', path: '0001.mp4', make: 'Sony', model: 'FX3' },
      { id: 'c1', path: '0002.mp4', make: 'Sony', model: 'FX3' },
      { id: 'c2', path: '0003.mp4', make: 'Canon', model: 'C70' },
    ]);
    expect(result.basis).toBe('container-metadata');
    expect(deviceOf(result, 'c0')).toBe('SONY_FX3');
    expect(deviceOf(result, 'c2')).toBe('CANON_C70');
  });

  it('splits picture from sound as the last resort', () => {
    const result = groupClips([
      { id: 'c0', path: '0001.mov', hasVideo: true },
      { id: 'c1', path: '0002.wav', hasVideo: false },
    ]);
    expect(result.basis).toBe('extension-class');
    expect(deviceOf(result, 'c0')).toBe('VIDEO');
    expect(deviceOf(result, 'c1')).toBe('AUDIO');
  });

  it('orders cameras before recorders, as an editor expects on a timeline', () => {
    const result = groupClips([
      { id: 'c0', path: 'REC/take1.wav', hasVideo: false },
      { id: 'c1', path: 'CamB/clip.mov', hasVideo: true },
      { id: 'c2', path: 'CamA/clip.mov', hasVideo: true },
    ]);
    expect(result.deviceIds).toEqual(['CAMA', 'CAMB', 'REC']);
  });

  it('reports one device rather than inventing a split, when there is only one', () => {
    const result = groupClips(inputs('CamA/clip1.mov', 'CamA/clip2.mov'));
    expect(new Set(result.assignments.map((a) => a.deviceId)).size).toBe(1);
  });

  it('records the basis of every assignment, so the UI can say why', () => {
    // PluralEyes' Smart Start was not overridable, which was the complaint.
    // Every decision here carries the evidence it was made on.
    const result = groupClips(inputs('CamA/x.mov', 'CamB/y.mov'));
    expect(result.assignments.every((a) => a.basis === 'directory')).toBe(true);
  });

  it('sanitises device names into something an EDL reel can hold', () => {
    const result = groupClips(inputs('Cam A (main)/x.mov', 'Cam B/y.mov'));
    expect(result.deviceIds).toEqual(['CAM_A_MAIN', 'CAM_B']);
  });

  it('handles an empty drop', () => {
    expect(groupClips([]).assignments).toEqual([]);
  });

  it('names a single camera from its files rather than calling it VIDEO', () => {
    // Reported 2026-09-04: 70 files named C2_49xx.MP4 in one flat folder came
    // back as one device called VIDEO, via the extension-class last resort,
    // because no prefix rule matched "C2_4928". The device name is the only
    // clue the user gets about what the tool thinks it is looking at.
    const result = groupClips(
      inputs('C2_4928.MP4', 'C2_4929.MP4', 'C2_4930.MP4', 'C2_4931.MP4'),
    );
    expect(result.basis).toBe('filename-prefix');
    expect(result.deviceIds).toEqual(['C2']);
  });

  it('warns, loudly, when everything came from one device', () => {
    // The single most useful thing to say when it is true: sync compares one
    // device against another, so with one device every clip comes back
    // unsynced however good the audio is. Saying nothing left a user watching
    // a 70-clip project fail with no explanation.
    const result = groupClips(inputs('C2_4928.MP4', 'C2_4929.MP4', 'C2_4930.MP4'));
    expect(result.deviceIds).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/one device/i);
    expect(result.warnings.join(' ')).toMatch(/at least two/i);
  });

  it('does not warn when there are two devices to compare', () => {
    const result = groupClips(inputs('CamA/clip.mov', 'REC/take.wav'));
    expect(result.warnings.join(' ')).not.toMatch(/one device/i);
  });

  it('separates two camera bodies by their filename prefix', () => {
    const result = groupClips(inputs('C2_4928.MP4', 'C2_4929.MP4', 'C1_0007.MP4'));
    expect(deviceOf(result, 'c0')).toBe('C2');
    expect(deviceOf(result, 'c2')).toBe('C1');
  });

  it('reads a Sony single-letter prefix', () => {
    const result = groupClips(inputs('C0001.MP4', 'C0002.MP4', 'ZOOM0001.WAV'));
    expect(deviceOf(result, 'c0')).toBe('C');
    expect(deviceOf(result, 'c2')).toBe('ZOOM');
  });
});

describe('relink', () => {
  const id = (relativePath: string, size: number, lastModified: number): FileIdentity => ({
    relativePath,
    size,
    lastModified,
  });

  it('keys on path, size and mtime — never the absolute path', () => {
    expect(identityKey(id('CAM_A/x.mov', 100, 42))).toBe('CAM_A/x.mov 100 42');
  });

  it('relinks a folder dropped again in the same shape', () => {
    const wanted = [id('CAM_A/x.mov', 100, 42), id('REC/y.wav', 200, 43)];
    const found = relink(wanted, [...wanted]);
    expect(found.get('CAM_A/x.mov')?.relativePath).toBe('CAM_A/x.mov');
    expect(found.get('REC/y.wav')?.relativePath).toBe('REC/y.wav');
  });

  it('follows a file that moved to a different folder', () => {
    const found = relink(
      [id('CAM_A/x.mov', 100, 42)],
      [id('Rushes/Day1/CAM_A/x.mov', 100, 42)],
    );
    expect(found.get('CAM_A/x.mov')?.relativePath).toBe('Rushes/Day1/CAM_A/x.mov');
  });

  it('matches on name and size when an offload tool rewrote the timestamps', () => {
    const found = relink([id('CAM_A/x.mov', 100, 42)], [id('Backup/x.mov', 100, 999)]);
    expect(found.get('CAM_A/x.mov')?.relativePath).toBe('Backup/x.mov');
  });

  it('never relinks two clips to the same file', () => {
    // Two identical-length takes must not both claim the one file present.
    const found = relink(
      [id('A/take.wav', 100, 42), id('B/take.wav', 100, 42)],
      [id('Found/take.wav', 100, 42)],
    );
    const matched = [...found.values()].filter(Boolean);
    expect(matched).toHaveLength(1);
  });

  it('reports a missing file as missing rather than guessing', () => {
    const found = relink([id('CAM_A/x.mov', 100, 42)], [id('CAM_A/other.mov', 5, 1)]);
    expect(found.get('CAM_A/x.mov')).toBeUndefined();
  });
});

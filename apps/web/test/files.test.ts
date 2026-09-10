import { describe, expect, it } from 'vitest';
import { MEDIA_ACCEPT, isMediaFile, mergePicked, pickedIdentity } from '../src/lib/files.ts';
import type { PickedFile } from '../src/lib/engine.ts';

function pick(relativePath: string, size = 100, lastModified = 1): PickedFile {
  return {
    relativePath,
    file: { name: relativePath.split('/').pop() ?? relativePath, size, lastModified } as File,
  };
}

describe('isMediaFile', () => {
  it('accepts the containers cameras and recorders actually write', () => {
    for (const name of [
      'A001C002.MOV', 'C2_4928.MP4', 'clip.mxf', '00001.MTS', 'take.m2ts',
      'MIX_001.WAV', 'boom.bwf', 'long.rf64', 'take.aif', 'note.mp3', 'ref.m4a',
    ]) {
      expect(isMediaFile(name), name).toBe(true);
    }
  });

  it('rejects the sidecars that litter a camera card', () => {
    for (const name of ['CLIP0001.XML', 'INDEX.BDM', 'notes.txt', 'thumb.jpg', 'noextension']) {
      expect(isMediaFile(name), name).toBe(false);
    }
  });
});

describe('MEDIA_ACCEPT', () => {
  it('lists extensions as well as wildcards', () => {
    // Reported 2026-09-10: individual files greyed out in the picker. The cause
    // was `webkitdirectory`, but a wildcard-only accept list would have greyed
    // out MTS and MXF anyway — neither reliably has a registered MIME type.
    expect(MEDIA_ACCEPT).toContain('.mts');
    expect(MEDIA_ACCEPT).toContain('.mxf');
    expect(MEDIA_ACCEPT).toContain('.wav');
    expect(MEDIA_ACCEPT).toContain('video/*');
    expect(MEDIA_ACCEPT).toContain('audio/*');
  });
});

describe('mergePicked', () => {
  it('appends rather than replaces', () => {
    // Dropping camera files and then recorder files is the commonest way to
    // assemble a project. The second drop used to throw the first away.
    const camera = [pick('CAM/A001.MOV'), pick('CAM/A002.MOV')];
    const recorder = [pick('REC/MIX.WAV')];
    const merged = mergePicked(camera, recorder);
    expect(merged.map((p) => p.relativePath)).toEqual([
      'CAM/A001.MOV',
      'CAM/A002.MOV',
      'REC/MIX.WAV',
    ]);
  });

  it('does not duplicate a folder dropped twice', () => {
    const files = [pick('CAM/A001.MOV'), pick('CAM/A002.MOV')];
    expect(mergePicked(files, files)).toHaveLength(2);
  });

  it('replaces a file that changed since the last drop', () => {
    const before = [pick('CAM/A001.MOV', 100, 1)];
    const after = [pick('CAM/A001.MOV', 999, 2)];
    const merged = mergePicked(before, after);
    expect(merged).toHaveLength(1);
    expect(merged[0].file.size).toBe(999);
  });

  it('keeps a stable order so the clip table does not reshuffle', () => {
    const merged = mergePicked([pick('REC/MIX.WAV')], [pick('CAM/A001.MOV')]);
    expect(merged.map((p) => p.relativePath)).toEqual(['CAM/A001.MOV', 'REC/MIX.WAV']);
  });

  it('starts from nothing without complaint', () => {
    expect(mergePicked([], [pick('a.wav')])).toHaveLength(1);
  });
});

describe('pickedIdentity', () => {
  it('changes when the file changes and not otherwise', () => {
    expect(pickedIdentity(pick('a.wav', 10, 1))).toBe(pickedIdentity(pick('a.wav', 10, 1)));
    expect(pickedIdentity(pick('a.wav', 10, 1))).not.toBe(pickedIdentity(pick('a.wav', 11, 1)));
    expect(pickedIdentity(pick('a.wav', 10, 1))).not.toBe(pickedIdentity(pick('a.wav', 10, 2)));
  });
});

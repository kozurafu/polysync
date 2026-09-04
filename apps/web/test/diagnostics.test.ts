import { describe, expect, it } from 'vitest';
import type { GroupResult } from '@polysync/media-io';
import type { SyncResult } from '@polysync/sync-core';
import { buildDiagnosticReport, type DiagnosticInput, type EnvironmentInfo } from '../src/lib/diagnostics.ts';
import type { IngestedClip } from '../src/lib/engine.ts';

const ENV: EnvironmentInfo = {
  userAgent: 'Mozilla/5.0 (Macintosh) Safari/605.1.15',
  platform: 'MacIntel',
  cores: 8,
  poolSize: 7,
  secureContext: true,
  directoryPicker: false,
  webCodecsAudio: true,
  audioCodecs: { 'mp4a.40.2': true, opus: true, mp3: true, flac: false },
  deviceMemoryGb: 16,
};

function clip(id: string, over: Partial<IngestedClip> = {}): IngestedClip {
  return {
    id,
    name: `${id}.MP4`,
    relativePath: `CAM/${id}.MP4`,
    durationSeconds: 12.5,
    sampleRate: 16000,
    peaks: new Float32Array(4),
    probe: {
      name: `${id}.MP4`,
      durationSeconds: 12.5,
      sampleRate: 48000,
      channels: 2,
      hasVideo: true,
      hasAudio: true,
      audioCodec: 'pcm-s16be',
      decodable: true,
    },
    ...over,
  };
}

function input(over: Partial<DiagnosticInput> = {}): DiagnosticInput {
  return {
    generatedAt: '2026-09-04T13:27:00.000Z',
    environment: ENV,
    filesPicked: 2,
    clips: [clip('C2_4928'), clip('C2_4929')],
    failures: [],
    grouping: null,
    deviceOf: () => 'CAM',
    overrides: {},
    result: null,
    timings: { ingestSeconds: 48.2 },
    settings: { projectName: 'shoot_day_01', frameRate: '25', mediaRoot: '' },
    ...over,
  };
}

describe('buildDiagnosticReport', () => {
  it('never contains audio, in any form', () => {
    // The whole promise of this app is that the media stays on the machine. A
    // diagnostic that quietly broke that would be worse than none at all.
    const report = buildDiagnosticReport(input());
    expect(report).not.toMatch(/peaks|samples|Float32|Float64|waveform|envelope/i);
  });

  it('says up front what it does contain', () => {
    expect(buildDiagnosticReport(input())).toContain('no audio of any kind');
  });

  it('reports the environment, including which codecs decode here', () => {
    // "AAC does not decode in this browser" is a one-line answer to a whole
    // class of report that is otherwise a long conversation.
    const report = buildDiagnosticReport(input());
    expect(report).toContain('Safari/605.1.15');
    expect(report).toContain('mp4a.40.2=yes');
    expect(report).toContain('flac=NO');
    expect(report).toContain('decoding 7 at a time');
  });

  it('lists every clip with its real format, not the working rate alone', () => {
    const report = buildDiagnosticReport(input());
    expect(report).toContain('CAM/C2_4928.MP4');
    expect(report).toContain('pcm-s16be');
    expect(report).toContain('48000'); // source rate
    expect(report).toContain('16000'); // working rate after decimation
  });

  it('records skipped files and why', () => {
    const report = buildDiagnosticReport(
      input({
        failures: [{ relativePath: 'CAM/C2_5000.MP4', message: 'no decoder for audio codec "ac-3"' }],
      }),
    );
    expect(report).toContain('SKIPPED (1)');
    expect(report).toContain('no decoder for audio codec "ac-3"');
  });

  it('carries the grouping basis and any warnings', () => {
    const grouping: GroupResult = {
      assignments: [],
      deviceIds: ['C2'],
      basis: 'filename-prefix',
      warnings: ['All 70 clips look like they came from one device (C2).'],
    };
    const report = buildDiagnosticReport(input({ grouping }));
    expect(report).toContain('filename-prefix');
    expect(report).toContain('came from one device');
  });

  it('says the solve was not run, rather than showing an empty one', () => {
    expect(buildDiagnosticReport(input())).toContain('not run');
  });

  describe('with a solve', () => {
    const result: SyncResult = {
      placements: [
        { clipId: 'C2_4928', trackId: 'CAM', startSeconds: 0, synced: true, quality: 0.94, groupId: 0 },
        { clipId: 'C2_4929', trackId: 'CAM', startSeconds: 30, synced: false, groupId: 1 },
      ],
      pairs: [
        {
          aId: 'C2_4928',
          bId: 'C2_4929',
          offsetSeconds: 1.5,
          quality: 0.21,
          psr: 3.4,
          overlapSeconds: 1.2,
          method: 'waveform',
          accepted: false,
        },
      ],
      unsyncedClipIds: ['C2_4929'],
      inconsistencies: [{ aId: 'C2_4928', bId: 'C2_4929', errorSeconds: 0.043 }],
      groupCount: 2,
      stats: {
        totalPairs: 1,
        skippedBySameDevice: 0,
        skippedByRecordingTime: 0,
        skippedByEnvelope: 0,
        aligned: 1,
      },
    };

    it('breaks the pair count down by which gate claimed each one', () => {
      const report = buildDiagnosticReport(input({ result }));
      expect(report).toContain('skipped same dev');
      expect(report).toContain('skipped rec time');
    });

    it('explains why each unsynced clip did not match, and against what', () => {
      // The single most useful section. A list of unsynced clips is what the
      // user can already see on screen; the closest near-miss and the exact
      // threshold it failed is what they cannot.
      const report = buildDiagnosticReport(input({ result }));
      expect(report).toContain('WHY EACH UNSYNCED CLIP DID NOT MATCH');
      expect(report).toContain('CAM/C2_4929.MP4');
      expect(report).toContain('overlap 1.2s < 3s minimum');
      expect(report).toContain('quality 0.210 < 0.30 minimum');
      expect(report).toContain('peak-to-sidelobe 3.4 < 6 minimum');
    });

    it('says so plainly when a clip was never compared to anything', () => {
      const gatedOut: SyncResult = {
        ...result,
        pairs: [{ ...result.pairs[0], method: 'none', quality: 0 }],
      };
      const report = buildDiagnosticReport(input({ result: gatedOut }));
      expect(report).toContain('every one was ruled out by a gate');
    });

    it('lists matches that disagree', () => {
      const report = buildDiagnosticReport(input({ result }));
      expect(report).toContain('MATCHES THAT DISAGREE');
      expect(report).toContain('43 ms');
    });

    it('includes both timings', () => {
      const report = buildDiagnosticReport(
        input({ result, timings: { ingestSeconds: 48.2, solveSeconds: 12.7 } }),
      );
      expect(report).toContain('48.2 s');
      expect(report).toContain('12.7 s');
    });
  });

  it('stays pasteable on a large project', () => {
    const many = Array.from({ length: 400 }, (_, i) => clip(`C2_${5000 + i}`));
    const report = buildDiagnosticReport(input({ clips: many, filesPicked: 400 }));
    expect(report).toContain('more not listed');
    // Comfortably under what a chat message or an issue body will take.
    expect(report.length).toBeLessThan(60_000);
  });

  it('notes when the media folder was left blank', () => {
    expect(buildDiagnosticReport(input())).toContain('blank');
  });
});

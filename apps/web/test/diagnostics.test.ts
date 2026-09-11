import { describe, expect, it } from 'vitest';
import type { GroupResult } from '@polysync/media-io';
import type { SyncResult } from '@polysync/sync-core';
import { RATE_25 } from '@polysync/timecode';
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
    rate: RATE_25,
    trackLayout: 'per-device',
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
      attempts: [],
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
      inconsistencies: [
        {
          aId: 'C2_4928',
          bId: 'C2_4929',
          errorSeconds: 0.043,
          kind: 'offset-disagreement' as const,
        },
        {
          aId: 'C2_4928',
          bId: 'C2_4929',
          errorSeconds: 1.5,
          kind: 'same-device-overlap' as const,
        },
      ],
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

    it('keeps impossible overlaps apart from doubtful offsets', () => {
      // They mean different things: an overlap says the grouping or a placement
      // is impossible, a disagreement says one of two measurements is wrong.
      // Running them into one list sends you after the wrong cause — it briefly
      // sent me after the wrong cause reading a real report.
      const report = buildDiagnosticReport(input({ result }));
      expect(report).toContain('CLIPS FROM ONE DEVICE PLACED ON TOP OF EACH OTHER (1)');
      expect(report).toContain('MATCHES THAT DISAGREE (1)');
      expect(report).toContain('overlap by 1500 ms');
      expect(report).toContain('off by 43 ms');
    });

    it('lists matches that disagree', () => {
      const report = buildDiagnosticReport(input({ result }));
      expect(report).toContain('MATCHES THAT DISAGREE');
      expect(report).toContain('43 ms');
    });

    it('shows which strategy nearly worked, and what defeated it', () => {
      // The report once said only `grouped by extension-class` — the last
      // resort — with no hint why. The answer was that the prefix rule read 33
      // of 37 filenames and was discarded over the four it could not.
      const grouping: GroupResult = {
        assignments: [],
        deviceIds: ['VIDEO', 'AUDIO'],
        basis: 'extension-class',
        warnings: [],
        attempts: [
          { basis: 'card-structure', named: 0, devices: 0, unnamed: [], verdict: 'could not name 2 of 2 file(s)' },
          {
            basis: 'filename-prefix',
            named: 1,
            devices: 1,
            unnamed: ['01 260821_140448.mp3'],
            verdict: 'could not name 1 of 2 file(s)',
          },
          { basis: 'extension-class', named: 2, devices: 2, unnamed: [], verdict: '' },
        ],
      };
      const report = buildDiagnosticReport(input({ grouping }));
      expect(report).toContain('HOW THE DEVICES WERE WORKED OUT');
      expect(report).toContain('could not name: 01 260821_140448.mp3');
      expect(report).toContain('<- used');
    });

    it('names the clips stranded in each island', () => {
      // `groups 10` said a project had not solved and nothing about which
      // clips were stuck with which, which is the part worth knowing.
      const report = buildDiagnosticReport(input({ result }));
      expect(report).toContain('ISLANDS (2)');
      expect(report).toContain('CAM/C2_4928.MP4');
    });

    it('warns when every match barely cleared the threshold', () => {
      // A run where everything scrapes past is a different problem from one
      // where half the clips fail, and the placements table does not separate
      // them. This is what speech-isolated audio looks like.
      const weak: SyncResult = {
        ...result,
        pairs: [
          { ...result.pairs[0], accepted: true, quality: 0.31 },
          { ...result.pairs[0], accepted: true, quality: 0.34 },
          { ...result.pairs[0], accepted: true, quality: 0.36 },
        ],
      };
      const report = buildDiagnosticReport(input({ result: weak }));
      expect(report).toContain('HOW STRONG THE MATCHES WERE');
      expect(report).toContain('below 0.50         3 of 3');
      expect(report).toContain('transients removed');
    });

    it('does not cry wolf when the matches are strong', () => {
      const strong: SyncResult = {
        ...result,
        pairs: [
          { ...result.pairs[0], accepted: true, quality: 0.97 },
          { ...result.pairs[0], accepted: true, quality: 0.99 },
        ],
      };
      expect(buildDiagnosticReport(input({ result: strong }))).not.toContain('transients removed');
    });

    it('reports what the XML export would actually contain', () => {
      // Three consecutive bug reports were export bugs and the report covered
      // none of it: all of it was in the file the user already had, and none
      // of it was in the report they sent.
      const report = buildDiagnosticReport(input({ result }));
      expect(report).toContain('WHAT THE XML EXPORT WOULD CONTAIN');
      expect(report).toContain('track layout       per-device');
      expect(report).toContain('importer elements  all present');

      // And it must not report an element as missing when the project has
      // nothing for it to do — a false alarm in a diagnostic sends the next
      // person chasing a bug that is not there.
      const monoAudioOnly = buildDiagnosticReport(
        input({
          result,
          clips: [
            clip('C2_4928', { probe: { ...clip('x').probe, hasVideo: false, channels: 1 } }),
            clip('C2_4929', { probe: { ...clip('x').probe, hasVideo: false, channels: 1 } }),
          ],
        }),
      );
      expect(monoAudioOnly).not.toContain('MISSING link');
      expect(monoAudioOnly).toContain('link not needed here');
      expect(report).toContain('clips hidden       none');
    });

    it('flags paths the NLE will not be able to relink', () => {
      const report = buildDiagnosticReport(input({ result }));
      // The fixture's clips live at CAM/..., so a blank media folder still
      // leaves a folder to relink from and there is nothing to warn about.
      expect(report).toContain('example path');
      const flat = buildDiagnosticReport(
        input({
          result,
          clips: [clip('C2_4928', { relativePath: 'C2_4928.MP4' }), clip('C2_4929', { relativePath: 'C2_4929.MP4' })],
        }),
      );
      expect(flat).toContain('have no folder at all');
    });

    it('does not drop the minus sign off a drift figure', () => {
      // A real report showed `…1093.1 ppm` for a camera running slow, because
      // the column truncated from the left. Sign is the whole meaning of
      // drift: that read as running fast.
      const drifting: SyncResult = {
        ...result,
        placements: [
          { ...result.placements[0], driftPpm: -1093.1 },
          result.placements[1],
        ],
      };
      const report = buildDiagnosticReport(input({ result: drifting }));
      expect(report).not.toContain('…1093.1');
      expect(report).toContain('-1093.1');
    });

    it('separates drift readings the hardware could not have produced', () => {
      // 11,043 ppm is 1.1% — a crystal that far out would be visibly broken.
      // It is a failed measurement, and presenting it as fact sends people
      // after a clock problem that does not exist.
      const drifting: SyncResult = {
        ...result,
        placements: [
          { ...result.placements[0], driftPpm: 11043.8 },
          { ...result.placements[1], driftPpm: 8.3 },
        ],
      };
      const report = buildDiagnosticReport(input({ result: drifting }));
      expect(report).toContain('DRIFT READINGS TO IGNORE (1)');
      expect(report).toContain('11043.8 ppm');
      // The believable one must not be swept up with it.
      expect(report).not.toContain('8.3 ppm\n  CAM');
    });

    it('puts the worst disagreements first and says which ones round away', () => {
      // A real report listed 1,205 in no order, mixing 22 ms — half a frame,
      // which an export addressed in whole frames rounds away entirely — with
      // 94 minutes. Every catastrophic one was buried.
      const messy: SyncResult = {
        ...result,
        inconsistencies: [
          { aId: 'C2_4928', bId: 'C2_4929', errorSeconds: 0.022, kind: 'offset-disagreement' as const },
          { aId: 'C2_4928', bId: 'C2_4929', errorSeconds: -5660.322, kind: 'offset-disagreement' as const },
          { aId: 'C2_4928', bId: 'C2_4929', errorSeconds: 0.061, kind: 'offset-disagreement' as const },
        ],
      };
      const report = buildDiagnosticReport(input({ result: messy }));
      const section = report.slice(report.indexOf('MATCHES THAT DISAGREE'));
      // 61 ms is 1.5 frames at 25 fps, so it counts as worth looking at.
      expect(section).toContain('2 are bigger than one frame');
      expect(section).toContain('1 is within a frame');
      // Worst first, and given in minutes so its size is legible.
      const worst = section.indexOf('-5660322 ms');
      const trivial = section.indexOf('22 ms', section.indexOf('Worst first'));
      expect(worst).toBeGreaterThan(-1);
      expect(worst).toBeLessThan(trivial);
      expect(section).toContain('(94.3 minutes)');
    });

    it('says outright when a clip is too short to ever sync', () => {
      // Twelve of eighteen unsynced clips in a real report were shorter than
      // the minimum overlap — several under a second — and each was shown a
      // tantalising near miss against a clip it could never have joined.
      const report = buildDiagnosticReport(
        input({
          result: { ...result, unsyncedClipIds: ['C2_4929'] },
          clips: [clip('C2_4928'), clip('C2_4929', { durationSeconds: 0.48 })],
        }),
      );
      expect(report).toContain('TOO SHORT TO SYNC AT ALL (1)');
      expect(report).toContain('0.48s');
    });

    it('reports matches the solve refused to act on', () => {
      const refused: SyncResult = {
        ...result,
        stats: { ...result.stats, rejectedByOverlap: 69 },
      };
      expect(buildDiagnosticReport(input({ result: refused }))).toContain(
        'rejected: would stack  69',
      );
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

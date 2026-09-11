import { describe, expect, it } from 'vitest';
import { exportFcp7Xml, type TimelineProject } from '@polysync/exporters';
import { RATE_25 } from '@polysync/timecode';
import { DEFAULT_TRACK_LIMITS, buildTimeline, packLanes } from '../src/lib/exportProject.ts';
import type { ExportInput } from '../src/lib/exportProject.ts';
import type { IngestedClip } from '../src/lib/engine.ts';
import type { SyncResult } from '@polysync/sync-core';

interface Spec {
  id: string;
  device: string;
  start: number;
  duration: number;
  video: boolean;
  channels?: number;
}

function clipOf(spec: Spec): IngestedClip {
  return {
    id: spec.id,
    name: `${spec.id}.MP4`,
    relativePath: `${spec.device}/${spec.id}.MP4`,
    durationSeconds: spec.duration,
    sampleRate: 16000,
    peaks: new Float32Array(4),
    probe: {
      name: `${spec.id}.MP4`,
      durationSeconds: spec.duration,
      sampleRate: 48000,
      channels: spec.channels ?? (spec.video ? 2 : 1),
      hasVideo: spec.video,
      hasAudio: true,
      decodable: true,
      width: spec.video ? 3840 : undefined,
      height: spec.video ? 2160 : undefined,
    },
  };
}

function project(specs: Spec[], over: Partial<ExportInput> = {}): TimelineProject {
  const clips = specs.map(clipOf);
  const result: SyncResult = {
    placements: specs.map((s) => ({
      clipId: s.id,
      trackId: s.device,
      startSeconds: s.start,
      synced: true,
      groupId: 0,
    })),
    pairs: [],
    unsyncedClipIds: [],
    inconsistencies: [],
    groupCount: 1,
    stats: {
      totalPairs: 0,
      skippedBySameDevice: 0,
      skippedByRecordingTime: 0,
      skippedByEnvelope: 0,
      aligned: 0,
      rejectedByOverlap: 0,
    },
  };
  const deviceById = new Map(specs.map((s) => [s.id, s.device]));
  return buildTimeline({
    projectName: 'shoot',
    clips,
    result,
    deviceOf: (id) => deviceById.get(id) ?? 'DEVICE',
    mediaRoot: '',
    rate: RATE_25,
    ...over,
  });
}

/** Track comments in emission order: V1..Vn then A1..An. */
function tracks(p: TimelineProject): { video: string[]; audio: string[] } {
  const xml = exportFcp7Xml(p);
  const all = [...xml.matchAll(/<!-- (.*?) -->/g)].map((m) => m[1]);
  return {
    video: all.filter((c) => !/ ch\d+$/.test(c)),
    audio: all.filter((c) => / ch\d+$/.test(c)),
  };
}

const RECORDER: Spec = { id: 'MIX', device: 'AUDIO', start: 0, duration: 3600, video: false };

describe('per-device layout', () => {
  it('puts the supplied audio on A1, ahead of every camera', () => {
    // Even when a camera rolled first. A1 is where an editor looks for the
    // good audio; a camera that happened to start earlier must not push it down.
    const p = project([
      { id: 'C1_1', device: 'C1', start: 0, duration: 60, video: true },
      { ...RECORDER, start: 5 },
    ]);
    expect(tracks(p).audio[0]).toBe('AUDIO ch1');
  });

  it('gives each camera one video track, in timeline order', () => {
    const p = project([
      RECORDER,
      { id: 'C2_1', device: 'C2', start: 90, duration: 60, video: true },
      { id: 'C1_1', device: 'C1', start: 10, duration: 60, video: true },
      { id: 'C1_2', device: 'C1', start: 200, duration: 60, video: true },
    ]);
    expect(tracks(p).video).toEqual(['C1', 'C2']);
  });

  it('keeps a camera’s own takes on one track, not one each', () => {
    // The whole point of the change: 30 sequential takes from one camera are
    // one track, because a camera records one clip at a time.
    const specs: Spec[] = [RECORDER];
    for (let i = 0; i < 30; i++) {
      specs.push({ id: `C2_${i}`, device: 'C2', start: i * 20, duration: 10, video: true });
    }
    const t = tracks(project(specs));
    expect(t.video).toEqual(['C2']);
    expect(t.audio).toEqual(['AUDIO ch1', 'C2 ch1', 'C2 ch2']);
  });

  it('stays inside four video and ten audio tracks for a four-camera shoot', () => {
    const specs: Spec[] = [RECORDER];
    for (const device of ['C1', 'C2', 'C3', 'C4']) {
      specs.push({ id: `${device}_1`, device, start: 10, duration: 600, video: true });
    }
    const t = tracks(project(specs));
    expect(t.video).toHaveLength(4);
    // One recorder track plus two per stereo camera.
    expect(t.audio).toHaveLength(9);
    expect(t.audio[0]).toBe('AUDIO ch1');
  });

  it('packs a fifth camera onto a track it never overlaps', () => {
    const specs: Spec[] = [RECORDER];
    for (const device of ['C1', 'C2', 'C3', 'C4']) {
      specs.push({ id: `${device}_1`, device, start: 10, duration: 100, video: true });
    }
    // Rolls long after the others have stopped, so it can share safely.
    specs.push({ id: 'C5_1', device: 'C5', start: 5000, duration: 100, video: true });
    const t = tracks(project(specs));
    expect(t.video).toHaveLength(4);
    expect(t.video.some((c) => c.includes('C5'))).toBe(true);
  });

  it('exceeds the budget rather than hiding a clip', () => {
    // Five cameras all rolling at once cannot share four tracks without one
    // covering another. A tall timeline is recoverable; a clip you cannot see
    // is indistinguishable from one that never imported.
    const specs: Spec[] = [RECORDER];
    for (const device of ['C1', 'C2', 'C3', 'C4', 'C5']) {
      specs.push({ id: `${device}_1`, device, start: 10, duration: 600, video: true });
    }
    const t = tracks(project(specs));
    expect(t.video).toHaveLength(5);
  });

  it('still gives every clip a track under the per-clip layout', () => {
    const specs: Spec[] = [
      RECORDER,
      { id: 'C1_1', device: 'C1', start: 0, duration: 60, video: true },
      { id: 'C1_2', device: 'C1', start: 100, duration: 60, video: true },
    ];
    const t = tracks(project(specs, { trackLayout: 'per-clip' }));
    expect(t.video).toHaveLength(2);
  });
});

describe('packLanes', () => {
  const span = (from: number, to: number) => ({ from, to });

  it('never puts two overlapping spans on one lane', () => {
    const { laneOf } = packLanes(
      [
        { device: 'a', spans: [span(0, 10)], cost: 1 },
        { device: 'b', spans: [span(5, 15)], cost: 1 },
      ],
      1,
    );
    expect(laneOf.get('a')).not.toBe(laneOf.get('b'));
  });

  it('shares a lane when the spans only touch', () => {
    const { lanes } = packLanes(
      [
        { device: 'a', spans: [span(0, 10)], cost: 1 },
        { device: 'b', spans: [span(10, 20)], cost: 1 },
      ],
      1,
    );
    expect(lanes).toHaveLength(1);
  });

  it('reports when it had to go over budget', () => {
    const over = packLanes(
      [
        { device: 'a', spans: [span(0, 10)], cost: 1 },
        { device: 'b', spans: [span(5, 15)], cost: 1 },
      ],
      1,
    );
    expect(over.overflowed).toBe(true);

    const within = packLanes([{ device: 'a', spans: [span(0, 10)], cost: 1 }], 1);
    expect(within.overflowed).toBe(false);
  });

  it('spends the budget in tracks, so a stereo device costs two', () => {
    const { lanes } = packLanes(
      [
        { device: 'a', spans: [span(0, 10)], cost: 2 },
        { device: 'b', spans: [span(0, 10)], cost: 2 },
        { device: 'c', spans: [span(0, 10)], cost: 2 },
      ],
      4,
    );
    // Two stereo devices fill a four-track budget; the third overflows because
    // it overlaps both and cannot share.
    expect(lanes).toHaveLength(3);
  });
});

describe('the defaults', () => {
  it('budgets four video tracks and ten audio', () => {
    expect(DEFAULT_TRACK_LIMITS).toEqual({ maxVideoTracks: 4, maxAudioTracks: 10 });
  });
});

describe('a device whose own clips overlap', () => {
  // A real export hid 203 clips behind others, because every device got
  // exactly one track and the solve had stacked clips within a device. The
  // solve no longer does that, but the layout must not depend on it: a
  // hand-set device, a re-grouped project, or two cameras a user merged can
  // all leave one device holding overlapping clips.
  const overlapping: Spec[] = [
    RECORDER,
    { id: 'C2_a', device: 'C2', start: 10, duration: 100, video: true },
    { id: 'C2_b', device: 'C2', start: 50, duration: 100, video: true },
    { id: 'C2_c', device: 'C2', start: 300, duration: 50, video: true },
  ];

  it('gives the overlap another track instead of hiding it', () => {
    const t = tracks(project(overlapping));
    expect(t.video).toHaveLength(2);
    // The third clip does not overlap the first, so it shares that track
    // rather than claiming a third.
    expect(t.video[0]).toContain('C2');
    expect(t.video[1]).toContain('C2');
  });

  it('never leaves a clip sitting behind another', () => {
    const xml = exportFcp7Xml(project(overlapping));
    for (const block of xml.split('<track>').slice(1)) {
      const spans = [...block.matchAll(/<start>(-?\d+)<\/start>\s*<end>(-?\d+)<\/end>/g)]
        .map((m) => ({ from: Number(m[1]), to: Number(m[2]) }))
        .sort((a, b) => a.from - b.from);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].from, 'a clip is hidden behind another').toBeGreaterThanOrEqual(
          spans[i - 1].to,
        );
      }
    }
  });

  it('leaves a well-behaved device on one track', () => {
    const t = tracks(
      project([
        RECORDER,
        { id: 'C2_a', device: 'C2', start: 10, duration: 30, video: true },
        { id: 'C2_b', device: 'C2', start: 50, duration: 30, video: true },
      ]),
    );
    expect(t.video).toEqual(['C2']);
  });
});

import { describe, expect, it } from 'vitest';
import { planAlignPool, projectAudioBytes } from '../src/lib/alignPool.ts';

const GB = 1e9;
const plan = (o: Partial<Parameters<typeof planAlignPool>[0]>) =>
  planAlignPool({ audioBytes: 0.2 * GB, cores: 8, deviceMemoryGb: 16, pairsToAlign: 5000, ...o });

describe('planAlignPool', () => {
  it('refuses to pool on a machine with nothing to spare', () => {
    // A size of 1 means "use the existing single-worker path", so a weak
    // machine behaves exactly as it does today rather than slightly differently.
    expect(plan({ cores: 1 }).size).toBe(1);
    expect(plan({ cores: 2 }).size).toBe(1);
    expect(plan({ cores: 4 }).size).toBeGreaterThan(1);
  });

  it('leaves a core for the main thread', () => {
    expect(plan({ cores: 4 }).size).toBe(3);
    expect(plan({ cores: 10 }).size).toBe(8); // capped
  });

  it('runs single-threaded rather than killing the tab on a huge project', () => {
    // The reported 241-clip project: 7.5 hours at 16 kHz = 3.4 GB per copy.
    // Eight of those is 27 GB against a 2-4 GB tab ceiling.
    const huge = plan({ audioBytes: 3.43 * GB, deviceMemoryGb: 16, cores: 10 });
    expect(huge.size).toBe(1);
    expect(huge.reason).toContain('single-threaded');
  });

  it('pools freely on a project that actually fits', () => {
    // A more typical day: four cameras and a recorder, a few hundred MB.
    expect(plan({ audioBytes: 0.15 * GB, deviceMemoryGb: 8, cores: 8 }).size).toBe(7);
  });

  it('assumes modest memory when the browser will not say', () => {
    // Safari and Firefox report no deviceMemory. Guessing high would be the
    // one guess that crashes the tab, so the unknown case guesses low.
    const unknown = plan({ audioBytes: 0.5 * GB, deviceMemoryGb: undefined, cores: 8 });
    const known = plan({ audioBytes: 0.5 * GB, deviceMemoryGb: 32, cores: 8 });
    expect(unknown.size).toBeLessThan(known.size);
  });

  it('does not spin up a pool for a handful of pairs', () => {
    expect(plan({ pairsToAlign: 10 }).size).toBe(1);
  });

  it('always explains itself', () => {
    // The reason goes into the diagnostic report, so a slow solve can be
    // explained without guessing at the machine it ran on.
    for (const p of [plan({ cores: 1 }), plan({}), plan({ audioBytes: 9 * GB })]) {
      expect(p.reason.length).toBeGreaterThan(10);
    }
  });

  it('never returns a fractional or negative size', () => {
    for (const cores of [0, 1, 3, 7, 64]) {
      for (const gb of [0.5, 2, 8, 64]) {
        const { size } = plan({ cores, deviceMemoryGb: gb, audioBytes: 0.3 * GB });
        expect(Number.isInteger(size)).toBe(true);
        expect(size).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('the ?workers= override', () => {
  it('forces the count, so a result can be checked against another', () => {
    // The first thing to try when a solve looks wrong is the single-threaded
    // path, and that should be a URL away rather than a rebuild.
    expect(plan({ override: 1, cores: 16, audioBytes: 0.01 * GB }).size).toBe(1);
    expect(plan({ override: 4, cores: 1 }).size).toBe(4);
  });

  it('will not be talked into something absurd', () => {
    expect(plan({ override: 0 }).size).toBe(1);
    expect(plan({ override: -3 }).size).toBe(1);
    expect(plan({ override: 9999 }).size).toBeLessThanOrEqual(8);
    expect(plan({ override: Number.NaN }).size).toBeGreaterThan(0);
  });
});

describe('projectAudioBytes', () => {
  it('adds up what each worker would have to hold', () => {
    expect(
      projectAudioBytes([{ samples: new ArrayBuffer(100) }, { samples: new ArrayBuffer(50) }]),
    ).toBe(150);
  });

  it('counts a clip whose audio was already handed away as nothing', () => {
    expect(projectAudioBytes([{ samples: undefined }])).toBe(0);
  });
});

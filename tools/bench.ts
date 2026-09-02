/**
 * Solve-time benchmark on a simulated shoot day.
 *
 *   npm run bench
 *   npm run bench -- --clips 30 --minutes 4
 *
 * Exists because the solve is O(n²) and the only number that matters is
 * wall-clock on a realistic project, not per-pair cost in isolation. It reports
 * gated against ungated so a change to the gates can be judged rather than
 * argued about.
 *
 * The simulated day is deliberately unkind: four devices starting and stopping
 * independently across three hours, so most pairs genuinely cannot overlap —
 * which is the situation the recording-time gate exists for, and also the
 * situation that makes the naive O(n²) unusable.
 */

import { performance } from 'node:perf_hooks';
import { syncProject, type AudioClip, type SyncResult } from '@polysync/sync-core';

const SR = 16000;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Speech-like source material with irregular syllables and hard transients. */
function sourceAudio(seconds: number, seed: number): Float64Array {
  const rand = rng(seed);
  const n = Math.round(seconds * SR);
  const out = new Float64Array(n);
  let i = 0;
  while (i < n) {
    const silent = rand() < 0.3;
    const len = Math.min(n - i, Math.round((0.08 + rand() * 0.45) * SR));
    if (!silent) {
      const f0 = 90 + rand() * 160;
      const amp = 0.2 + rand() * 0.8;
      let lp = 0;
      for (let k = 0; k < len; k++) {
        const env = Math.min(1, k / (0.004 * SR)) * Math.exp(-3 * (k / len));
        lp = lp * 0.7 + (rand() * 2 - 1) * 0.3;
        const tone = Math.sin((2 * Math.PI * f0 * k) / SR);
        out[i + k] = amp * env * (0.55 * tone + 0.45 * lp);
      }
    }
    i += len;
  }
  return out;
}

function scratch(x: Float64Array, seed: number): Float64Array {
  const rand = rng(seed);
  const out = new Float64Array(x.length);
  let lp = 0;
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < x.length; i++) {
    lp = lp * 0.72 + x[i] * 0.28; // crude band-limiting
    hp = 0.97 * (hp + lp - prev);
    prev = lp;
    out[i] = hp * 0.05 + (rand() - 0.5) * 0.004;
  }
  return out;
}

function slice(x: Float64Array, startSeconds: number, lengthSeconds: number): Float64Array {
  const start = Math.round(startSeconds * SR);
  const len = Math.round(lengthSeconds * SR);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const j = start + i;
    out[i] = j >= 0 && j < x.length ? x[j] : 0;
  }
  return out;
}

interface Options {
  clips: number;
  minutes: number;
  hours: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { clips: 20, minutes: 2, hours: 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--clips') opts.clips = Number(argv[++i]);
    else if (argv[i] === '--minutes') opts.minutes = Number(argv[++i]);
    else if (argv[i] === '--hours') opts.hours = Number(argv[++i]);
  }
  return opts;
}

/**
 * A shoot day: one recorder rolling long takes, three cameras starting and
 * stopping around it, spread across `hours`. Each device's clips carry a
 * modification time, as a real card offload preserves.
 */
function buildShoot(opts: Options): AudioClip[] {
  const spanSeconds = opts.hours * 3600;
  const clipSeconds = opts.minutes * 60;
  // One long take per "scene"; every device covering a scene shares its audio.
  const scenes = Math.max(1, Math.ceil(opts.clips / 4));
  const sceneAudio = Array.from({ length: scenes }, (_, s) => sourceAudio(clipSeconds + 60, 1000 + s));

  const clips: AudioClip[] = [];
  const devices = ['REC', 'CAM_A', 'CAM_B', 'CAM_C'];
  const epoch = 1_780_000_000;
  let made = 0;
  for (let s = 0; s < scenes && made < opts.clips; s++) {
    // Scenes are spread evenly across the day.
    const sceneStart = epoch + (s / Math.max(1, scenes - 1 || 1)) * spanSeconds;
    for (let d = 0; d < devices.length && made < opts.clips; d++) {
      const offsetIntoScene = d === 0 ? 0 : 3 + d * 4;
      const samples =
        d === 0
          ? slice(sceneAudio[s], 0, clipSeconds)
          : scratch(slice(sceneAudio[s], offsetIntoScene, clipSeconds), 20 + d + s * 7);
      clips.push({
        id: `${devices[d]}_${s}`,
        name: `${devices[d]}_${String(s).padStart(3, '0')}.wav`,
        trackId: devices[d],
        samples,
        sampleRate: SR,
        // mtime as a card offload preserves it: when the file was closed.
        recordedAtSeconds: sceneStart + offsetIntoScene + clipSeconds,
      });
      made++;
    }
  }
  return clips;
}

function run(label: string, clips: AudioClip[], options: Record<string, unknown>): SyncResult {
  const started = performance.now();
  const result = syncProject(clips, {
    fineRate: SR,
    fineSegmentSeconds: 4,
    detectDrift: false,
    ...options,
  });
  const seconds = (performance.now() - started) / 1000;
  const synced = result.placements.filter((p) => p.synced).length;
  console.log(
    `  ${label.padEnd(22)} ${seconds.toFixed(1).padStart(7)}s   ` +
      `${String(result.stats.aligned).padStart(5)} pairs aligned of ${result.stats.totalPairs}   ` +
      `${synced}/${clips.length} synced`,
  );
  if (result.stats.skippedByRecordingTime || result.stats.skippedByEnvelope) {
    console.log(
      `  ${''.padEnd(22)}           skipped: ` +
        `${result.stats.skippedByRecordingTime} on recording time, ` +
        `${result.stats.skippedByEnvelope} on envelope bound`,
    );
  }
  return result;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `Simulated shoot: ${opts.clips} clips of ${opts.minutes} min across ${opts.hours} hours, ` +
      `4 devices, ${SR} Hz\n`,
  );
  const clips = buildShoot(opts);

  const ungated = run('no gates', clips, {
    gateByRecordingTime: false,
    envelopePrefilter: false,
  });
  const envelopeOnly = run('envelope bound only', clips, { gateByRecordingTime: false });
  const timeOnly = run('recording time only', clips, { envelopePrefilter: false });
  const both = run('both gates', clips, {});

  // The gates are only worth having if they change nothing but the clock.
  const same =
    JSON.stringify(ungated.unsyncedClipIds.slice().sort()) ===
    JSON.stringify(both.unsyncedClipIds.slice().sort());
  console.log(`\n  Same clips synced with and without gates: ${same ? 'yes' : 'NO — REGRESSION'}`);
  if (!same) process.exitCode = 1;

  void envelopeOnly;
  void timeOnly;
}

main();

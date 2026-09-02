/**
 * Polysync CLI harness.
 *
 * Point it at a folder of rushes and it reports what it found, how it grouped
 * the devices, and where every clip landed. No UI, no browser, no build step.
 *
 *   npm run sync -- ./rushes
 *   npm run sync -- ./rushes --rate 8000 --json report.json
 *
 * This exists before any UI on purpose. It is the fastest way to test against
 * real media, it forces no interface decisions, and it becomes the regression
 * harness once there is a test corpus to run it over.
 *
 * Node has no WebCodecs, so compressed audio does not decode here — the tool
 * says so per file and carries on. WAV, BWF and LPCM in a container all work,
 * which covers every sound recorder and therefore the reference track for
 * most real jobs.
 */

import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  groupClips,
  ingest,
  probe,
  type GroupInput,
  type ProbeResult,
} from '@polysync/media-io';
import { syncProject, type AudioClip, type SyncResult } from '@polysync/sync-core';
import { fileSource, findMedia, type FoundFile } from './node-source.ts';

interface Options {
  root: string;
  workingRate?: number;
  jsonPath?: string;
  quiet: boolean;
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const options: Partial<Options> = { quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rate') options.workingRate = Number(argv[++i]);
    else if (arg === '--json') options.jsonPath = argv[++i];
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option ${arg}`);
      usage();
      process.exit(2);
    } else positional.push(arg);
  }
  if (positional.length !== 1) {
    usage();
    process.exit(2);
  }
  return { root: positional[0], quiet: false, ...options } as Options;
}

function usage(): void {
  console.log(`
polysync — sync a folder of rushes and report the result

  npm run sync -- <folder> [options]

  --rate <hz>    decode to this working rate instead of the default policy
  --json <path>  also write the full result as JSON
  --quiet        only print the summary
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const started = performance.now();

  const found = await findMedia(options.root);
  if (found.length === 0) {
    console.error(`No media found under ${options.root}`);
    process.exit(1);
  }
  log(`Found ${found.length} file${found.length === 1 ? '' : 's'} under ${options.root}\n`);

  // ---- probe everything before decoding anything ------------------------
  // Header reads only, so this is fast even across a full card, and it tells
  // us what we can actually decode before spending time on it.
  const probes = new Map<string, ProbeResult>();
  const skipped: Array<{ file: FoundFile; reason: string }> = [];

  for (const file of found) {
    const src = await fileSource(file.absolutePath);
    try {
      const info = await probe(src);
      if (!info.hasAudio || !info.decodable) {
        skipped.push({ file, reason: info.undecodableReason ?? 'no decodable audio' });
      } else {
        probes.set(file.relativePath, info);
      }
    } catch (error) {
      skipped.push({ file, reason: describeError(error) });
    } finally {
      await src.close();
    }
  }

  // ---- group into devices ------------------------------------------------
  const groupInputs: GroupInput[] = found
    .filter((f) => probes.has(f.relativePath))
    .map((f) => ({
      id: f.relativePath,
      path: f.relativePath,
      hasVideo: probes.get(f.relativePath)?.hasVideo,
    }));

  const grouping = groupClips(groupInputs);
  const deviceOf = new Map(grouping.assignments.map((a) => [a.clipId, a.deviceId]));

  log(`Devices (grouped by ${grouping.basis}):`);
  for (const device of grouping.deviceIds) {
    const members = grouping.assignments.filter((a) => a.deviceId === device);
    log(`  ${device.padEnd(16)} ${members.length} clip${members.length === 1 ? '' : 's'}`);
  }
  for (const warning of grouping.warnings) log(`  ! ${warning}`);
  log('');

  // ---- decode ------------------------------------------------------------
  const clips: AudioClip[] = [];
  for (const file of found) {
    const info = probes.get(file.relativePath);
    if (!info) continue;
    const src = await fileSource(file.absolutePath);
    try {
      const { clip } = await ingest(src, file.relativePath, {
        workingRate: options.workingRate,
        recordedAtSeconds: file.lastModified / 1000,
      });
      clips.push({ ...clip, trackId: deviceOf.get(file.relativePath) ?? 'DEVICE' });
      log(
        `  decoded ${pad(file.relativePath, 38)} ` +
          `${fmt(info.durationSeconds)}  ${info.audioCodec ?? '?'} ` +
          `${info.sampleRate} Hz x${info.channels}` +
          (info.timecodeSeconds !== undefined
            ? `  TC ${clock(info.timecodeSeconds)} (${info.timecodeSource})`
            : ''),
      );
    } catch (error) {
      skipped.push({ file, reason: describeError(error) });
    } finally {
      await src.close();
    }
  }
  log('');

  if (clips.length < 2) {
    console.error('Need at least two decodable clips to sync.');
    reportSkipped(skipped);
    process.exit(1);
  }

  // ---- solve -------------------------------------------------------------
  // Carriage-return progress only makes sense on a terminal; piped to a file
  // or a CI log it just concatenates into one unreadable line.
  const interactive = Boolean(process.stderr.isTTY) && !options.quiet;
  const result = syncProject(clips, {
    onProgress: (fraction, label) => {
      if (interactive) process.stderr.write(`\r  ${pad(label, 26)}${Math.round(fraction * 100)}%  `);
    },
  });
  if (interactive) process.stderr.write(`\r${' '.repeat(40)}\r`);

  report(result, clips, options);
  reportSkipped(skipped);

  if (options.jsonPath) {
    await writeFile(
      options.jsonPath,
      JSON.stringify({ grouping, placements: result.placements, pairs: result.pairs }, null, 2),
    );
    log(`\nWrote ${options.jsonPath}`);
  }

  log(`\nDone in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  // A run where something did not sync is a successful run that found a
  // problem, not a failed run — but the exit code should let a script tell.
  process.exit(result.unsyncedClipIds.length > 0 || skipped.length > 0 ? 3 : 0);

  function log(line: string): void {
    if (!options.quiet) console.log(line);
  }
}

function report(result: SyncResult, clips: AudioClip[], options: Options): void {
  const names = new Map(clips.map((c) => [c.id, c.name ?? c.id]));
  const ordered = [...result.placements].sort((a, b) => a.startSeconds - b.startSeconds);

  console.log('Timeline');
  console.log(
    `  ${'START'.padEnd(13)}${'DEVICE'.padEnd(16)}${'CLIP'.padEnd(38)}${'QUALITY'.padEnd(9)}DRIFT`,
  );
  for (const p of ordered) {
    const quality = p.quality === undefined ? '—' : p.quality.toFixed(3);
    const drift = p.driftPpm === undefined ? '' : `${p.driftPpm > 0 ? '+' : ''}${p.driftPpm.toFixed(1)} ppm`;
    const mark = p.synced ? ' ' : '!';
    console.log(
      `${mark} ${pad(fmt(p.startSeconds), 12)}${pad(p.trackId, 16)}` +
        `${pad(names.get(p.clipId) ?? p.clipId, 38)}${pad(quality, 9)}${drift}`,
    );
  }

  console.log('');
  const synced = result.placements.filter((p) => p.synced).length;
  console.log(`  ${synced} of ${result.placements.length} clips synced in ${result.groupCount} group(s)`);

  if (result.unsyncedClipIds.length) {
    console.log(`\n  Unsynced — nothing matched these, and they need a human:`);
    for (const id of result.unsyncedClipIds) console.log(`    ${names.get(id) ?? id}`);
  }

  if (result.inconsistencies.length) {
    // Redundant matches are independent measurements of distances the solve
    // already fixed. Where they disagree, at least one is wrong — and saying so
    // is the thing PluralEyes could not do.
    console.log(`\n  Inconsistent matches — these disagree with the solved timeline:`);
    for (const bad of result.inconsistencies) {
      console.log(
        `    ${names.get(bad.aId) ?? bad.aId} vs ${names.get(bad.bId) ?? bad.bId}` +
          `  off by ${(bad.errorSeconds * 1000).toFixed(0)} ms`,
      );
    }
  }

  if (options.workingRate) console.log(`\n  (decoded at ${options.workingRate} Hz)`);
}

function reportSkipped(skipped: Array<{ file: FoundFile; reason: string }>): void {
  if (!skipped.length) return;
  console.log(`\n  Skipped ${skipped.length} file(s):`);
  for (const { file, reason } of skipped) console.log(`    ${file.relativePath}\n      ${reason}`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pad(s: string, width: number): string {
  return (s.length > width ? `${s.slice(0, width - 2)}..` : s).padEnd(width);
}

/** Elapsed time as `m:ss.mmm` — the form an editor reads offsets in. */
function fmt(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  return `${sign}${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

/** Time of day, for timecode read from a file. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

main().catch((error) => {
  console.error(describeError(error));
  process.exit(1);
});

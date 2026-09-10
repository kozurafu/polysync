/**
 * The report a user sends back when something went wrong.
 *
 * Written because the first real bug report arrived as two screenshots and a
 * 4,170-line XML file, and finding the actual cause meant parsing that XML with
 * a script. Everything needed was in the app at the time; none of it was
 * reachable. A report is one paste instead.
 *
 * Three rules shaped what goes in it:
 *
 *   1. **No audio, ever.** Not samples, not peaks, not envelopes. The whole
 *      promise of this app is that the media never leaves the machine, and a
 *      diagnostic that quietly breaks that promise would be worse than no
 *      diagnostic. File *names* and folder paths are included, because
 *      diagnosis is impossible without them — and the UI says so plainly
 *      before anyone copies it.
 *   2. **Answer "why not?", not just "what".** A list of unsynced clips is
 *      what the user can already see. The useful part is, for each one, the
 *      closest it came to matching anything and which threshold turned it
 *      away.
 *   3. **Pasteable.** Plain text, and bounded — a 200-clip project must not
 *      produce something no one can send.
 */

import type { GroupResult } from '@polysync/media-io';
import type { PairAlignment, SyncResult } from '@polysync/sync-core';
import type { IngestFailure, IngestedClip } from './engine.ts';

export interface EnvironmentInfo {
  userAgent: string;
  platform: string;
  cores: number;
  poolSize: number;
  secureContext: boolean;
  directoryPicker: boolean;
  webCodecsAudio: boolean;
  /** Codec string -> supported, from `AudioDecoder.isConfigSupported`. */
  audioCodecs: Record<string, boolean>;
  deviceMemoryGb?: number;
  storageQuotaMb?: number;
  storageUsedMb?: number;
}

export interface DiagnosticInput {
  generatedAt: string;
  environment: EnvironmentInfo;
  /** How many files the picker handed us, before any decoding. */
  filesPicked: number;
  clips: IngestedClip[];
  failures: IngestFailure[];
  grouping: GroupResult | null;
  deviceOf: (clipId: string) => string;
  overrides: Record<string, string>;
  result: SyncResult | null;
  timings: { ingestSeconds?: number; solveSeconds?: number };
  settings: { projectName: string; frameRate: string; mediaRoot: string };
}

const MAX_CLIP_ROWS = 200;
const MAX_NEAR_MISSES = 25;

export function buildDiagnosticReport(input: DiagnosticInput): string {
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  const heading = (s: string) => {
    line();
    line(s);
    line('-'.repeat(s.length));
  };

  line('POLYSYNC DIAGNOSTIC REPORT');
  line(`generated  ${input.generatedAt}`);
  line('contains file names and folder paths, and no audio of any kind');

  // ------------------------------------------------------------ environment
  const env = input.environment;
  heading('ENVIRONMENT');
  line(`browser            ${env.userAgent}`);
  line(`platform           ${env.platform}`);
  line(`cores              ${env.cores}  (decoding ${env.poolSize} at a time)`);
  line(`secure context     ${yesNo(env.secureContext)}`);
  line(`directory picker   ${yesNo(env.directoryPicker)}`);
  line(`WebCodecs audio    ${yesNo(env.webCodecsAudio)}`);
  const codecs = Object.entries(env.audioCodecs);
  if (codecs.length) {
    line(`  decodable here   ${codecs.map(([c, ok]) => `${c}=${ok ? 'yes' : 'NO'}`).join('  ')}`);
  }
  if (env.deviceMemoryGb) line(`device memory      ${env.deviceMemoryGb} GB`);
  if (env.storageQuotaMb) {
    line(`storage            ${env.storageUsedMb ?? 0} MB used of ${env.storageQuotaMb} MB`);
  }

  // ---------------------------------------------------------------- project
  heading('PROJECT');
  line(`files picked       ${input.filesPicked}`);
  line(`decoded            ${input.clips.length}`);
  line(`skipped            ${input.failures.length}`);
  if (input.grouping) {
    const devices = uniqueDevices(input);
    line(`devices            ${devices.length}  (${devices.join(', ')})`);
    line(`grouped by         ${input.grouping.basis}`);
  }
  {
    // Which clips carry a recording time the gates are allowed to act on. A
    // filesystem modification time is not one, and this line is here so that
    // never has to be guessed at again from a report.
    const stated = input.clips.filter((c) => c.recordedAtSource === 'metadata').length;
    line(
      `stated rec. time   ${stated} of ${input.clips.length} clips` +
        (stated === 0 ? '  (none — the recording-time gate is inert, as intended)' : ''),
    );
    const overridden = Object.keys(input.overrides).length;
    if (overridden) line(`device overrides   ${overridden} clip(s) reassigned by hand`);
    if (input.grouping) for (const warning of input.grouping.warnings) line(`  ! ${warning}`);
  }
  line(`sequence name      ${input.settings.projectName}`);
  line(`frame rate         ${input.settings.frameRate}`);
  line(`media folder       ${input.settings.mediaRoot || '(blank — export paths will be relative)'}`);

  heading('TIMING');
  line(`decode             ${seconds(input.timings.ingestSeconds)}`);
  line(`solve              ${seconds(input.timings.solveSeconds)}`);

  // ------------------------------------------------------------------ clips
  heading(`CLIPS (${input.clips.length})`);
  if (input.clips.length === 0) {
    line('  none decoded');
  } else {
    line(
      pad('CLIP', 34) +
        pad('DEVICE', 12) +
        pad('DUR', 10) +
        pad('RATE', 8) +
        pad('CH', 4) +
        pad('CODEC', 14) +
        pad('TIMECODE', 14) +
        pad('V', 3) +
        'WORKING',
    );
    for (const clip of input.clips.slice(0, MAX_CLIP_ROWS)) {
      line(
        pad(clip.relativePath, 34) +
          pad(input.deviceOf(clip.id), 12) +
          pad(`${clip.durationSeconds.toFixed(2)}s`, 10) +
          pad(String(clip.probe.sampleRate), 8) +
          pad(String(clip.probe.channels), 4) +
          pad(clip.probe.audioCodec ?? '?', 14) +
          pad(
            clip.timecodeSeconds !== undefined
              ? `${clock(clip.timecodeSeconds)}/${clip.probe.timecodeSource ?? '?'}`
              : '—',
            14,
          ) +
          pad(clip.probe.hasVideo ? 'y' : 'n', 3) +
          String(clip.sampleRate),
      );
    }
    if (input.clips.length > MAX_CLIP_ROWS) {
      line(`  … ${input.clips.length - MAX_CLIP_ROWS} more not listed`);
    }
  }

  // ---------------------------------------------------------------- skipped
  heading(`SKIPPED (${input.failures.length})`);
  if (input.failures.length === 0) line('  none');
  for (const failure of input.failures) {
    line(`  ${failure.relativePath}`);
    line(`      ${failure.message}`);
  }

  // ------------------------------------------------------------------ solve
  const result = input.result;
  heading('SOLVE');
  if (!result) {
    line('  not run');
  } else {
    const stats = result.stats;
    const synced = result.placements.filter((p) => p.synced).length;
    line(`clips synced       ${synced} of ${result.placements.length}`);
    line(`groups             ${result.groupCount}`);
    line(`pairs total        ${stats.totalPairs}`);
    line(`  compared         ${stats.aligned}`);
    line(`  skipped same dev ${stats.skippedBySameDevice}`);
    line(`  skipped rec time ${stats.skippedByRecordingTime}`);
    line(`  skipped envelope ${stats.skippedByEnvelope}`);
    line(`accepted edges     ${result.pairs.filter((p) => p.accepted).length}`);

    // Zero comparisons is not a result, it is a broken run: the solve finished
    // without ever looking at any audio, so nothing it reports below means
    // anything. Say so here rather than leaving it to be inferred from three
    // numbers adding up.
    if (stats.totalPairs > 0 && stats.aligned === 0) {
      line('');
      line('  !! NO PAIR WAS EVER COMPARED. The gates ruled out all ' + stats.totalPairs +
        ' of them,');
      line('     so this run could not have synced anything whatever the audio said.');
      if (stats.skippedBySameDevice === stats.totalPairs) {
        line('     Every pair was same-device: the grouping thinks this is one device.');
        line('     Set the right device on some clips and run it again.');
      } else if (stats.skippedByRecordingTime > 0) {
        line('     ' + stats.skippedByRecordingTime + ' were ruled out on recording time.');
      }
    }

    heading('PLACEMENTS');
    line(pad('CLIP', 34) + pad('DEVICE', 12) + pad('START', 12) + pad('QUALITY', 9) + pad('DRIFT', 12) + 'STATUS');
    for (const p of [...result.placements].sort((a, b) => a.startSeconds - b.startSeconds)) {
      const clip = input.clips.find((c) => c.id === p.clipId);
      line(
        pad(clip?.relativePath ?? p.clipId, 34) +
          pad(p.trackId, 12) +
          pad(`${p.startSeconds.toFixed(3)}s`, 12) +
          pad(p.quality !== undefined ? p.quality.toFixed(3) : '—', 9) +
          pad(p.driftPpm !== undefined ? `${p.driftPpm.toFixed(1)} ppm` : '—', 12) +
          (p.synced ? 'synced' : 'UNSYNCED'),
      );
    }

    // The part that answers "why didn't this sync?" — for each clip nothing
    // matched, the closest it came and which threshold turned it away. Without
    // this the report only restates what the screen already shows.
    if (result.unsyncedClipIds.length) {
      heading(`WHY EACH UNSYNCED CLIP DID NOT MATCH (${result.unsyncedClipIds.length})`);
      const shown = result.unsyncedClipIds.slice(0, MAX_NEAR_MISSES);
      for (const id of shown) {
        const name = input.clips.find((c) => c.id === id)?.relativePath ?? id;
        const best = bestPairFor(result.pairs, id);
        if (!best) {
          line(`  ${name}`);
          line(`      no pair was ever compared — every one was ruled out by a gate`);
          continue;
        }
        const otherId = best.aId === id ? best.bId : best.aId;
        const other = input.clips.find((c) => c.id === otherId)?.relativePath ?? otherId;
        line(`  ${name}`);
        line(
          `      closest: ${other}  quality=${best.quality.toFixed(3)} ` +
            `psr=${best.psr.toFixed(1)} overlap=${best.overlapSeconds.toFixed(1)}s ` +
            `method=${best.method}`,
        );
        line(`      rejected because: ${rejectionReason(best)}`);
      }
      if (result.unsyncedClipIds.length > shown.length) {
        line(`  … ${result.unsyncedClipIds.length - shown.length} more not listed`);
      }
    }

    if (result.inconsistencies.length) {
      const name = (id: string) =>
        input.clips.find((c) => c.id === id)?.relativePath ?? id;
      const overlaps = result.inconsistencies.filter((i) => i.kind === 'same-device-overlap');
      const disagreements = result.inconsistencies.filter(
        (i) => i.kind === 'offset-disagreement',
      );

      // Split, because the two mean different things and running them together
      // sends you hunting for the wrong cause.
      if (overlaps.length) {
        heading(`CLIPS FROM ONE DEVICE PLACED ON TOP OF EACH OTHER (${overlaps.length})`);
        line('  A device records one clip at a time, so no audio can make these true.');
        line('  Either a placement is wrong, or two real devices are grouped as one.');
        line('');
        for (const bad of overlaps.slice(0, MAX_NEAR_MISSES)) {
          line(
            `  ${name(bad.aId)}  and  ${name(bad.bId)}   overlap by ` +
              `${(bad.errorSeconds * 1000).toFixed(0)} ms`,
          );
        }
      }
      if (disagreements.length) {
        heading(`MATCHES THAT DISAGREE (${disagreements.length})`);
        line('  These two clips matched each other at one offset and the timeline put');
        line('  them at another. One of the two is wrong — check them by ear.');
        line('');
        for (const bad of disagreements.slice(0, MAX_NEAR_MISSES)) {
          line(
            `  ${name(bad.aId)}  vs  ${name(bad.bId)}   off by ` +
              `${(bad.errorSeconds * 1000).toFixed(0)} ms`,
          );
        }
      }
    }
  }

  line();
  line('end of report');
  return out.join('\n');
}

/**
 * Which acceptance threshold this pair failed.
 *
 * Acceptance needs all three at once, so naming the ones that failed says
 * exactly what would have to change — a short overlap and a low quality are
 * completely different problems with completely different fixes.
 */
function rejectionReason(pair: PairAlignment): string {
  const reasons: string[] = [];
  if (pair.overlapSeconds < 3) reasons.push(`overlap ${pair.overlapSeconds.toFixed(1)}s < 3s minimum`);
  if (pair.quality < 0.3) reasons.push(`quality ${pair.quality.toFixed(3)} < 0.30 minimum`);
  if (pair.psr < 6) reasons.push(`peak-to-sidelobe ${pair.psr.toFixed(1)} < 6 minimum`);
  if (!reasons.length) return 'passed thresholds but was not the best edge for this clip';
  return reasons.join('; ');
}

function bestPairFor(pairs: PairAlignment[], clipId: string): PairAlignment | undefined {
  let best: PairAlignment | undefined;
  for (const pair of pairs) {
    if (pair.aId !== clipId && pair.bId !== clipId) continue;
    if (pair.method === 'none') continue; // ruled out by a gate; nothing measured
    if (!best || pair.quality > best.quality) best = pair;
  }
  return best;
}

function uniqueDevices(input: DiagnosticInput): string[] {
  const seen = new Set<string>();
  for (const clip of input.clips) seen.add(input.deviceOf(clip.id));
  return [...seen].sort();
}

function pad(value: string, width: number): string {
  const s = value.length > width - 1 ? `…${value.slice(-(width - 2))}` : value;
  return s.padEnd(width);
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function seconds(value: number | undefined): string {
  return value === undefined ? '— not run' : `${value.toFixed(1)} s`;
}

function clock(value: number): string {
  const s = Math.max(0, Math.floor(value));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/**
 * What this browser can actually do.
 *
 * The codec probe is the load-bearing part: "AAC does not decode here" is a
 * one-line answer to a class of report that would otherwise be a long
 * conversation about which camera and which browser.
 */
export async function probeEnvironment(poolSize: number): Promise<EnvironmentInfo> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const info: EnvironmentInfo = {
    userAgent: nav.userAgent,
    platform: (nav as unknown as { platform?: string }).platform ?? 'unknown',
    cores: nav.hardwareConcurrency || 0,
    poolSize,
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    directoryPicker: typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
    webCodecsAudio: typeof (globalThis as { AudioDecoder?: unknown }).AudioDecoder === 'function',
    audioCodecs: {},
    deviceMemoryGb: nav.deviceMemory,
  };

  const decoder = (globalThis as {
    AudioDecoder?: {
      isConfigSupported(c: { codec: string; sampleRate: number; numberOfChannels: number }): Promise<{
        supported?: boolean;
      }>;
    };
  }).AudioDecoder;

  if (decoder) {
    // The codecs a camera or recorder actually writes. `mp4a.40.2` is AAC-LC,
    // which is what phones, GoPros and most DSLRs record.
    for (const codec of ['mp4a.40.2', 'opus', 'mp3', 'flac', 'alaw', 'ulaw']) {
      try {
        const support = await decoder.isConfigSupported({
          codec,
          sampleRate: 48000,
          numberOfChannels: 2,
        });
        info.audioCodecs[codec] = support.supported === true;
      } catch {
        info.audioCodecs[codec] = false;
      }
    }
  }

  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) {
      if (estimate.quota) info.storageQuotaMb = Math.round(estimate.quota / 1e6);
      if (estimate.usage) info.storageUsedMb = Math.round(estimate.usage / 1e6);
    }
  } catch {
    // Storage estimates are a nicety; never let one stop a bug report.
  }

  return info;
}

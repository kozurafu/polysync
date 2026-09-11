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
import { exportFcp7Xml, sequenceFrameSize } from '@polysync/exporters';
import type { FrameRate } from '@polysync/timecode';
import { buildTimeline, type TrackLayout } from './exportProject.ts';
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
  /** Needed to show what the export would actually write. */
  rate: FrameRate | null;
  trackLayout: TrackLayout;
}

const MAX_CLIP_ROWS = 200;
const MAX_NEAR_MISSES = 25;

/**
 * Drift past this is a failed measurement rather than a clock error. Real
 * hardware sits in the single or low double digits; a few hundred ppm would
 * already be a visibly broken crystal.
 */
const IMPLAUSIBLE_DRIFT_PPM = 500;

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

  // ------------------------------------------------------------- grouping
  // Which strategy won is only half the story. The half that matters when the
  // grouping is wrong is which one nearly worked, and what defeated it.
  if (input.grouping?.attempts.length) {
    heading('HOW THE DEVICES WERE WORKED OUT');
    line(pad('STRATEGY', 20) + pad('NAMED', 10) + pad('DEVICES', 9) + 'VERDICT');
    for (const a of input.grouping.attempts) {
      line(
        pad(a.basis, 20) +
          pad(`${a.named}/${input.clips.length}`, 10) +
          pad(String(a.devices), 9) +
          (a.basis === input.grouping.basis && !a.verdict ? '<- used' : a.verdict),
      );
      if (a.unnamed.length) line(`  could not name: ${a.unnamed.join(', ')}`);
    }
  }

  // --------------------------------------------------------------- devices
  if (input.clips.length) {
    const byDevice = new Map<string, IngestedClip[]>();
    for (const clip of input.clips) {
      const device = input.deviceOf(clip.id);
      const list = byDevice.get(device);
      if (list) list.push(clip);
      else byDevice.set(device, [clip]);
    }
    heading(`DEVICES (${byDevice.size})`);
    line(pad('DEVICE', 16) + pad('CLIPS', 7) + pad('TOTAL', 10) + pad('FORMAT', 22) + 'FILES LOOK LIKE');
    for (const [device, on] of byDevice) {
      const total = on.reduce((t, c) => t + c.durationSeconds, 0);
      const formats = [...new Set(on.map(formatOf))];
      line(
        pad(device, 16) +
          pad(String(on.length), 7) +
          pad(`${(total / 60).toFixed(1)}m`, 10) +
          pad(formats.length > 1 ? `${formats.length} formats` : (formats[0] ?? '?'), 22) +
          [...new Set(on.map((c) => stem(c.name)))].slice(0, 3).join(', '),
      );
      // A device holding several unrelated filename stems is usually two real
      // devices merged, which silently cancels every comparison between them.
      const stems = new Set(on.map((c) => stem(c.name)));
      if (stems.size > 1 && on.length > 2) {
        line(`  ! ${stems.size} different filename prefixes here — this may be more than one device`);
      }
      if (formats.length > 1) {
        line(`  ! mixed formats on one device: ${formats.join(' / ')}`);
      }
    }
  }

  heading('TIMING');
  line(`decode             ${seconds(input.timings.ingestSeconds)}`);
  line(`solve              ${seconds(input.timings.solveSeconds)}`);
  if (input.result && input.result.stats.aligned > 0 && input.timings.solveSeconds) {
    const per = (input.timings.solveSeconds / input.result.stats.aligned) * 1000;
    line(`per pair compared  ${per.toFixed(0)} ms  (${input.result.stats.aligned} pairs)`);
  }

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
        padPath(clip.relativePath, 34) +
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
    line(`rejected: would stack  ${stats.rejectedByOverlap}  (matches the solve refused to act on)`);
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

    // A project that solves into several groups has not solved: each group is
    // an island with its own arbitrary zero, and only clips within one island
    // are actually in sync with each other. `groups 10` said that and no more,
    // which left the most important question — which clips are stranded
    // together — needing the placements read by hand.
    if (result.groupCount > 1) {
      const byGroup = new Map<number, string[]>();
      for (const p of result.placements) {
        const list = byGroup.get(p.groupId);
        const name = input.clips.find((c) => c.id === p.clipId)?.relativePath ?? p.clipId;
        if (list) list.push(name);
        else byGroup.set(p.groupId, [name]);
      }
      heading(`ISLANDS (${byGroup.size})`);
      line('  Clips are only in sync with others in the same island. Separate islands were');
      line('  never matched to each other, so their positions are independent guesses.');
      line('');
      for (const [id, names] of [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length)) {
        line(`  island ${id}  (${names.length} clip${names.length === 1 ? '' : 's'})`);
        for (const name of names.slice(0, 8)) line(`      ${name}`);
        if (names.length > 8) line(`      … ${names.length - 8} more`);
      }
    }

    // How convincing the accepted matches were. A run where everything scrapes
    // past the threshold is a different problem from a run where half the
    // clips fail outright, and the placements table alone does not separate
    // them — the speech-isolated audio that made every match marginal looked,
    // clip by clip, like an ordinary partial success.
    const accepted = result.pairs.filter((p) => p.accepted);
    if (accepted.length) {
      const qualities = accepted.map((p) => p.quality).sort((a, b) => a - b);
      const at = (f: number) => qualities[Math.min(qualities.length - 1, Math.floor(f * qualities.length))];
      const marginal = qualities.filter((q) => q < 0.5).length;
      heading('HOW STRONG THE MATCHES WERE');
      line(`accepted matches   ${accepted.length}`);
      line(`quality  worst ${qualities[0].toFixed(3)}   median ${at(0.5).toFixed(3)}   best ${qualities[qualities.length - 1].toFixed(3)}`);
      line(`below 0.50         ${marginal} of ${accepted.length}`);
      if (marginal * 2 > accepted.length) {
        line('');
        line('  ! Most matches barely cleared the threshold. That usually means the audio being');
        line('    compared has had its transients removed — noise reduction, speech isolation or');
        line('    a heavy codec. Sync locks onto claps, thumps and footsteps, and those are the');
        line('    first thing such processing strips. Try the original recordings if you have them.');
      }
    }

    heading('PLACEMENTS');
    line(pad('CLIP', 34) + pad('DEVICE', 12) + pad('START', 12) + pad('QUALITY', 9) + pad('DRIFT', 12) + 'STATUS');
    for (const p of [...result.placements].sort((a, b) => a.startSeconds - b.startSeconds)) {
      const clip = input.clips.find((c) => c.id === p.clipId);
      line(
        padPath(clip?.relativePath ?? p.clipId, 34) +
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
      // A clip shorter than the minimum overlap cannot be matched by audio at
      // all, whatever it contains. Reporting its near miss as though a better
      // recording would have saved it is misleading: twelve of eighteen
      // unsynced clips in a real report were in this category, several under a
      // second long, and the report showed each one a tantalising 0.97 quality
      // against a clip it could never have been joined to.
      const minOverlap = 3;
      const tooShort = result.unsyncedClipIds
        .map((id) => input.clips.find((c) => c.id === id))
        .filter((c): c is IngestedClip => !!c && c.durationSeconds < minOverlap);
      if (tooShort.length) {
        heading(`TOO SHORT TO SYNC AT ALL (${tooShort.length})`);
        line(`  Matching needs ${minOverlap}s of shared audio. These clips are shorter than that,`);
        line('  so no amount of audio quality could place them. Cut them longer, or place');
        line('  them by hand against the clips either side.');
        line('');
        for (const clip of tooShort) {
          line(`  ${clip.relativePath}   ${clip.durationSeconds.toFixed(2)}s`);
        }
      }

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
      // Drift the hardware could not actually have. A crystal off by more than
      // a few hundred ppm would be visibly broken; a four-figure reading is a
      // failed measurement, and reporting it as fact sends people looking for a
      // clock problem that is not there. The real cause is usually a short clip
      // or a weak match giving the regression too little to work with.
      const wild = result.placements.filter(
        (p) => p.driftPpm !== undefined && Math.abs(p.driftPpm) > IMPLAUSIBLE_DRIFT_PPM,
      );
      if (wild.length) {
        heading(`DRIFT READINGS TO IGNORE (${wild.length})`);
        line(`  Anything past ${IMPLAUSIBLE_DRIFT_PPM} ppm is a failed measurement, not a clock problem —`);
        line('  a crystal that far out would be visibly broken. Usually a short clip or a');
        line('  weak match left the regression too little to work with.');
        line('');
        for (const p of wild.slice(0, MAX_NEAR_MISSES)) {
          const clip = input.clips.find((c) => c.id === p.clipId);
          line(`  ${clip?.relativePath ?? p.clipId}   ${p.driftPpm?.toFixed(1)} ppm`);
        }
      }

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
        // Worst first. A real report listed 1,205 of these in no particular
        // order, mixing 22 ms — which is half a frame, and rounds away
        // entirely in an export addressed in whole frames — with 94 minutes.
        // Every one of the catastrophic ones was buried.
        const frameSeconds = input.rate ? 1 / (input.rate.nominal * (input.rate.ntsc ? 1000 / 1001 : 1)) : 0.04;
        const ranked = [...disagreements].sort(
          (a, b) => Math.abs(b.errorSeconds) - Math.abs(a.errorSeconds),
        );
        const subFrame = ranked.filter((d) => Math.abs(d.errorSeconds) <= frameSeconds).length;
        heading(`MATCHES THAT DISAGREE (${disagreements.length})`);
        line('  These two clips matched each other at one offset and the timeline put');
        line('  them at another. One of the two is wrong — check them by ear.');
        line('');
        const over = disagreements.length - subFrame;
        line(`  ${over} ${over === 1 ? 'is' : 'are'} bigger than one frame and worth looking at.`);
        line(
          `  ${subFrame} ${subFrame === 1 ? 'is' : 'are'} within a frame, which an export ` +
            `addressed in whole frames rounds away.`,
        );
        line('');
        line('  Worst first:');
        for (const bad of ranked.slice(0, MAX_NEAR_MISSES)) {
          const ms = bad.errorSeconds * 1000;
          const human =
            Math.abs(ms) >= 60_000 ? `  (${(Math.abs(ms) / 60_000).toFixed(1)} minutes)` : '';
          line(
            `  ${name(bad.aId)}  vs  ${name(bad.bId)}   off by ${ms.toFixed(0)} ms${human}`,
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------- export
  // The report said nothing whatever about the export, and three consecutive
  // bug reports were export bugs: clips stacked on one track, every path
  // exported as a bare filename, a sequence with no format, and an XMEML the
  // importer could not build a timeline from. All of it was visible in the
  // file the user already had; none of it was in the report they sent.
  if (input.result && input.rate) {
    heading('WHAT THE XML EXPORT WOULD CONTAIN');
    try {
      const timeline = buildTimeline({
        projectName: input.settings.projectName,
        clips: input.clips,
        result: input.result,
        deviceOf: input.deviceOf,
        mediaRoot: input.settings.mediaRoot,
        rate: input.rate,
        trackLayout: input.trackLayout,
      });
      const xml = exportFcp7Xml(timeline);
      const comments = [...xml.matchAll(/<!-- (.*?) -->/g)].map((m) => m[1]);
      const videoTracks = comments.filter((c) => !/ ch\d+$/.test(c));
      const audioTracks = comments.filter((c) => / ch\d+$/.test(c));
      const frame = sequenceFrameSize(timeline.clips);

      line(`track layout       ${input.trackLayout}`);
      line(`sequence format    ${frame ? `${frame.width}x${frame.height}` : '(no clip has picture)'}`);
      line(`video tracks       ${videoTracks.length}`);
      videoTracks.forEach((c, i) => line(`  V${i + 1}  ${c}`));
      line(`audio tracks       ${audioTracks.length}`);
      audioTracks.forEach((c, i) => line(`  A${i + 1}  ${c}`));

      // Structural elements the importer needs. Their absence does not stop
      // the XML parsing, which is exactly why it went unnoticed for so long.
      //
      // Each is only expected when the project actually calls for it. A link
      // group needs something to link — a clip with picture *and* sound, or
      // more than one channel — so a project of mono WAVs legitimately has
      // none, and reporting that as missing would send the next person after a
      // bug that is not there.
      const linkable = timeline.clips.some(
        (c) => (c.hasVideo && c.hasAudio) || (c.hasAudio && (c.audioChannels ?? 2) > 1),
      );
      const anyAudio = timeline.clips.some((c) => c.hasAudio);
      const required: Array<[string, boolean]> = [
        ['masterclipid', true],
        ['link', linkable],
        ['outputs', anyAudio],
        ['outputchannelindex', anyAudio],
        ['timecode', true],
      ];
      const missing = required
        .filter(([tag, expected]) => expected && !xml.includes(`<${tag}>`))
        .map(([tag]) => tag);
      const skipped = required.filter(([, expected]) => !expected).map(([tag]) => tag);
      line(
        `importer elements  ${missing.length ? `MISSING ${missing.join(', ')}` : 'all present'}` +
          (skipped.length ? `  (${skipped.join(', ')} not needed here)` : ''),
      );

      const paths = [...xml.matchAll(/<pathurl>(.*?)<\/pathurl>/g)].map((m) => m[1]);
      const bare = paths.filter(
        (path) => !path.replace('file://', '').replace(/^\//, '').includes('/'),
      );
      line(`media folder       ${input.settings.mediaRoot || '(blank)'}`);
      line(`example path       ${paths[0] ?? '(none)'}`);
      if (bare.length) {
        line(
          `  ! ${bare.length} clip(s) have no folder at all, so the NLE must relink them one ` +
            `at a time. Pick the folder rather than the files, or fill in the media folder.`,
        );
      }

      // The invariant the per-device layout must never break.
      let hidden = 0;
      for (const block of xml.split('<track>').slice(1)) {
        const spans = [...block.matchAll(/<start>(-?\d+)<\/start>\s*<end>(-?\d+)<\/end>/g)]
          .map((m) => ({ from: Number(m[1]), to: Number(m[2]) }))
          .sort((a, b) => a.from - b.from);
        for (let i = 1; i < spans.length; i++) if (spans[i].from < spans[i - 1].to) hidden++;
      }
      line(`clips hidden       ${hidden === 0 ? 'none' : `${hidden} — a clip sits behind another`}`);
    } catch (error) {
      line(`  export failed to build: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  line();
  line('end of report');
  return out.join('\n');
}

/** Resolution and rate, or the audio format for a clip with no picture. */
function formatOf(clip: IngestedClip): string {
  if (clip.probe.hasVideo && clip.probe.width && clip.probe.height) {
    return `${clip.probe.width}x${clip.probe.height}`;
  }
  return `${clip.probe.audioCodec ?? '?'} ${clip.probe.sampleRate / 1000}k x${clip.probe.channels}`;
}

/**
 * The leading run of letters and digits a camera puts on its files, so that
 * `C2_4737.MP4` and `C2_4738.MP4` read as one prefix and `C1_4677.MP4` as
 * another. Used only to notice that one device is holding files that do not
 * look like they came from the same camera.
 */
function stem(name: string): string {
  const base = (name.split('/').pop() ?? name).replace(/\.[^.]+$/, '');
  const m = /^([A-Za-z]+\d*|\d+)/.exec(base);
  return m ? m[1].toUpperCase() : base.slice(0, 4).toUpperCase();
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

/**
 * Fit a value into a fixed column.
 *
 * Truncated from the *end*, with the ellipsis last. It used to keep the end
 * and put the ellipsis first, which is right for a long path — you want the
 * filename — and quietly wrong for anything else. A drift of `-1093.1 ppm`
 * came out as `…1093.1 ppm`, so a camera running slow read as running fast:
 * the one character that carried the meaning was the one dropped.
 */
function pad(value: string, width: number): string {
  const s = value.length > width - 1 ? `${value.slice(0, width - 2)}…` : value;
  return s.padEnd(width);
}

/** A path column, where the tail is the informative end. */
function padPath(value: string, width: number): string {
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

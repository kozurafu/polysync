/**
 * Write a synthetic shoot day to disk, so the CLI can be exercised before the
 * real test corpus exists.
 *
 *   npm run sample -- ./sample-shoot
 *   npm run sync   -- ./sample-shoot
 *
 * What it builds, and why each part is there:
 *
 *   REC/MIX_001.WAV     a clean 24-bit recorder feed carrying BWF timecode
 *   CAM_A, CAM_B, CAM_C on-board scratch mics: ~26 dB down, band-limited to
 *                       5 kHz, with their own noise floor — the degradation
 *                       that makes NLE waveform sync fall over
 *   CAM_C               deliberately overlaps CAM_B but never the recorder, so
 *                       it can only be placed transitively
 *   STRAY/ELSEWHERE.WAV unrelated material, which must come back unsynced
 *                       rather than being forced onto the timeline
 *
 * This is a demo and a smoke test, not a substitute for real rushes. Nothing
 * here has ever met a camera that writes something unexpected into a `udta`
 * atom, which is the risk the real corpus exists to retire.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { designLowpass, firFilter } from '@polysync/sync-core';

const SR = 48000;

function pseudoRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
}

/**
 * Speech-like material: bursts of band-limited noise with clear transients.
 *
 * The syllable and transient timings are **irregular**, and that matters more
 * than it looks. A perfectly periodic clap train correlates with itself at
 * every multiple of its period, so it is the worst possible test signal — it
 * manufactures exactly the multi-peak ambiguity that near-identical takes cause,
 * and two clips that never overlap in time will still match each other on it.
 * Real speech has no such period, so neither does this.
 */
function master(frames: number, seed: number): Float64Array {
  const rand = pseudoRandom(seed);
  const x = new Float64Array(frames);
  let envelope = 0;
  let nextSyllable = 0;
  let nextTransient = Math.round(SR * (1 + rand() + 0.5));
  for (let i = 0; i < frames; i++) {
    if (i >= nextSyllable) {
      envelope = 0.6 + rand();
      // 0.18-0.44 s apart: a syllable rate, jittered so it never repeats.
      nextSyllable = i + Math.round(SR * (0.31 + rand() * 0.26));
    }
    envelope *= 0.99985;
    x[i] = rand() * 0.55 * envelope;
    if (i >= nextTransient) {
      x[i] = 0.95; // a door, a clap, a cough — something with a hard edge
      nextTransient = i + Math.round(SR * (3.1 + rand() * 5));
    }
  }
  return x;
}

function scratch(source: Float64Array, seed: number): Float64Array {
  const band = firFilter(Float64Array.from(source), designLowpass(5000 / SR, 127));
  const rand = pseudoRandom(seed);
  const out = new Float64Array(source.length);
  for (let i = 0; i < source.length; i++) out[i] = band[i] * 0.05 + rand() * 0.004;
  return out;
}

function writeWavBytes(
  signal: Float64Array,
  opts: { bits?: 16 | 24; timeReferenceSeconds?: number; ixml?: string } = {},
): Uint8Array {
  const bits = opts.bits ?? 16;
  const bytesPerSample = bits >> 3;
  const frames = signal.length;
  const data = new Uint8Array(frames * bytesPerSample);
  const dataView = new DataView(data.buffer);
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, signal[i]));
    if (bits === 16) dataView.setInt16(i * 2, Math.round(v * 32767), true);
    else {
      const n = Math.round(v * 8388607);
      dataView.setUint8(i * 3, n & 0xff);
      dataView.setUint8(i * 3 + 1, (n >> 8) & 0xff);
      dataView.setUint8(i * 3 + 2, (n >> 16) & 0xff);
    }
  }

  const chunks: Uint8Array[] = [];
  const fmt = new Uint8Array(16);
  const fv = new DataView(fmt.buffer);
  fv.setUint16(0, 1, true);
  fv.setUint16(2, 1, true);
  fv.setUint32(4, SR, true);
  fv.setUint32(8, SR * bytesPerSample, true);
  fv.setUint16(12, bytesPerSample, true);
  fv.setUint16(14, bits, true);
  chunks.push(chunk('fmt ', fmt));

  if (opts.timeReferenceSeconds !== undefined) {
    const bext = new Uint8Array(602);
    writeAscii(bext, 'Polysync sample shoot', 0);
    writeAscii(bext, 'POLYSYNC SAMPLE', 256);
    writeAscii(bext, '2026-09-02', 320);
    writeAscii(bext, '10:52:02', 330);
    const bv = new DataView(bext.buffer);
    const samples = Math.round(opts.timeReferenceSeconds * SR);
    bv.setUint32(338, samples >>> 0, true);
    bv.setUint32(342, Math.floor(samples / 0x1_0000_0000), true);
    bv.setUint16(346, 1, true);
    chunks.push(chunk('bext', bext));
  }
  if (opts.ixml) chunks.push(chunk('iXML', new TextEncoder().encode(opts.ixml)));
  chunks.push(chunk('data', data));

  const body = concat([ascii('WAVE'), ...chunks]);
  const header = new Uint8Array(8);
  header.set(ascii('RIFF'), 0);
  new DataView(header.buffer).setUint32(4, body.length, true);
  return concat([header, body]);
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(8);
  header.set(ascii(id), 0);
  new DataView(header.buffer).setUint32(4, body.length, true);
  const pad = body.length % 2 ? new Uint8Array(1) : new Uint8Array(0);
  return concat([header, body, pad]);
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function writeAscii(target: Uint8Array, s: string, at: number): void {
  for (let i = 0; i < s.length; i++) target[at + i] = s.charCodeAt(i) & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function main(): Promise<void> {
  const root = process.argv[2] ?? './sample-shoot';
  const event = master(SR * 150, 2026); // 2m30 of "shoot"

  const slice = (fromSeconds: number, lengthSeconds: number) =>
    event.subarray(Math.round(fromSeconds * SR), Math.round((fromSeconds + lengthSeconds) * SR));

  // Ground truth, in seconds from the start of the event.
  const plan = [
    { dir: 'REC', file: 'MIX_001.WAV', from: 0, length: 150, clean: true, tc: 10 * 3600 + 52 * 60 },
    { dir: 'CAM_A', file: 'A001C001.WAV', from: 6, length: 60, clean: false },
    { dir: 'CAM_A', file: 'A001C002.WAV', from: 80, length: 55, clean: false },
    { dir: 'CAM_B', file: 'B001C001.WAV', from: 13, length: 95, clean: false },
    // CAM_C overlaps CAM_B but starts after the recorder stops in a real cut;
    // here it is placed to exercise the transitive path through B.
    { dir: 'CAM_C', file: 'C001C001.WAV', from: 40, length: 70, clean: false },
  ];

  const ixml = `<?xml version="1.0" encoding="UTF-8"?>
<BWFXML>
  <PROJECT>Polysync sample shoot</PROJECT>
  <SPEED><TIMECODE_RATE>25/1</TIMECODE_RATE><TIMECODE_FLAG>NDF</TIMECODE_FLAG>
    <FILE_SAMPLE_RATE>48000</FILE_SAMPLE_RATE>
    <TIMECODE_SAMPLE_RATE>48000</TIMECODE_SAMPLE_RATE></SPEED>
  <TRACK_LIST><TRACK_COUNT>1</TRACK_COUNT>
    <TRACK><CHANNEL_INDEX>1</CHANNEL_INDEX><NAME>Boom</NAME></TRACK></TRACK_LIST>
</BWFXML>`;

  console.log(`Writing a sample shoot to ${root}`);
  for (const item of plan) {
    const signal = slice(item.from, item.length);
    const bytes = item.clean
      ? writeWavBytes(signal, { bits: 24, timeReferenceSeconds: item.tc, ixml })
      : writeWavBytes(scratch(signal, item.from + 1), { bits: 16 });
    await mkdir(join(root, item.dir), { recursive: true });
    await writeFile(join(root, item.dir, item.file), bytes);
    console.log(
      `  ${item.dir}/${item.file}  ${item.length}s  starts +${item.from}s  ` +
        (item.clean ? 'clean 24-bit, BWF timecode' : 'scratch mic, 26 dB down'),
    );
  }

  // Unrelated material: it must come back unsynced, not forced onto the
  // timeline. A tool that places this confidently is worse than one that says
  // it does not know.
  await mkdir(join(root, 'STRAY'), { recursive: true });
  await writeFile(join(root, 'STRAY', 'ELSEWHERE.WAV'), writeWavBytes(master(SR * 40, 777)));
  console.log('  STRAY/ELSEWHERE.WAV  40s  unrelated — expected to come back unsynced');

  console.log(`\nNow run:  npm run sync -- ${root}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

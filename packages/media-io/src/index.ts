/**
 * Media ingest — NOT YET IMPLEMENTED. Phase 1.
 *
 * The contract this package must satisfy, and nothing more: turn a File into
 * the derived signals `sync-core` needs, plus whatever metadata the exporters
 * need. Everything codec-specific stops here.
 *
 * Planned implementation (see docs/02-architecture.md and docs/06-browser-platform.md):
 *   probe      mediabunny Input over a BlobSource — lazy byte-range reads, so a
 *              200 GB card is never held in memory
 *   timecode   tmcd atom (MOV/MP4), bext + iXML (BWF), MXF System Item
 *   decode     WebCodecs AudioDecoder, with mediabunny's software PCM decoders
 *              for every recorder format, turbores for ProRes, mxf.js for MXF,
 *              and a lazily loaded single-threaded libav.js as the last resort
 *   derive     mono downmix, anti-aliased decimation to ~2 kHz, 100 Hz
 *              log-energy envelope
 *   cache      OPFS, keyed by (name, size, mtime) — decode each file once, ever
 */

import type { AudioClip } from '@polysync/sync-core';

export interface ProbeResult {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  hasVideo: boolean;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  /** Start timecode in seconds since midnight, if the file carries one. */
  timecodeSeconds?: number;
  /** Per-channel names from iXML <TRACK_LIST>, e.g. ["Boom", "Lav1"]. */
  channelNames?: string[];
}

export interface IngestResult extends ProbeResult {
  clip: AudioClip;
}

export async function probe(_file: File): Promise<ProbeResult> {
  throw new Error('media-io: not implemented — Phase 1');
}

export async function ingest(_file: File, _id: string): Promise<IngestResult> {
  throw new Error('media-io: not implemented — Phase 1');
}

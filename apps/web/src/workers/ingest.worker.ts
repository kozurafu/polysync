/// <reference lib="webworker" />
/**
 * Decode one file to the mono signal the sync engine correlates.
 *
 * One of these runs per hardware thread. Decode is the expensive, embarrassingly
 * parallel half of ingest — a demuxer walking an hour of 4K H.264 to reach the
 * audio track is doing real work, and doing four of them at once costs nothing
 * but memory.
 *
 * `File` survives structured cloning, so the worker is handed the file itself
 * and reads it by byte range. Nothing is copied into the message.
 */

import { blobSource, ingest, type ProbeResult } from '@polysync/media-io';

export interface IngestRequest {
  id: string;
  file: File;
  relativePath: string;
  workingRate?: number;
}

export type IngestResponse =
  | { type: 'progress'; id: string; fraction: number }
  | {
      type: 'done';
      id: string;
      probe: ProbeResult;
      /** Transferred, not copied. */
      samples: ArrayBuffer;
      sampleRate: number;
      /** Small absolute-peak summary for drawing the clip, ~400 points. */
      peaks: Float32Array;
      timecodeSeconds?: number;
      recordedAtSeconds?: number;
      recordedAtSource?: 'metadata' | 'filesystem';
      frameRate?: number;
    }
  | { type: 'error'; id: string; message: string };

const post = (message: IngestResponse, transfer: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(message, transfer);
};

self.onmessage = async (event: MessageEvent<IngestRequest>) => {
  const { id, file, relativePath, workingRate } = event.data;
  try {
    const source = blobSource(file, relativePath);
    const { clip, probe } = await ingest(source, id, {
      workingRate,
      // Offered as a fallback only. `ingest` prefers whatever the file itself
      // says and marks the result, so the gates can tell the two apart.
      recordedAtSeconds: file.lastModified / 1000,
      onProgress: (fraction) => post({ type: 'progress', id, fraction }),
    });

    // A tiny peak summary travels with the result so the UI can draw the clip
    // without ever holding the audio itself.
    const peaks = summarise(clip.samples, 400);

    // The samples buffer is the only large thing here, and transferring hands
    // ownership over rather than cloning it.
    const buffer = clip.samples.buffer as ArrayBuffer;
    post(
      {
        type: 'done',
        id,
        probe,
        samples: buffer,
        sampleRate: clip.sampleRate,
        peaks,
        timecodeSeconds: clip.timecodeSeconds,
        recordedAtSeconds: clip.recordedAtSeconds,
        recordedAtSource: clip.recordedAtSource,
        frameRate: clip.frameRate,
      },
      [buffer],
    );
  } catch (error) {
    post({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

/** Absolute peak per bucket — enough to draw a clip, 1.6 kB regardless of length. */
function summarise(samples: Float64Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  if (samples.length === 0) return out;
  const per = samples.length / buckets;
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor(i * per);
    const to = Math.min(samples.length, Math.floor((i + 1) * per));
    let peak = 0;
    for (let j = from; j < to; j++) {
      const v = samples[j] < 0 ? -samples[j] : samples[j];
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  // Normalise so a quiet scratch track is still visible next to a hot recorder
  // feed. This is a display decision only; the engine sees the real levels.
  let max = 0;
  for (const v of out) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < buckets; i++) out[i] /= max;
  return out;
}

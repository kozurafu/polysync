/**
 * Container probing and audio decode through `mediabunny`.
 *
 * This covers MP4, MOV, MKV, MPEG-TS and the rest. WAV goes through `wav.ts`
 * instead — not because mediabunny cannot read it, but because we need `bext`
 * and iXML out of it and no library parses those.
 *
 * Two properties of mediabunny make it the right choice here, and both are
 * about *not* reading things:
 *
 *   - It reads by byte range through a source we supply, so a 200 GB card is
 *     never held in memory.
 *   - It can iterate audio packets without touching video sample data. For an
 *     hour of 4K H.264 the video is 99.9% of the bytes and none of the
 *     information we need.
 *
 * `canDecode()` is the gate for everything compressed. In Node there is no
 * WebCodecs at all, so only mediabunny's own software PCM decoders work —
 * which is exactly enough for the CLI harness, because sound recorders write
 * PCM and the recorder is the reference track for most jobs.
 */

import {
  ALL_FORMATS,
  AudioSampleSink,
  CustomSource,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import type { ByteSource } from './source.js';

export interface ContainerInfo {
  durationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  audioCodec?: string;
  videoCodec?: string;
  sampleRate?: number;
  channels?: number;
  width?: number;
  height?: number;
  /** True when the audio track can actually be decoded in this environment. */
  decodable: boolean;
}

/** Wrap a `ByteSource` so mediabunny reads through it rather than around it. */
function mediabunnySource(src: ByteSource): CustomSource {
  return new CustomSource({
    getSize: () => src.size,
    read: (start, end) => src.read(start, end),
    // Demuxers walk index tables with many small sequential reads; page-aligned
    // prefetching turns those into far fewer underlying reads.
    prefetchProfile: 'fileSystem',
  });
}

export function openContainer(src: ByteSource): Input {
  return new Input({ formats: ALL_FORMATS, source: mediabunnySource(src) });
}

export async function probeContainer(src: ByteSource): Promise<ContainerInfo> {
  const input = openContainer(src);
  const audio: InputAudioTrack | null = await input.getPrimaryAudioTrack();
  const video: InputVideoTrack | null = await input.getPrimaryVideoTrack();

  const info: ContainerInfo = {
    durationSeconds: await input.computeDuration(),
    hasVideo: video !== null,
    hasAudio: audio !== null,
    decodable: false,
  };

  if (video) {
    info.videoCodec = video.codec ?? undefined;
    info.width = await video.getCodedWidth();
    info.height = await video.getCodedHeight();
  }
  if (audio) {
    info.audioCodec = audio.codec ?? undefined;
    info.sampleRate = audio.sampleRate;
    info.channels = audio.numberOfChannels;
    info.decodable = await audio.canDecode();
  }
  return info;
}

/**
 * Stream the primary audio track as mono `Float64Array` blocks.
 *
 * Channels are averaged, matching `streamWavMono`, so the two decode paths
 * produce interchangeable signals.
 */
export async function streamContainerMono(
  src: ByteSource,
  onBlock: (block: Float64Array, sampleRate: number) => void | Promise<void>,
): Promise<{ sampleRate: number; frames: number }> {
  const input = openContainer(src);
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error(`${src.name}: no audio track`);
  if (!(await track.canDecode())) {
    throw new UndecodableAudioError(src.name, track.codec ?? 'unknown');
  }

  const sink = new AudioSampleSink(track);
  const sampleRate = track.sampleRate;
  let frames = 0;
  // Reused across samples; decoders emit thousands of small buffers and
  // allocating per sample is measurable on an hour of audio.
  let scratch = new Float32Array(0);

  for await (const sample of sink.samples()) {
    const channels = sample.numberOfChannels;
    const count = sample.numberOfFrames;
    const needed = count * channels;
    if (scratch.length < needed) scratch = new Float32Array(needed);
    // 'f32' is interleaved; planar formats would need one copyTo per plane.
    sample.copyTo(scratch.subarray(0, needed), { planeIndex: 0, format: 'f32' });
    sample.close();

    const mono = new Float64Array(count);
    if (channels === 1) {
      for (let i = 0; i < count; i++) mono[i] = scratch[i];
    } else {
      for (let i = 0; i < count; i++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) acc += scratch[i * channels + c];
        mono[i] = acc / channels;
      }
    }
    frames += count;
    await onBlock(mono, sampleRate);
  }

  return { sampleRate, frames };
}

/**
 * Raised when a file's audio codec has no decoder in this environment.
 *
 * Carries the codec name because the only useful thing to tell a user here is
 * which file and which codec — "could not prepare media" with no detail was
 * one of PluralEyes' more exasperating error messages.
 */
export class UndecodableAudioError extends Error {
  constructor(
    readonly fileName: string,
    readonly codec: string,
  ) {
    super(
      `${fileName}: no decoder available for audio codec "${codec}" in this environment. ` +
        `In a browser this needs WebCodecs; in Node only PCM decodes. ` +
        `Extract a sidecar WAV and ingest that instead.`,
    );
    this.name = 'UndecodableAudioError';
  }
}

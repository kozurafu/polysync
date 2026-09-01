# Architecture

**Browser-only, local-first.** No server component, no upload, no account. The media never leaves the machine, which is both the privacy story and the reason this can be free to run.

Evidence that this is actually viable in September 2026 is in [`06-browser-platform.md`](06-browser-platform.md). The short version: WebCodecs is at ~94% global coverage and complete in Safari 26; `mediabunny` demuxes MP4/MOV/WAV without loading files into memory; ProRes has a working WASM decoder; and PCM — which is what every sound recorder writes, and therefore the reference track for nearly every sync — needs no codec support at all.

---

## 1. Shape

```
┌───────────────────────────────────────────────────────────────────┐
│ apps/web  — React + Vite, main thread                             │
│   file picking · project state · timeline UI · playback · export  │
└───────────────┬───────────────────────────────────────────────────┘
                │ structured-clone messages, transferable buffers
    ┌───────────┴────────────┬──────────────────────┐
    ▼                        ▼                      ▼
┌─────────────┐    ┌───────────────────┐    ┌───────────────────┐
│ ingest      │    │ sync worker       │    │ export            │
│ worker pool │    │ (1, or N shards)  │    │ (main thread)     │
│             │    │                   │    │                   │
│ demux       │    │ prepare           │    │ FCP7 XML          │
│ decode      │───▶│ pairwise align    │───▶│ FCPXML            │
│ downmix     │    │ drift estimate    │    │ EDL / OTIO        │
│ decimate    │    │ graph solve       │    │                   │
│ envelope    │    │                   │    │                   │
│ timecode    │    │                   │    │                   │
└─────────────┘    └───────────────────┘    └───────────────────┘
      │                     │
      ▼                     ▼
┌───────────────────────────────────────────────────────────────────┐
│ OPFS / IndexedDB  — analysis cache, project state, file handles    │
└───────────────────────────────────────────────────────────────────┘
```

The key structural decision: **the expensive, format-specific work (ingest) is completely separate from the algorithm (sync)**. `sync-core` never sees a file, a codec, or a DOM API — it takes `Float64Array` and returns offsets. That is what lets it be tested exhaustively in Node, run in a worker, and be swapped for a Rust/WASM implementation later without touching anything else.

## 2. Packages

| Package | Depends on | Responsibility |
|---|---|---|
| `sync-core` | *nothing* | FFT, DSP, GCC-PHAT, drift, graph solve. Pure functions over typed arrays |
| `timecode` | *nothing* | SMPTE arithmetic; `tmcd` atom parsing; BWF `bext` + iXML parsing |
| `media-io` | mediabunny, turbores, mxf.js | Probe, demux, decode audio to mono, extract metadata. The only package that knows about containers |
| `exporters` | `timecode` | FCP7 XML, FCPXML, EDL, OTIO writers |
| `apps/web` | all of the above | UI, worker orchestration, persistence |

Nothing above `media-io` knows what a codec is. Nothing above `sync-core` knows what an FFT is.

## 3. Ingest pipeline

Per file, in a worker:

1. **Probe** — `mediabunny` `Input` over a `BlobSource`. Reads by byte range; a 200 GB card is never held in memory. Gives duration, tracks, sample rate, channel count, codec.
2. **Timecode** — parse the `tmcd` track (MOV/MP4), `bext`/iXML (WAV), or System Item TC (MXF). No library does the first two; we write them (~150 lines each, `timecode` package).
3. **Decode audio only.** `mediabunny` lets us iterate audio packets without touching video sample data — a large win, because for a 4K H.264 hour the video is 99.9% of the bytes and none of the information we need.
4. **Downmix to mono, decimate to ~2 kHz, compute the log-energy envelope at 100 Hz.** These three derived signals are all the sync engine ever needs.
5. **Cache** the derived signals in OPFS keyed by `(size, mtime, name)`. Re-opening a project is then instant; only new or changed files are re-decoded. Decode is the dominant cost, so this matters more than any algorithmic optimisation.

The full-rate audio is *not* retained. It is re-decoded on demand for the refinement pass and for playback. Holding an hour of 48 kHz float mono is 700 MB per clip; holding the 2 kHz decimation is 29 MB, and the envelope 1.4 MB.

## 4. The codec fallback ladder

The honest position: a browser cannot decode everything a professional camera writes. So the app degrades in defined steps rather than failing opaquely.

| Rung | Path | Covers |
|---|---|---|
| 1 | **PCM decoded in JS** — no codec support needed | WAV/BWF/RF64, AIFF, LPCM in MOV, AES3 in MXF. **Every sound recorder.** This is the reference track for most jobs, and it always works |
| 2 | **WebCodecs `AudioDecoder`** | AAC (Chromium, Safari), Opus, MP3, FLAC. Covers essentially every camera's audio track |
| 3 | **`turbores`** for ProRes video, `mxf.js` for MXF containers | Post-production and broadcast media. `mxf.js` is v0.1.0 and Chromium-only — treat as a dependency we may have to fork |
| 4 | **`@libav.js/variant-webcodecs`, lazy-loaded, single-threaded** | Exotic containers. Only pulled when rungs 1–3 fail, so the 1.5–3 MB WASM never touches a normal session |
| 5 | **Out of reach: R3D, ARRIRAW, DNxHD/HR** | Tell the user plainly, and offer the sidecar path below |

Note what this means in practice: **we only ever need the audio track.** That is a far easier problem than playing the video, and the video preview degrading to "no preview available" for MXF and R3D is exactly what PluralEyes itself did.

**Sidecar path for rung 5.** A one-line ffmpeg command that extracts a WAV alongside each unsupported file, which the app then ingests normally. Generate the command in-app, let the user paste it. Unglamorous, honest, and it unblocks the 5% of shoots that would otherwise be dead.

## 5. File access

| Browser | Path | Consequence |
|---|---|---|
| Chrome / Edge | `showDirectoryPicker()`, handles persisted in IndexedDB, permissions persistent once installed as a PWA | Pick the card folder once, ever |
| Safari / Firefox | `<input webkitdirectory>` or folder drag-drop | Full read capability, but folders must be re-dropped each session |

`File.slice()` is a lazy range read on every browser, so large-file handling is identical across all of them. The File System Access gap costs convenience, not capability. Ship `browser-fs-access` to paper over the API difference, and store project state (paths, offsets, decisions) in OPFS so a re-drop relinks rather than re-analyses — the same "relink media" flow every NLE already has.

## 6. Threading and compute

- One ingest worker per hardware thread, capped at `navigator.hardwareConcurrency - 1`.
- The graph solve is `O(n²)` pairwise. At 200 clips that is 19,900 alignments — too many to run naively. Mitigations, in order of when they apply:
  1. **Timecode gate.** Where both clips carry TC, the offset is known to within a frame; the pair costs a 200 ms verification instead of a full search.
  2. **Recording-time gate.** File mtimes bracket which clips could possibly overlap. Two clips whose recording windows do not intersect within an hour of slop cannot match.
  3. **Envelope prefilter.** Correlate the 100 Hz envelopes first — 360,000 samples for a full hour, correlated in milliseconds. Only pairs that survive get the expensive passes.
  4. **Fingerprint index (Phase 3).** Constellation hashing over the envelope's peak structure turns pair discovery into a hash lookup, taking discovery from `O(n²)` to roughly `O(n)`.
- No SharedArrayBuffer, therefore no COOP/COEP headers, therefore the app can be served from anywhere static. This is worth protecting: COOP/COEP poisons every cross-origin subresource on the page. If a future WASM kernel needs threads, gate it behind feature detection rather than making it the default.

## 7. State and persistence

- **Project** — clip list, track assignment, solved offsets, manual overrides, locks. JSON in OPFS, exportable as a `.polysync` file.
- **Analysis cache** — decimated signals and envelopes, OPFS, keyed by file identity, LRU-evicted.
- **File handles** — IndexedDB, Chromium only.
- Nothing is sent anywhere. There is no telemetry endpoint to accidentally leak a client's rushes to.

## 8. Packaging

Ship the web app first, at a static URL, gated to Chromium with a visible "works best in Chrome or Edge" note and a working `webkitdirectory` fallback for Safari and Firefox.

An **Electron** build follows for people who want persistent library management and native file watching — same codebase, one preload shim swapping `browser-fs-access` for Node `fs`, and Chromium's codec behaviour guaranteed on every platform. Tauri is the wrong choice here specifically *because* it uses the system webview: on macOS and Linux that is WebKit, which has no File System Access API at all, so the thing Tauri saves you in binary size it costs you in three divergent renderer code paths.

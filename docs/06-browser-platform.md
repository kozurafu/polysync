# Browser platform report — September 2026

The feasibility evidence for a fully client-side build. Anything that could not be confirmed is flagged as unverified rather than asserted.

## Verdict by area

| Area | Verdict |
|---|---|
| WebCodecs decode (H.264 / HEVC / AV1 / AAC / PCM) | **Viable** on Chromium and Safari 26; Firefox viable for video, weak for AAC |
| MP4 / MOV demux | **Viable** — `mediabunny` is the clear winner |
| MXF demux | **Partly viable** — `mxf.js`, v0.1.0, Chromium-only, single-author risk |
| BWF/WAV + `bext`/iXML timecode | **Viable**, but ~150 lines of RIFF walking to write yourself |
| ProRes decode | **Viable** — `turbores`, a WASM decoder |
| ffmpeg.wasm | **Avoid** — stale since Jan 2025; use `libav.js` if anything |
| File System Access | **Chromium-only.** Viable there, fallback needed for Safari/Firefox |
| WASM SIMD + Workers | **Viable** |
| WebGPU FFT | **Partly viable** — no library exists, and it is unnecessary |
| Timecode (`tmcd` / `bext`) | **Viable**, no ready-made library — write it |
| Export FCPXML / FCP7 XML / EDL / OTIO | **Viable** — hand-write |
| Export AAF | **Not viable in a browser** |
| Packaging | **Electron** for a pro media tool; Tauri only if mobile becomes a requirement |

---

## 1. WebCodecs

| Browser | Status |
|---|---|
| Chrome / Edge | Full since 94 |
| Firefox | Full since 130 |
| Safari | Partial 16.4–18.7 (video only); **full from 26.0** — `AudioDecoder`/`AudioEncoder` landed in 26.0 |

Global coverage ≈ 93.6%.

**Video decode**, from real-world telemetry across 1.1M sessions ([webcodecsfundamentals.org codec analysis, 2026](https://webcodecsfundamentals.org/datasets/codec-analysis-2026/)):

| Codec | Real-world decode support | Notes |
|---|---|---|
| H.264 (`avc1.*`) | **99.94%** | The baseline. Always works |
| VP9 | ~99.9% | Irrelevant for camera media |
| AV1 | ~91.5% | Safari macOS only ~24%, iOS ~33% |
| HEVC | Inverse of AV1 | Near-universal on Safari; **Edge on Windows only 56%** (licensing). Chromium only ever does *hardware* HEVC — no software fallback |
| ProRes | **0% — never exposed by any browser** | Not in the WebCodecs codec registry |

Practical rule: H.264 always works; HEVC works on Safari/macOS and wherever the OS has a hardware decoder. Always gate with `VideoDecoder.isConfigSupported()`.

**Audio decode:** AAC ~96.4% (Chromium and Safari fine; MDN reports AAC unsupported in Firefox's WebCodecs — see open questions), Opus ~96.5%, MP3 and FLAC decode-only, PCM ~94.6%.

**The point that de-risks everything:** we do not need WebCodecs for PCM at all. `mediabunny` ships software decoders for every PCM variant — 8/16/24/32-bit signed and unsigned, f32/f64, both endiannesses, µ-law and A-law. Sound recorders write PCM, and the recorder is the reference track for most syncs, so the primary path never depends on a codec.

## 2. Demuxing

**`mediabunny@1.55.5`** (published 2026-08-31). Zero-dependency TypeScript, MPL-2.0, weekly releases. Tree-shakeable: MP4 reading ≈ 16 kB gzipped, all formats ≈ 30 kB.

Reads MP4/M4V/M4A, **QuickTime .mov**, fragmented MP4/CMAF, MKV, WebM, Ogg, MP3, **WAV including RF64/ds64** (critical for >4 GB recorder files), ADTS, FLAC, MPEG-TS, HLS.

```ts
import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';
const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
const audio = await input.getPrimaryAudioTrack();
```

`BlobSource` reads lazily by byte range from a `File` (including one from a `FileSystemFileHandle`) — it does not load the file into memory. There is a `registerDecoder` custom-coder API for codecs WebCodecs lacks.

Canon/Sony/Panasonic `.MOV` parses natively; the vendor-specific `udta` and timed-metadata atoms are not interpreted, but the audio tracks are.

**ProRes: `turbores@1.2.2`** — same author as mediabunny, Zig + TypeScript, MPL-2.0, ~50 kB gzipped, WASM SIMD with shared-memory multithreading. Decodes every ProRes variant up to 16K. Author's own benchmarks claim 228 fps on 4K ProRes 422 HQ versus native FFmpeg's 107 (*unverified independently*). This is the find that makes ProRes a non-issue.

**MXF: `mxf.js@0.1.0`** — pure-JS OP1a demuxer in a Web Worker. Hardened against real Sony/Canon broadcast files (in-header-partition indexes for XAVC/AVC-Intra, understated `headerByteCount`, footer-RIP-only files). Decodes **PCM (Wave/AES3) audio in the worker** and exposes **per-frame System Item timecode** plus computed package start timecodes. Chromium only; v0.1.0; no public repository listed on npm. Audit before depending on it.

**Rejected:** `mp4box.js` (slower, heavier, and its 2.4.1 dist contains no `tmcd` parser), `@remotion/media-parser` (its own docs say Remotion is moving to mediabunny; proprietary licence), `webav` (a compositing toolkit, not a demuxer), `jsmpeg` (dead since 2019).

**BWF `bext`/iXML:** no library does this properly. `wavefile@11.0.0` reads `bext` and `iXML` but is unmaintained since 2020 and loads the entire file into memory — unusable on a 4-hour poly-WAV. Read the first ~1 MB via `file.slice(0, 1<<20)` and walk the RIFF chunks yourself.

## 3. ffmpeg.wasm and libav.js

**ffmpeg.wasm is stale** — `@ffmpeg/ffmpeg@0.12.15` last published 2025-01-07, still self-described as experimental, and its multithreaded core needs SharedArrayBuffer and therefore COOP+COEP headers, which poisons every cross-origin subresource on the page. Core WASM is 25–32 MB uncompressed.

**`libav.js@6.10.9`** (2026-08-18) is the live alternative: granular variant packages, ~178 KiB base overhead, 1.5–3 MiB for a typical build, and single-threaded variants that need no COOP/COEP. LGPL.

Given `turbores` for ProRes and `mxf.js` for MXF, we likely never need it — which is the right outcome, since it is the biggest bundle-size risk on the list. Keep it as a lazy-loaded fallback only.

## 4. File System Access

| API | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| `showDirectoryPicker` etc. | 105+ | **No** (Mozilla's position: "harmful") | **No** |
| OPFS | 86+ | 111+ | 15.2+ (incl. iOS) |
| `webkitdirectory` | 30+ | 50+ | 11.1+ desktop, iOS 18.4+ |

Global FSA coverage is 26.9% and unlikely to change.

**Reading large files is solved everywhere:** `File.slice()` is a lazy range read against the on-disk file, not a copy. Combined with mediabunny's `BlobSource`, a 200 GB card streams without touching RAM — from a plain `<input>`-derived `File` too. The FSA gap costs write-back and re-open convenience, not read capability.

**Persistent permissions** are Chromium-only, since Chrome 122: store the handle in IndexedDB and call `requestPermission()` later. Installed PWAs persist permissions automatically once granted — a strong reason to make the app installable.

**Fallbacks:** `<input type="file" webkitdirectory multiple>` gives a flat `FileList` with `webkitRelativePath`, so the card folder tree can be reconstructed; folder drag-drop via `webkitGetAsEntry()` works in Safari and Firefox too. Use `browser-fs-access@0.38.0` to hide the difference.

## 5. Compute

WASM SIMD: Chrome 91+, Firefox 89+, Safari 16.4+ (~95% global). Workers: universal. SharedArrayBuffer: everywhere, but needs COOP+COEP. WebGPU: Chrome 113+, Safari 26+ partial, **Firefox disabled by default** (~86% global).

**FFT:** `pffft.wasm` is the best-quality WASM option but is GitHub-only. `webfft@1.0.3` benchmarks several backends at runtime and picks the fastest. Notably, PFFFT's own author measured pure-JS `fft.js` on Chrome as ~2× faster than his WASM builds — V8 is very good at this, so do not dismiss plain JavaScript. `sync-core` currently ships its own ~100-line radix-2 FFT, which is fast enough at these transform sizes.

**WebGPU FFT: no production library exists.** VkFFT has no WebGPU backend. Hand-writing a Stockham WGSL kernel is a project, not a dependency, and with Firefox's WebGPU off by default it can never be the only path. Don't.

**Throughput anchor** (measured with NumPy on one core, then extrapolated — *these are estimates, not browser benchmarks*): two 2-hour streams decimated to 4 kHz, full brute-force cross-correlation at FFT size 2²⁶ took 17.6 s natively, so roughly 30–45 s single-threaded in WASM, or a few seconds across a 4-core worker pool with block-wise overlap-save.

But brute force is the wrong algorithm — decimate hard, go coarse-to-fine, use timecode first, and use GCC-PHAT rather than raw correlation. **The real bottleneck is decode, not correlation.**

## 6. Timecode

**No JS library reads `tmcd`.** Verified: `mp4box.js` 2.4.1 and `mediabunny` 1.55.5 both contain zero `tmcd`/`tcmi` handling. Write it: find the track whose `hdlr` type is `'tmcd'`, read `timeScale`/`frameDuration`/`numberOfFrames` and the drop-frame flag from its `stsd` sample entry, then read the track's single big-endian `uint32` sample — the start frame number.

**BWF:** `bext.TimeReference` (u64, split low/high) is the start sample since midnight; divide by the sample rate. Frame rate comes from iXML `<SPEED><TIMECODE_RATE>` and `<TIMECODE_FLAG>`. **Watch out:** iXML `<TIMECODE_SAMPLE_RATE>` can differ from `<FILE_SAMPLE_RATE>` on pull-up/pull-down recordings; using the wrong one produces an offset that drifts, which is the classic hard-to-diagnose sync bug.

**Arithmetic:** `timecode-boss@7.0.1` — TypeScript, actively maintained, drop-frame correct.

## 7. Export libraries

All four text formats are easier to hand-write than to adopt a library for; see [`04-export-formats.md`](04-export-formats.md). `edl-genius@5.0.0` parses CMX3600 if reading is ever needed. `opentimelineio@0.1.0` (otio.js) exists and is browser-friendly, though OTIO's JSON schema is simple enough to emit directly. **No JS/TS AAF library exists at all.** Use `fast-xml-parser@5.11.1` for XML emission, or template literals with a proper escaper.

## 8. Packaging

Tauri v2 uses the *system* webview — WKWebView on macOS, WebKitGTK on Linux — which is precisely the property you do not want when the feature set sits on WebCodecs and File System Access. **FSA is absent on macOS and Linux under Tauri.** Electron bundles Chromium, so codec and file-API behaviour is identical everywhere; the ~100 MB download is irrelevant for an app that ingests 200 GB cards.

**Recommended sequencing:** ship the web app first, gated to Chromium with a clear notice and a working `webkitdirectory` fallback, then add Electron for users who want persistent library management. Same codebase, one preload shim.

---

## Sources

- [caniuse: WebCodecs](https://caniuse.com/webcodecs) · [MDN: VideoDecoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder) · [MDN: WebCodecs codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection) · [W3C WebCodecs Codec Registry](https://www.w3.org/TR/webcodecs-codec-registry/)
- [WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) · [Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)
- [WebCodecs Fundamentals — codec analysis 2026](https://webcodecsfundamentals.org/datasets/codec-analysis-2026/)
- [Mediabunny](https://mediabunny.dev/) · [supported formats](https://mediabunny.dev/guide/supported-formats-and-codecs)
- [TurboRes](https://github.com/Vanilagy/turbores) · [mxf.js](https://www.npmjs.com/package/mxf.js) · [mp4box.js](https://github.com/gpac/mp4box.js/) · [wavefile](https://github.com/rochars/wavefile)
- [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) · [libav.js](https://github.com/Yahweasel/libav.js)
- [caniuse: File System Access](https://caniuse.com/native-filesystem-api) · [caniuse: OPFS](https://caniuse.com/mdn-api_storagemanager_getdirectory) · [caniuse: webkitdirectory](https://caniuse.com/input-file-directory) · [Chrome: persistent FSA permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [caniuse: WASM SIMD](https://caniuse.com/wasm-simd) · [caniuse: WebGPU](https://caniuse.com/webgpu) · [pffft.wasm](https://github.com/JorenSix/pffft.wasm) and [its benchmark writeup](https://0110.be/posts/pffft.wasm:_an_FFT_library_for_the_web) · [WebFFT](https://github.com/IQEngine/WebFFT) · [VkFFT](https://github.com/DTolm/VkFFT)
- [Apple: FCPXML Reference](https://developer.apple.com/documentation/professional-video-applications/fcpxml-reference) · [fcp.cafe FCPXML resources](https://fcp.cafe/developers/fcpxml/) · [otio.js](https://github.com/fifteen42/otio.js) · [timecode-boss](https://github.com/bradcordeiro/timecode-boss)
- [Tauri](https://github.com/tauri-apps/tauri) · [Electron issue #41957 — FSA persistent permissions](https://github.com/electron/electron/issues/41957)

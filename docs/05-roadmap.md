# Roadmap

Six phases. Each ends with something demonstrably working, because a sync tool that is 80% built is worth nothing and a sync tool that handles one narrow case correctly is worth using.

Effort figures assume one developer working with AI assistance. They are honest estimates, not commitments.

---

## Phase 0 — Sync core ✅ **done**

The algorithm, proven before any UI exists. If this had turned out not to work, nothing else would have mattered.

- GCC-PHAT with parabolic sub-sample interpolation
- Anti-aliased decimation, log-energy envelope extraction
- Coarse-to-fine alignment with three candidate generators (timecode, waveform, envelope)
- Two-measure confidence: peak-to-sidelobe ratio and envelope correlation
- Drift estimation by windowed regression, with R² gating
- Whole-project solve as a maximum-confidence spanning forest, with transitivity and consistency checking
- 22 tests including degraded-scratch-audio recovery, false-positive rejection, and known-ppm drift recovery

**Acceptance:** a clean recorder feed syncs to a camera mic 26 dB down, band-limited and reverberant, to within 1 ms; unrelated material is rejected rather than placed. ✅

---

## Phase 1 — Ingest and prove it on real rushes · ~2 weeks

The point where synthetic confidence meets real cameras.

- `media-io`: `mediabunny` probe/demux, WebCodecs audio decode, PCM software path, mono downmix, decimation, envelope
- Worker pool, one per core
- OPFS analysis cache keyed by file identity
- File System Access with `webkitdirectory` fallback
- CLI harness (Node) to run the engine over a folder and print a report — the fastest way to test against real media without any UI

**Acceptance:** point it at a real multicam folder — at least three cameras and one recorder, mixed formats — and get correct offsets, verified by ear against a known-good sync.

**Test corpus is the real cost here.** Getting sample files from each camera and recorder brand is more work than the code. Start collecting on day one: Canon C-series MOV, Sony XAVC MXF, Panasonic MTS, iPhone HEVC, a Zoom H-series WAV, a Sound Devices poly-WAV with iXML, a Tascam BWF.

---

## Phase 2 — Minimum viable app · ~3 weeks

The point where someone other than the developer can use it.

- Drag-and-drop ingest with automatic device grouping
- Timeline: one track per device, canvas waveforms, pan/zoom, vertical waveform scale
- Sync button, progress, results with green/red status and a quality number
- FCP7 XML export (Premiere / Resolve) and EDL export
- Save/load project

**Acceptance:** a real editor syncs a real shoot day and cuts from the result in Premiere, without the developer in the room.

---

## Phase 3 — Parity and control · ~4 weeks

Everything PluralEyes did, plus the controls version 4 took away.

- Playback: WebCodecs video preview, Web Audio monitoring, mute/solo, transport, frame stepping, jump to next unsynced clip
- 2-up waveform comparison
- Manual nudge, drag-to-anchor, clip locking, re-sync from a manual position
- Accuracy tiers (Fast / Standard / Exhaustive) — the restored "Try really hard"
- Preserve-clip-order toggle — the restored control whose removal was PluralEyes 4's most-complained-about regression
- Timecode: `tmcd`, `bext` + iXML, MXF System Item; per-channel names from `<TRACK_LIST>`
- FCPXML export with multicam and compound-clip variants, DTD-validated before writing
- Spanned clip handling (AVCHD, XDCAM BPAV, P2 Contents)
- OTIO export
- Drift display and optional correction on export

**Acceptance:** run the [feature parity matrix](01-feature-parity.md) end to end and tick every "parity" row.

---

## Phase 4 — Scale and hardening · ~3 weeks

- Pair-discovery gates: timecode, recording-time bracketing, envelope prefilter
- Fingerprint index for `O(n)` pair discovery
- ProRes via `turbores`, MXF via `mxf.js`, lazy `libav.js` fallback
- Sidecar-WAV workflow for R3D and other out-of-reach formats
- Near-identical-take detection and take grouping
- Long-silence detection and clip splitting
- Round-trip *in* from FCP7 XML and FCPXML

**Acceptance:** 200 clips across 6 hours of material solved in under 10 minutes on a laptop, with correct unsynced reporting.

---

## Phase 5 — Ship it · ~2 weeks

- Electron build with native file access and watching
- PWA install, persistent folder permissions
- Onboarding, empty states, error messages that say what to do next
- Docs, sample project, a two-minute demo video

---

## Deliberately not on this roadmap

- **AAF export** — [reasons](04-export-formats.md#5-aaf--not-doing-it)
- **A Premiere panel extension** — separate build, separate toolchain; sequence XML round-trip covers the workflow
- **Cloud anything** — the local-first property is the product, not a limitation
- **Video editing** — this syncs and hands off. Scope discipline is what lets it be excellent at one thing

## Sequencing note

Phase 1's real risk is not the code, it is the test corpus. Everything after Phase 0 is bounded, known work; Phase 1 is where reality intrudes, and it intrudes in the form of some camera writing an atom nobody expected. Budget for that, and start collecting sample files before writing the ingest code.

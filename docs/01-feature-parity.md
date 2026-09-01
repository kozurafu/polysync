# Feature parity target

The reference is **PluralEyes 4.1.12 / "2023.0.0"**, the last release, plus the v3.5 features that v4 removed and users never stopped asking for. Full evidence in [`00-pluraleyes-research.md`](00-pluraleyes-research.md).

Three columns: what PluralEyes did, what Polysync does, and why where they differ.

---

## 1. Ingest

| PluralEyes | Polysync | Notes |
|---|---|---|
| Drag folders or files onto the window | Same, plus directory picker | `showDirectoryPicker()` on Chromium; `<input webkitdirectory>` and folder drag-drop everywhere else |
| **Smart Start** — auto-detect each device from folder structure and metadata, one track per device | **Parity, extended** | Group by: camera-card structure (AVCHD/P2/XDCAM/CanonXF/DCIM), then filename prefix pattern, then container metadata (`©mak`/`©mod` atoms, MXF source package), then extension class. Every grouping is user-overridable — PluralEyes' was not |
| Spanned clips (AVCHD MTS, XDCAM BPAV, P2 Contents) treated as one continuous clip | **Parity** | Requires the card structure to be preserved, same as PluralEyes. Detect and warn when a user has dropped loose files out of their card folder |
| Recommended ceiling ~50 clips / ~30 min per project | **Beat it** | Target 200+ clips, several hours, in one pass. See the complexity notes in [`03-sync-engine.md`](03-sync-engine.md) |
| Video formats: MOV, MP4, MPEG, M2T(S), MTS, MXF, R3D, AVI, WMV | **Partial at launch** | H.264/HEVC/AAC/PCM in MP4/MOV/WAV is the guaranteed path. ProRes via `turbores`. MXF via `mxf.js` (Chromium only). R3D and DNxHD/DNxHR are out of reach in a browser — see the fallback ladder in [`02-architecture.md`](02-architecture.md) |
| Audio: WAV, AIFF, MP3, M4A, AAC, AC-3, WMA | **Parity for the ones that matter** | WAV/BWF (incl. RF64 >4 GB), AIFF, MP3, AAC, FLAC. AC-3/WMA deferred — nobody records dialogue to them |
| No timecode required, ever | **Parity** | Audio-only sync is the core. Timecode is used as a *seed and cross-check* where present, never a requirement |
| — | **New: reads embedded timecode** | `tmcd` track from MOV/MP4, `bext.TimeReference` + iXML from BWF, MXF System Item TC. Turns a 2-minute correlation into a 200 ms verification when the shoot was jam-synced |
| — | **New: per-channel names from iXML `<TRACK_LIST>`** | Show "Boom / Lav1 / Lav2" instead of "ch1/ch2/ch3". Sound Devices and Zaxcom write it; use it |

## 2. Sync

| PluralEyes | Polysync | Notes |
|---|---|---|
| One-button automatic sync | **Parity** | `Synchronize` does the whole project with no configuration |
| Automatic drift correction, toggleable (v3.5+) | **Parity, and shown** | We *measure* ppm per pair and display it, rather than silently retiming. The user chooses: leave it, correct on export, or flag it |
| Green/red synced/unsynced colouring | **Parity, with a real number** | Plus a 0–1 match quality per clip and the peak-to-sidelobe ratio behind it |
| Jump to next/previous unsynced clip (Shift+↓/↑) | **Parity** | Same shortcuts |
| **"Allow sync to change clip order"** — removed in v4 | **Restored, on by default** | This is PluralEyes 4's single most-complained-about regression. Clip order within a track is preserved unless you explicitly allow reordering |
| **"Try really hard"** — removed in v4 | **Restored as accuracy tiers** | Fast / Standard / Exhaustive. Exhaustive widens the search, drops the acceptance thresholds, and adds a second envelope-only pass |
| **"Level audio"** — removed in v4 | **Obsolete, not restored** | The engine normalises RMS and uses PHAT weighting, which makes it level-invariant by construction. Nothing for the user to toggle |
| **"Takes"** (music video, many near-identical takes) — removed in v4 | **Restored, differently** | Near-identical takes are exactly what breaks correlation: every take matches every other take. We detect the ambiguity (multiple correlation peaks of similar height), refuse to guess, and offer take-grouping by recording time or filename |
| Clip locators / marker hints — removed in v4 | **Restored as manual anchors** | Drag a clip to roughly the right place and re-sync: the manual position becomes a constrained search window |
| No in-app manual nudge — "do it in your NLE" | **Fixed** | Nudge by frame or sample, scrub two waveforms against each other, lock a clip so re-sync won't move it. The refusal to offer this was a genuine gap |
| No confidence score exposed | **Fixed** | Quality is surfaced per clip and per edge |
| — | **New: transitive solving** | Camera C never overlaps the recorder but does overlap camera B, so C lands correctly via B. Solved as a maximum-confidence spanning forest, not pairwise |
| — | **New: consistency checking** | Redundant matches are independent measurements of distances the solve already fixed. Where they disagree, say so and name the clips. PluralEyes could place a clip confidently and wrongly with no warning |

## 3. Review

| PluralEyes | Polysync | Notes |
|---|---|---|
| Timeline, one track per device, clips with waveforms | **Parity** | Canvas-rendered waveforms, pan/zoom |
| Player/monitor, transport, frame stepping | **Parity** | WebCodecs `VideoDecoder` for the picture; audio through Web Audio |
| Mute / solo / monitor volume per track | **Parity** | |
| Waveform vertical scale (`[` / `]`) | **Parity** | |
| 2-up comparison view (v3, dropped in v4) | **Restored** | Two waveforms overlaid at the solved offset is the fastest way for a human to confirm a sync |
| Shift+hover thumbnail | **Parity** | |
| Premiere-matching keyboard shortcuts | **Parity** | Full map in the research doc, §2.7 |

## 4. Export

| PluralEyes | Polysync | Notes |
|---|---|---|
| Premiere Pro XML (FCP7 XMEML v5) | **Parity** | Including the `_synced` / `_replaced` sequence pair |
| Only the topmost overlapping audio track used on Premiere export | **Fixed** | A real limitation for multi-recorder shoots. We map every audio source |
| Unsynced clips coloured in Premiere via label colours | **Parity, with the caveat documented** | Premiere's "Display the project item name and label color for all instances" setting silently defeats this. We say so in the UI rather than letting the user wonder |
| FCPXML, incl. multicam clip creation and compound clips for replaced audio | **Parity** | Target FCPXML 1.9/1.10 — older imports into newer FCP, not the reverse |
| DaVinci Resolve XML (4.1.11+), with "move unsynced to end" | **Parity** | Resolve takes FCP7 XML; the unsynced-to-end behaviour falls out of the graph solve for free |
| Vegas Pro (bidirectional, Vegas-anchored only) | **Dropped** | Requires a Vegas extension host. Vegas reads FCP7 XML |
| Avid AAF (v3 only, removed in v4) | **Dropped, deliberately** | AAF is Microsoft CFB plus the AAF object model; no JS implementation exists and Media Composer's importer is unforgiving. Weeks of work for a format PluralEyes itself abandoned. Revisit only on real demand, and then server-side with `pyaaf2` |
| EDL — never supported in any version | **New** | CMX3600. ~80 lines, and it is the universal fallback for EDIUS, Lightworks, and anything else |
| New media files: trimmed audio, or video with audio replaced | **Deferred to Phase 4** | Needs an encoder, not just a decoder. Real but not the core |
| — | **New: OpenTimelineIO** | Emitting OTIO JSON costs almost nothing and future-proofs the round trip |
| Premiere Pro panel extension | **Deferred** | A CEP/UXP panel is a separate build. Sequence-XML round-trip in and out covers the same workflow |

## 5. What we deliberately do *not* do

- **No cloud, no account, no upload.** Everything runs in the browser on the user's own machine.
- **No re-encoding by default.** Exports reference original media, as PluralEyes' did.
- **No AAF.** Documented above.
- **No R3D / DNxHD / ARRIRAW decode in the browser.** These need a native fallback path.
- **No pretending.** Where a sync is uncertain the tool says so, rather than placing a clip and hoping.

## 6. Round-trip *in* from an NLE

PluralEyes could start from an exported sequence (FCPX XML, Premiere XML, Resolve FCP7 XML v5, or a Vegas project) rather than raw media. Worth keeping — it is how people sync material already conformed into bins.

Phase 3. Parse FCP7 XML and FCPXML on import, take the clip list and track assignment from it, sync, and emit the same shape back. Note PluralEyes' documented failure here: round-tripping *from* FCPX with audio filters, keywords or in/out points applied produced XML it re-emitted invalidly, giving the notorious "DTD Validation Failed". Validate our own output against the DTD before writing it, and refuse to emit an invalid file.

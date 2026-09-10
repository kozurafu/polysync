# Build plan

The other documents in `docs/` establish *what* to build and *why*. This one is the plan to actually build it: the work broken down to the level of files and functions, the UI specified rather than gestured at, the data model written down, and the decisions that are still open flagged as decisions rather than left implicit.

Read [`05-roadmap.md`](05-roadmap.md) first for the phase shape. This expands it.

---

## 0. Verified starting position

Not "the README says". This was run:

```
npm install && npm test
→ 5 files, 41 tests, all passing, 9.7s
```

| Package | Actual state |
|---|---|
| `sync-core` | **Complete and proven.** 1,014 lines, zero dependencies. FFT, DSP, GCC-PHAT, drift regression, spanning-forest solve. 22 of the 41 tests, including degraded-scratch recovery, false-positive rejection, transitive placement and known-ppm drift recovery |
| `exporters` | **Working** for FCP7 XML and CMX3600 EDL, 19 tests. FCPXML and OTIO not written |
| `timecode` | **Not a stub** — SMPTE arithmetic including drop-frame is complete and correct. What is missing is the *parsers*: `tmcd`, `bext`, iXML. (The README's status table understates this) |
| `media-io` | Stub. Interfaces declared, every function throws `not implemented — Phase 1` |
| `apps/web` | Empty but for a README |

So the hard, risky, mathematical part is done and tested. What remains is engineering with known unknowns — which is a good position to be in, and the reverse of how most projects at this stage are actually shaped.

**The critical path from here is `media-io`.** Nothing else can be demonstrated to anyone until real files can be read.

---

## 1. Market check, September 2026

[`00-pluraleyes-research.md`](00-pluraleyes-research.md) §8 surveyed the field. One material thing has changed since, and it changes the business decision rather than the technical one.

| Tool | Price | Shape |
|---|---|---|
| **WaveXML** | **Free** (full-featured public beta, launched ~16 Aug 2026) | Mac **and Windows**. NLE-anchored: export FCP7 XML / FCPXML from Resolve, Premiere or FCP → match recorder to cameras → export XML back |
| CamHeard | $129 once, or $14.99/mo; free to 20 clips | One-button, offline, whole shoot day |
| Syncaila | $249 full, $125 for a 3-track limit | Standalone, XML/AAF round-trip, 4 accuracy tiers, explicit chronology control |
| Premiere / Resolve / FCP built-ins | Free with the NLE | Pairwise or small-batch; the failure modes in the README |

**What follows from WaveXML existing.** A free, cross-platform, actively developed PluralEyes-shaped tool appeared last month. Any plan whose justification was "the alternatives cost $129–$249" needs re-examining, and a paid-product plan needs a sharper answer than "it syncs audio".

**What does not follow.** WaveXML is NLE-anchored — it starts from an exported sequence, which is the *round-trip* workflow, not the drop-a-card-folder-in workflow. It is a beta from a single author with no stated pricing after beta. And none of the four rows above do the things this project's README claims as differentiators:

1. **Whole-day solving with transitive placement** — camera C reaching the timeline via camera B when it never overlaps the recorder at all.
2. **Drift measured and shown in ppm**, rather than silently retimed or not handled.
3. **Consistency checking** — redundant matches are independent measurements; where they disagree, say so and name the clips. This is the one genuinely novel thing here, and it is the failure PluralEyes could not catch: a confident, wrong placement.
4. **Local-first with no upload and no account** — worth real money to anyone handling client material under NDA, and a property, not a limitation.

Those four are the product. "Syncs audio" is table stakes and always was. Treat the differentiators as the acceptance criteria for whether this is worth finishing, and re-check the field before Phase 5 rather than before Phase 1 — a beta from August may or may not still be free in six months.

*Sources for this section: [Newsshooter on WaveXML](https://www.newsshooter.com/2026/08/16/wavexml-auto-sync-for-cameras-audio/), [wavexml.com](https://wavexml.com/), [CamHeard](https://camheard.com/), [CamHeard's own comparison](https://camheard.com/pluraleyes-alternative), [Syncaila](https://syncaila.com/download).*

---

## 2. Phase 1 — ingest · ~2 weeks

**Goal:** point the engine at a real multicam folder and get correct offsets. No UI.

### 2.1 Work breakdown

| # | File | What it does | State |
|---|---|---|---|
| 1.1 | `media-io/src/ingest.ts` | `mediabunny` `Input` over `BlobSource`. Duration, tracks, sample rate, channels, codec, dimensions, frame rate. Never reads more than headers | **Done** |
| 1.2 | `timecode/src/tmcd.ts` | Walk MOV/MP4 atoms for the `hdlr`-type-`tmcd` track; read `timeScale`, `frameDuration`, `numberOfFrames`, drop-frame flag from `stsd`; read the single big-endian `uint32` sample. **No library does this** — verified absent from both mp4box.js and mediabunny | **Done** |
| 1.3 | `timecode/src/bwf.ts` | Walk RIFF chunks in the first ~1 MB via `file.slice()`. `bext.TimeReference` (u64, low/high split) ÷ sample rate. iXML `<SPEED><TIMECODE_RATE>`, `<TIMECODE_FLAG>`, and `<TRACK_LIST>` channel names | **Done** |
| 1.4 | `media-io/src/container.ts` | Rung ladder: mediabunny software PCM → WebCodecs `AudioDecoder` (always gate on `isConfigSupported()`) → lazy `libav.js`. Emits interleaved `Float32Array` blocks | **Done** for PCM; compressed audio needs WebCodecs |
| 1.5 | `media-io/src/derive.ts` | Mono downmix, anti-aliased decimation to 2 kHz, 100 Hz log-energy envelope. **Reuse `sync-core/dsp.ts` — do not reimplement** | **Done** |
| 1.6 | `media-io/src/cache.ts` | OPFS store keyed by `(name, size, lastModified)`. Writes decimation + envelope + probe metadata. LRU eviction | Not started |
| 1.7 | `media-io/src/pool.ts` | Worker pool, `min(hardwareConcurrency - 1, 8)`. Transferable buffers, per-file progress, cancellation | Not started |
| 1.8 | `media-io/src/group.ts` | Device grouping, in precedence order: card structure (AVCHD / P2 `Contents` / XDCAM `BPAV` / CanonXF / DCIM) → **top-level folder** → filename reel (Canon `A001C002` splits to reel `A001`) → container metadata → picture-vs-sound. **Every decision carries the basis it was made on**, so the UI can show why and let the user change it — PluralEyes' grouping was not overridable, and that is a documented complaint | **Done** |
| 1.9 | `tools/cli.ts` | Node harness: point at a folder, print a report of offsets, quality, drift, unsynced, inconsistencies. **Build this first, use it throughout** | **Done** |

**Where it stands.** Seven of the nine are written and tested. Four files not
on the original list turned out to be needed: `source.ts` (the `ByteSource`
interface every parser reads through, which is what lets the CLI and the browser
run identical code), `wav.ts`, `iso.ts` and `identity.ts`. 102 tests pass. What
is left in this phase is the OPFS analysis cache and the worker pool — both
browser-side, and neither needed by the CLI.

**One deliberate deviation from the plan above.** A *top-level folder* strategy
was inserted between card structure and filename prefix. The plan did not have
one, but dropping a folder of `CAM_A/`, `CAM_B/`, `REC/` is how people actually
organise a shoot, and on that layout filename prefixes are noise. Card structure
still wins where it exists.

### 2.2 Why the CLI harness comes first

It is the fastest way to test against real media, it needs no UI decisions to be made, it becomes the regression harness in §5, and it is the only way to work on ingest without also working on React. Node lacks `AudioDecoder`, so the CLI runs the PCM path plus a `libav.js` fallback — which is fine, because WAV from a recorder is the reference track for most real jobs.

### 2.3 Acceptance

Point it at a folder with at least three cameras and one recorder, mixed formats. Offsets correct, verified by ear against a known-good sync. Runs from a cold cache and from a warm one, and the warm run is at least 20× faster.

### 2.4 The real risk here is not code

It is the test corpus. See §5. **Start collecting files before writing 1.1.**

---

## 3. Phase 2 — minimum viable app · ~3 weeks

**Goal:** someone who is not the developer syncs a real shoot day and cuts from the result.

### 3.1 Screen

One window, no wizard. PluralEyes 4 replaced v3's timeline-editor with a three-tab Add → Sync → Export flow and the reviews called it dumbing down; the tabs are also why the removed controls had nowhere to live. So: the timeline is always visible, and the three stages are states of one screen rather than three screens.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Polysync   [project name]        [Add media] [Synchronize] [Export ▾]  │  toolbar
├──────────────┬─────────────────────────────────────────────────────────┤
│              │                                                          │
│  Devices     │   Viewer (Phase 3; a placeholder in Phase 2)             │
│              │                                                          │
│  ▸ CAM_A  4  │                                                          │
│  ▸ CAM_B  4  │                                                          │
│  ▸ CAM_C  3  ├──────────────────────────────────────────────────────────┤
│  ▸ REC    2  │  Timeline — one track per device                         │
│              │                                                          │
│  Unsynced 2  │  CAM_A  ▇▇▇▇▇▇▇▇      ▇▇▇▇▇▇▇▇▇▇▇                        │
│    ● B_004   │  CAM_B     ▇▇▇▇▇▇▇▇▇▇▇▇▇     ▇▇▇▇▇▇▇                     │
│    ● C_002   │  CAM_C  ▇▇▇▇▇▇▇   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇                        │
│              │  REC    ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇             │
│              │                                                          │
├──────────────┴──────────────────────────────────────────────────────────┤
│ Inspector — selected clip: name · device · TC · quality 0.94 · +12 ppm  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Rules for the timeline.** Canvas, not DOM — 200 clips of waveform is not a DOM problem. Render from a mip pyramid of min/max pairs built once per clip at ingest, so zooming never re-reads audio. One track per device, video and its own audio bundled as a single clip exactly as PluralEyes did (this is a sync tool, not an NLE, and splitting A from V here helps nobody). Pan with drag or scroll, zoom to cursor, `\` fits, `[` and `]` scale waveform height.

**Rules for status.** Green synced, red unsynced — the scheme every PluralEyes user already knows. But the number goes next to it: quality 0–1 per clip, and PSR behind it in the inspector. PluralEyes exposed no confidence at all, which is exactly why nobody could tell a good sync from a lucky one.

### 3.2 Work breakdown

| # | Area | Notes |
|---|---|---|
| 2.1 | App shell, routing-free single view, project state store | Zustand or equivalent. State shape in §4 |
| 2.2 | Ingest UI: drag-drop, directory picker, `webkitdirectory` fallback | `browser-fs-access` to hide the API gap |
| 2.3 | Device grouping panel, drag a clip between devices to override | The override is the point |
| 2.4 | Canvas timeline: waveform mips, pan/zoom, selection | The largest single item in this phase |
| 2.5 | Sync run: worker orchestration, progress, cancel | `sync-core` already emits progress |
| 2.6 | Results: colouring, quality readout, unsynced list, inconsistency warnings | Inconsistencies get a visible banner, not a log line |
| 2.7 | Export dialog → existing FCP7 XML and EDL writers | Writers exist; this is wiring plus a file-save |
| 2.8 | Save / load `.polysync` project | §4 |

### 3.3 Acceptance

A real editor syncs a real shoot day and cuts from the result in Premiere, without the developer in the room. That last clause is the whole test.

---

## 4. Project data model

Written down now because Phase 2 persists it and Phase 3 migrates it. JSON in OPFS, exportable as a `.polysync` file.

```jsonc
{
  "formatVersion": 1,
  "name": "Shoot day 1",
  "createdAt": "2026-09-02T09:00:00Z",
  "rate": { "nominal": 25, "ntsc": false, "dropFrame": false },

  "devices": [
    { "id": "CAM_A", "label": "Canon C70", "muted": false, "volume": 1,
      "source": "card-structure" }        // how it was grouped; user override = "manual"
  ],

  "clips": [
    { "id": "c1",
      "deviceId": "CAM_A",
      "name": "A001C002.MOV",
      "relativePath": "CAM_A/CLIPS/A001C002.MOV",   // for relink
      "identity": { "size": 2847362048, "lastModified": 1788000000000 },
      "durationSeconds": 612.44,
      "hasVideo": true, "audioChannels": 2, "frameRate": 25,
      "timecodeSeconds": 39122.16,
      "recordedAtSeconds": 1787999000,
      "channelNames": ["Boom", "Lav1"] }
  ],

  "solve": {
    "placements": [ /* Placement[] from sync-core, verbatim */ ],
    "pairs":      [ /* PairAlignment[] — kept so the UI can explain any edge */ ],
    "unsyncedClipIds": ["c9"],
    "inconsistencies": [ { "aId": "c3", "bId": "c7", "errorSeconds": 0.043 } ]
  },

  "overrides": {
    "locked":  ["c4"],                       // re-sync will not move these
    "manual":  { "c9": { "startSeconds": 128.5 } },   // nudge or drag-to-anchor
    "anchors": { "c9": { "nearSeconds": 130, "windowSeconds": 5 } }
  },

  "settings": {
    "accuracy": "standard",                  // fast | standard | exhaustive
    "preserveClipOrder": true,               // the restored v3 toggle, ON by default
    "driftCorrectionOnExport": false,
    "minOverlapSeconds": 3
  }
}
```

**Three deliberate choices.**

*Files are identified by `(relativePath, size, lastModified)`, never by absolute path.* Safari and Firefox cannot persist a directory handle, so re-opening a project means the folder is re-dropped and the clips relink by identity. Every NLE already has this flow and users understand it. It also means a project moved between machines relinks rather than breaks.

*The solve is stored verbatim, pairs included.* Keeping every accepted edge — not just the spanning tree — is what lets the UI answer "why is this clip here?" with "because it matched REC_02 at 0.94". That question is unanswerable in every tool in §1.

*Overrides are a separate object from the solve.* Re-syncing replaces `solve` and leaves `overrides` untouched. A user who has locked four clips and nudged two must not lose that by pressing Synchronize again — and losing it is precisely the class of thing that made PluralEyes 4 frustrating.

---

## 5. Test corpus — the actual highest risk

[`07-risks.md`](07-risks.md) ranks this second and it deserves first. The engine is proven against synthetic signals that model the right degradations. It has never met a camera that writes something unexpected into a `udta` atom, or a recorder whose `bext` chunk disagrees with its own iXML.

**Minimum viable corpus.** Two files per device, one short and one over ten minutes:

| Source | Why it is on the list |
|---|---|
| Canon C-series MOV | Common owner-operator camera; vendor `udta` atoms |
| Sony XAVC (MP4 **and** MXF) | The MXF path is the one depending on a v0.1.0 single-author package |
| Panasonic AVCHD MTS on an intact card | Spanned clips; the whole `PRIVATE/AVCHD` tree, not loose files |
| iPhone HEVC | Ubiquitous B-camera; tests the HEVC gate on non-Safari |
| Zoom H-series WAV | The commonest reference recorder |
| Sound Devices poly-WAV with iXML | Multi-channel, `<TRACK_LIST>` names, `bext` timecode |
| Tascam BWF | A second, differently-written `bext` to disagree with the first |
| One genuinely awful handheld recording | Reverberant, distant, clipped. The case the tool exists for |
| One >4 GB WAV (RF64) | The `ds64` path; long-form recording |
| One jam-synced pair | Verifies timecode seeding against a known-good answer |

**How to get them.** Camera manufacturers publish sample clips; Sony, Panasonic and Canon all host them. Filmmaker forums and `filmplusgear`-style sample archives cover the rest. For the recorder side, borrowing hardware for an afternoon and recording a deliberately awkward test — one clap, then five minutes of overlapping speech at varying distances, all devices rolling, one started late, one stopped early — produces a better corpus than any download, and gives ground-truth offsets from the clap.

**The harness.** `tools/corpus.test.ts`: each fixture folder carries an `expected.json` of known offsets; the test asserts every offset to within 20 ms and every unsynced clip is the one that should be. This runs in CI from Phase 1 onward. Store the JSON in the repo and the media outside it (git-lfs or a plain synced folder — media does not belong in git).

**Budget two weeks of calendar time for acquisition, overlapping Phases 1 and 2.** It is not two weeks of work; it is two weeks of waiting for people to send you files.

---

## 6. Phase 3 — parity and control · ~4 weeks

This is where the parity matrix gets ticked. Ordered by user value, not by ease:

1. **Manual control first** — nudge by frame or sample, drag-to-anchor and re-sync within a constrained window, clip locking. PluralEyes' documented answer here was "do it in your NLE", which was a genuine gap and the cheapest thing on this list to beat.
2. **Accuracy tiers** — Fast / Standard / Exhaustive. Exhaustive widens the search window, lowers the acceptance thresholds and adds an envelope-only second pass. This is the restored "Try really hard".
3. **Preserve clip order**, on by default. The single most-complained-about v4 regression. Implemented as a constraint in the graph solve: within a device, a clip may not be placed before its predecessor unless the toggle is off.
4. **Playback and 2-up comparison** — WebCodecs `VideoDecoder` for picture, Web Audio for monitoring, mute/solo/volume per track, transport, frame stepping, Shift+↓/↑ to the next unsynced clip. Two waveforms overlaid at the solved offset is the fastest way a human confirms a sync, and v4 dropped it.
5. **Timecode parsers wired through** — the Phase 1 parsers now feed the UI and the exporters.
6. **FCPXML export**, DTD-validated before writing. PluralEyes' notorious "DTD Validation Failed" came from emitting invalid XML; refuse to write an invalid file rather than shipping one.
7. **Spanned clips** — AVCHD, XDCAM BPAV, P2 Contents. Warn when a user has dropped loose files out of their card folder, because that is the common cause of the span not being recognised.
8. **OTIO export**, and drift display with optional correction on export.

## 7. Phase 4 — scale · ~3 weeks · Phase 5 — ship · ~2 weeks

As [`05-roadmap.md`](05-roadmap.md) has them, with one change: **the pair-discovery gates were moved forward into Phase 1 and are built.** What they actually bought is below, and it is less than this document originally claimed.

### 7.1 The gates, measured

Both are implemented in `sync-core/src/gates.ts`, and both are safe: `tools/bench.ts` and the test suite assert that the same clips sync, and the same edges are accepted, with the gates on and off. That property is non-negotiable — a wrongly excluded pair is a lost sync the user cannot see, whereas a wasted comparison is only slow.

`npm run bench` on a simulated shoot day — 20 clips, 2 minutes each, four devices across three hours:

| Configuration | Time | Pairs compared |
|---|---|---|
| No gates | 37.6 s | 190 of 190 |
| Envelope bound only | 38.0 s | 190 of 190 |
| Recording time only | 29.9 s | 142 of 190 |
| Both | 29.0 s | 142 of 190 |

**About 1.3×, not the order of magnitude this plan implied.** Two findings behind that, both worth keeping written down:

**The recording-time gate works but is bounded by its own slack.** It rules out the pairs that are genuinely hours apart — a quarter of them here. It cannot do better, because the one-hour slop that makes it safe against wrong clocks and mtime-versus-creation-time ambiguity also lets adjacent scenes through. It also carries a rescue rule: a clip excluded from *every* other clip is treated as having a broken clock rather than as genuinely isolated, and the gate steps aside for it. Without that, one camera set to the wrong timezone would silently never sync.

**The envelope prefilter is exact and useless.** It computes a true upper bound on the quality a pair could be accepted with — the maximum, over every offset, of the envelope correlation the solver actually applies — so a rejection is a proof. It rejected **0 of 190 pairs**. With a three-second minimum overlap there are tens of thousands of candidate lags, and among that many, some short window of any two speech-like recordings correlates above the threshold by chance. What actually separates a true match from a spurious one is the peak-to-sidelobe ratio — unambiguity rather than agreement — and PSR cannot be bounded cheaply. So it now defaults to **off**, kept because it costs 1.3% of a pair, does catch degenerate cases, and `maxEnvelopeCorrelation` is useful on its own.

### 7.2 Where the time actually goes

Profiling one pair of ten-minute clips:

| Stage | Cost |
|---|---|
| **Coarse waveform GCC-PHAT at 2 kHz** | **1,190 ms — 72%** |
| Envelope GCC-PHAT at 100 Hz | 25 ms |
| Everything else (refine, scoring) | ~430 ms |

The full-length correlation at 2 kHz is the solve. Gating around it can only remove whole pairs; it cannot make the pairs that survive any cheaper. So the remaining levers, in order of value:

1. **The worker pool.** Pair alignment is embarrassingly parallel and the pool is already required for the browser app so the UI does not freeze. Four to eight cores is a 4–8× on the dominant cost — far more than either gate, for work that has to happen anyway.
2. **A real-input FFT.** The signals are real and the transform is complex, which wastes about half the work. Roughly 2×, no behaviour change.
3. **The fingerprint index**, still Phase 4. Constellation hashing over envelope peaks turns pair *discovery* into a hash lookup. This is the only thing on the list that changes the O(n²), and it is the answer for a full 200-clip day rather than a test.

Leave the fingerprint index in Phase 4. Do the worker pool as part of the app.

---

## 7.3 What the first real shoot found

A user dropped 70 clips from a single camera — one event, one room, 39 of them
under ten seconds — and the tool matched them to each other and stacked 66 of
the 70 between 80 s and 140 s. 1,618 overlapping pairs out of 2,415, on a track
that can hold one clip at a time. The exported XML was unusable.

Four separate defects, none of which any synthetic fixture would have caught,
because every fixture assumed a shoot with more than one device in it:

1. **Nothing knew that a device records one clip at a time.** Two clips from
   the same camera cannot overlap in time and cannot share a sound, however
   well they correlate — and clips of one room at one event correlate very
   well. Now a gate, and the single most valuable line of code in this
   release.
2. **`preserveClipOrder` was declared and never implemented.** The flagship
   restored-from-v3 control, on by default, doing nothing for three commits.
   It now orders unsynced clips as supplied and reports same-device overlaps
   instead of hiding them.
3. **Grouping had no rule for `C2_4928.MP4`**, so 70 files fell through every
   strategy to the extension-class last resort and were labelled `VIDEO`. A
   single-device project also never reported itself as one.
4. **The app never said "there is nothing to sync here."** Sync compares one
   device against another; with one device every clip comes back unsynced no
   matter what. The user sat through the solve to find that out.

The lesson for the test corpus: the fixtures modelled the degradations we
thought of — level, bandwidth, noise, drift. They did not model *the wrong
shape of project*, which is what a real user actually hands you.

## 7.4 What the second real shoot found

249 files, three cameras and a sound recorder, 6.6 hours of audio. The first
genuinely multi-device project the tool has seen. It produced **nothing**:
666 pairs, 534 correctly skipped as same-device, and all 132 remaining pairs
ruled out on recording time. Zero comparisons. Twenty-nine seconds of solve
that could not have returned an answer whatever the audio contained.

Two defects, and it took both of them to produce a total failure:

1. **`File.lastModified` was being used as recording time.** It is not one. It
   records when the *file* was last written, and re-export, transcode, unzip,
   AirDrop and every cloud sync rewrite it while the recording stays put. On
   this project the recorder files had been through a speech-isolation pass and
   carried that day's date; the camera files had been copied off cards with
   their 2021 timestamps intact. Five years apart, so every cross-device pair
   failed a one-hour window.

   Recording time is now only acted on when the file states it itself —
   `bext` origination, which this project's WAVs carried — and a filesystem
   timestamp is kept, displayed, and never gated on. See
   `AudioClip.recordedAtSource`.

2. **The wrong-clock rescue was asking the wrong question.** It exempted a clip
   excluded from *every other clip*, and each recorder file was still
   time-compatible with its three siblings — which it was never going to be
   compared with anyway, being the same device. So no clip looked isolated, the
   safety net never fired, and an entire device vanished silently. It now counts
   only cross-device candidates, and rescues a whole device that cannot reach
   any other one.

A third defect showed up in the same report without having caused this failure
yet: `Footage/C1/` and `Footage/C2/` both grouped as `FOOTAGE`, because the
directory strategy read only the first path segment. Since a device cannot match
itself, the two cameras most likely to sync in the whole project were the one
pair the engine would never look at. Folder depth is now earned rather than
assumed — a deeper level is taken only when the folder names itself in its files
(`C1/` holding `C1_4676.MP4`) or two siblings hold the same filename, neither of
which a single camera filed by date can do.

Two lessons, and they are not the same one:

- **A gate that fails silently is worse than no gate.** The measured benefit of
  the recording-time gate was 1.3×; the cost of it being wrong was the entire
  product. That is a bad trade at any speedup, and the reason the gate now
  demands evidence before it is allowed to delete work.
- **"Compared zero pairs" is a broken run, not a result.** The report printed
  the three numbers that showed it and left them to be added up. It now says so
  outright.

---

## 8. Decisions that are actually open

These block nothing technically, and all of them change what gets built:

| Decision | Why it matters now | Recommendation |
|---|---|---|
| **Business model** | Determines whether AAF and a Premiere panel stay "no" (they should either way), and whether Phase 5 needs a licence server | Ship free and MIT. WaveXML being free removes the pricing headroom, and the differentiators in §1 are a reputation play, not a $129 play |
| **Name** | "Polysync" is in use elsewhere in unrelated fields | Check the trademark before any public launch, not before Phase 1 |
| **Electron, or web only** | Three weeks of Phase 5 | Web first. Add Electron only if real users ask for persistent library management — and they will ask, or they won't |
| **Safari and Firefox as first-class, or Chromium-gated** | Affects every file-access code path | Chromium-first with an honest banner and a working `webkitdirectory` fallback. Reading large files works identically everywhere; only persistence differs |
| **Round-trip in from NLE XML** | WaveXML is anchored entirely on this workflow, so it is more competitively load-bearing than the roadmap assumed | Keep it in Phase 3 as planned, but treat it as a headline feature rather than a nice-to-have |

## 9. If time runs short

Cut in this order, and stop before the line:

1. OTIO export — costs little, earns little.
2. Video preview — PluralEyes itself showed no preview for MXF, R3D, DVCPRO HD, MJPEG and AIC, and shipped for fifteen years. Waveforms and audio monitoring are enough to confirm a sync.
3. FCPXML — FCP reads FCP7 XML badly but does read it, and Premiere and Resolve are the larger audience.
4. Electron.
5. — **do not cut below this line** —
6. Manual nudge, locking and re-sync from an anchor. Without these the tool is PluralEyes 4, complete with the reason people complained about it.
7. The consistency checker and the exposed quality number. Without them the tool is guessing and not saying so, which is the failure mode the whole design is organised against.

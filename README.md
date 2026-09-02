# Polysync

A browser-based, local-first successor to **PluralEyes** — the audio-waveform multicam sync tool Red Giant / Maxon put into limited maintenance mode in 2023 and stopped supporting on 1 February 2024.

Drop a shoot day's rushes in, get back a synced timeline you can import into Premiere Pro, DaVinci Resolve, Final Cut Pro or anything that eats an EDL. No uploads, no server, no account. Your media never leaves the machine.

---

## Why this exists

Every NLE now ships waveform sync, and for a two-source interview they are fine. They fall over on exactly the jobs PluralEyes was bought for:

- **Scratch audio that barely resembles the reference.** Premiere's sync is documented to need similar *amplitude*, not just similar shape. A camera mic 15 m back in a hall and a lav on the subject share almost no spectral content.
- **Whole-shoot solving.** NLE tools sync pairs or a small selection. PluralEyes took a full day of rushes — several cameras starting and stopping independently, two recorders, spanned cards — and solved the lot in one pass.
- **Clock drift.** Two devices never share a clock. A recorder 20 ppm fast slips ~72 ms over an hour: perfect at the head, visibly out at the tail. Premiere and FCP have no answer at all; Resolve's Elastic Waveform is the only near-equivalent.
- **Telling you what failed.** PluralEyes coloured unsynced clips red and gave you a keyboard shortcut to jump between them. Resolve, by contrast, silently piles clips into "no match".

Polysync targets all four, and adds the thing PluralEyes 4 famously removed: **user control over the sync**.

## Status

| Package | State |
|---|---|
| `packages/sync-core` | **Working.** GCC-PHAT alignment, envelope fallback, drift estimation, whole-project graph solve. Zero dependencies. |
| `packages/exporters` | **Working** for FCP7 XML (Premiere / Resolve) and CMX3600 EDL. FCPXML pending. |
| `packages/timecode` | **Working.** SMPTE arithmetic including drop-frame, QuickTime `tmcd` timecode tracks, and BWF `bext` + iXML (start timecode, frame rate, per-channel names). Zero dependencies. |
| `packages/media-io` | **Working for PCM.** WAV/BWF/RF64 read directly, containers via `mediabunny`, streaming decimation, device grouping, file identity and relinking. Compressed audio needs WebCodecs, so it decodes in a browser but not in Node. OPFS cache and worker pool still to come. |
| `apps/web` | **Working.** React + Vite. Folder drop, parallel decode across a worker pool, solve off the main thread, results with quality and drift, FCP7 XML and EDL export. No waveform timeline editing yet. |
| `tools/` | **Working.** CLI harness, sample-shoot generator, solve benchmark, and a browser smoke test. |

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/00-pluraleyes-research.md`](docs/00-pluraleyes-research.md) | Complete feature inventory of PluralEyes 3/3.5/4/4.1, its failure modes, and the competitive landscape. Every claim sourced. |
| [`docs/01-feature-parity.md`](docs/01-feature-parity.md) | The parity matrix: what we match, what we deliberately drop, what we do better. |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Browser-only architecture, data flow, threading, storage, and the fallback ladder for formats the browser can't touch. |
| [`docs/03-sync-engine.md`](docs/03-sync-engine.md) | How the sync actually works, why each choice was made, and where the accuracy limits are. |
| [`docs/04-export-formats.md`](docs/04-export-formats.md) | What each NLE round-trip has to contain, and the AAF decision. |
| [`docs/05-roadmap.md`](docs/05-roadmap.md) | Phased build plan with milestones and acceptance criteria. |
| [`docs/06-browser-platform.md`](docs/06-browser-platform.md) | Current state of WebCodecs, demuxing, File System Access, WASM compute. The feasibility evidence. |
| [`docs/07-risks.md`](docs/07-risks.md) | What could sink this, and what to do about each. |
| [`docs/08-build-plan.md`](docs/08-build-plan.md) | The executable plan: work broken down to files, the UI specified, the project data model, the test-corpus plan, and the decisions still open. |
| [`docs/09-hosting.md`](docs/09-hosting.md) | Deploying the static site, and what to tell — and ask back from — a tester. |

## Quick start

```bash
npm install
npm test                       # 121 tests across all four packages
npm run typecheck
npm run bench                  # solve time on a simulated shoot day
```

### Run the app

```bash
npm run dev          # http://localhost:5173
npm run build        # static site in apps/web/dist
```

The built site is **entirely static** — no server, no API, nothing is uploaded —
so it can be hosted anywhere: GitHub Pages (a workflow is included), Netlify
(`netlify.toml` is included), Cloudflare Pages, or an S3 bucket. It deliberately
avoids `SharedArrayBuffer`, so it needs no COOP/COEP headers and no special host
configuration.

Use Chrome or Edge for the best experience: they can remember the folder you
picked. Safari 26 and Firefox work too, but you re-pick the folder each session.
Compressed camera audio (AAC) needs WebCodecs; WAV and BWF from any recorder
work everywhere.

### Sync a folder from the command line

The engine is also usable without the UI. Generate a synthetic shoot and solve it:

```bash
npm run sample -- ./sample-shoot   # a recorder, three cameras, one stray file
npm run sync   -- ./sample-shoot
```

```
Timeline
  START        DEVICE          CLIP                     QUALITY
  0:00.000    REC             MIX_001.WAV              0.916
  0:06.000    CAM_A           A001C001.WAV             0.997
  0:13.000    CAM_B           B001C001.WAV             0.997
  0:40.000    CAM_C           C001C001.WAV             0.997
  1:20.000    CAM_A           A001C002.WAV             0.997
! 2:35.000    STRAY           ELSEWHERE.WAV            —

  5 of 6 clips synced in 2 group(s)

  Unsynced — nothing matched these, and they need a human:
    ELSEWHERE.WAV
```

Point it at real rushes the same way. Node has no WebCodecs, so compressed
audio does not decode there — the CLI names each file it had to skip and why.
WAV, BWF and LPCM in a container all work, which covers every sound recorder.

The sync engine is pure TypeScript with no dependencies, so it runs unchanged in Node, a Web Worker, and the browser main thread:

```ts
import { syncProject } from '@polysync/sync-core';

const result = syncProject([
  { id: 'rec',  trackId: 'REC',   samples: recorderMono, sampleRate: 48000 },
  { id: 'camA', trackId: 'CAM_A', samples: camAMono,     sampleRate: 48000 },
  { id: 'camB', trackId: 'CAM_B', samples: camBMono,     sampleRate: 48000 },
], { onProgress: (f, label) => console.log(label, f) });

result.placements;       // where each clip sits on the timeline
result.unsyncedClipIds;  // what didn't match, and needs a human
result.inconsistencies;  // redundant matches that disagree — the honest warning
```

## Licence

MIT. See [LICENSE](LICENSE).

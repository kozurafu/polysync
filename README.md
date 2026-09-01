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
| `packages/sync-core` | **Working.** GCC-PHAT alignment, envelope fallback, drift estimation, whole-project graph solve. 22 tests, zero dependencies. |
| `packages/exporters` | **Working** for FCP7 XML (Premiere / Resolve) and CMX3600 EDL. FCPXML pending. |
| `packages/timecode` | Stub. `tmcd` and BWF `bext`/iXML parsers to come. |
| `packages/media-io` | Stub. Demux/decode adapters over mediabunny + WebCodecs. |
| `apps/web` | Stub. |

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

## Quick start

```bash
npm install
npm test          # runs the sync-core and exporters suites
```

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

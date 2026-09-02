# apps/web

React + Vite. Owns file picking, project state, results and export; orchestrates
the ingest worker pool and the sync worker. Contains no DSP and no codec
knowledge of its own — that all lives in `@polysync/media-io` and
`@polysync/sync-core`.

Two rules shape the whole thing, both about keeping the main thread free:

1. **Audio never touches the main thread.** Ingest workers hand their decoded
   buffers straight on to the sync worker by transfer. The UI holds metadata and
   a 1.6 kB peak summary per clip, never the audio — a shoot day would otherwise
   be hundreds of megabytes sitting in React state.
2. **Nothing expensive runs where the page paints.** Decode is parallel across
   `hardwareConcurrency - 1` workers; the solve runs in its own worker. On the
   main thread a minute-long solve looks exactly like a crashed tab.

```
src/
  lib/engine.ts        the pool, and the only place workers are spawned
  lib/files.ts         directory picker, webkitdirectory, folder drag-drop
  lib/exportProject.ts SyncResult -> TimelineProject -> XML / EDL
  workers/             one file per worker; both are thin
  components/          Timeline draws lanes from the peak summaries
```

Run it with `npm run dev` from the repo root. `npm run smoke` drives the built
app in a real browser end to end — see `tools/smoke.ts`.

## Not built yet

Waveform timeline with pan and zoom, playback and monitoring, manual nudge and
clip locking, project save/load, OPFS analysis cache. See
[`docs/08-build-plan.md`](../../docs/08-build-plan.md).

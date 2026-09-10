import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { groupClips, type GroupResult } from '@polysync/media-io';
import type { SyncResult } from '@polysync/sync-core';
import type { FrameRate } from '@polysync/timecode';
import {
  ingestFiles,
  poolSize,
  solve,
  type IngestFailure,
  type IngestedClip,
  type PickedFile,
} from './lib/engine.ts';
import {
  MEDIA_ACCEPT,
  downloadText,
  fromDrop,
  fromInput,
  hasDirectoryPicker,
  mergePicked,
  pickDirectory,
  pickedIdentity,
  type PickResult,
} from './lib/files.ts';
import {
  FRAME_RATES,
  exportFiles,
  guessFrameRate,
  type TrackLayout,
} from './lib/exportProject.ts';
import { buildDiagnosticReport, probeEnvironment } from './lib/diagnostics.ts';
import { Timeline, formatClock } from './components/Timeline.tsx';

type Phase = 'idle' | 'ingesting' | 'ready' | 'syncing' | 'solved';

export function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [clips, setClips] = useState<IngestedClip[]>([]);
  const [failures, setFailures] = useState<IngestFailure[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SyncResult | null>(null);
  const [progress, setProgress] = useState({ fraction: 0, label: '' });
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [projectName, setProjectName] = useState('shoot_day_01');
  const [mediaRoot, setMediaRoot] = useState('');
  const [trackLayout, setTrackLayout] = useState<TrackLayout>('per-clip');
  const [rate, setRate] = useState<FrameRate | null>(null);
  const [timings, setTimings] = useState<{ ingestSeconds?: number; solveSeconds?: number }>({});
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ignored, setIgnored] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  /** dragenter/dragleave fire for every child element, so count rather than toggle. */
  const dragDepth = useRef(0);

  const grouping: GroupResult | null = useMemo(() => {
    if (clips.length === 0) return null;
    return groupClips(
      clips.map((clip) => ({
        id: clip.id,
        path: clip.relativePath,
        hasVideo: clip.probe.hasVideo,
      })),
    );
  }, [clips]);

  const baseDevice = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of grouping?.assignments ?? []) map.set(a.clipId, a.deviceId);
    return map;
  }, [grouping]);

  const deviceOf = useCallback(
    (clipId: string) => overrides[clipId] ?? baseDevice.get(clipId) ?? 'DEVICE',
    [overrides, baseDevice],
  );

  const devices = useMemo(() => {
    const seen = new Set<string>();
    for (const clip of clips) seen.add(deviceOf(clip.id));
    return [...seen].sort();
  }, [clips, deviceOf]);

  /**
   * Take newly picked files and fold them into the project.
   *
   * Appends rather than replaces: dropping camera files and then recorder files
   * is the commonest way to assemble a project, and the second drop used to
   * throw the first away. Only files that are new or have changed since the
   * last pass are decoded — re-reading four hours of audio to add one clip is
   * twenty-four seconds nobody should pay twice.
   */
  const addMedia = useCallback(
    async (incoming: PickResult) => {
      setIgnored(incoming.ignored);
      if (incoming.files.length === 0) {
        setError(
          incoming.ignored.length
            ? `Nothing there Polysync can read. ${incoming.ignored.length} file(s) were not audio or video.`
            : 'No media files found there.',
        );
        return;
      }

      const merged = mergePicked(picked, incoming.files);
      const before = new Map(picked.map((f) => [f.relativePath, pickedIdentity(f)]));
      const fresh = merged.filter((f) => before.get(f.relativePath) !== pickedIdentity(f));
      const keep = clips.filter(
        (c) => merged.some((f) => f.relativePath === c.id) && !fresh.some((f) => f.relativePath === c.id),
      );

      setError(null);
      setResult(null);
      setReport(null);
      setPicked(merged);
      setPhase('ingesting');
      setProgress({ fraction: 0, label: 'Reading files' });
      const started = performance.now();

      try {
        const { clips: ingested, failures: failed } = await ingestFiles(fresh, {
          onProgress: (p) =>
            setProgress({
              fraction: p.fraction,
              label: p.current ? `Decoding ${p.current}` : `Decoded ${p.done} of ${p.total}`,
            }),
        });
        const all = [...keep, ...ingested].sort((a, b) => a.id.localeCompare(b.id));
        setTimings({ ingestSeconds: (performance.now() - started) / 1000 });
        setClips(all);
        setFailures((previous) => [
          ...previous.filter((f) => merged.some((m) => m.relativePath === f.relativePath)),
          ...failed,
        ]);
        if (all.length > 0 && !rate) setRate(guessFrameRate(all));
        setPhase('ready');
        if (all.length === 0) {
          setError('Nothing could be decoded. See the skipped files below for why.');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase(clips.length ? 'ready' : 'idle');
      }
    },
    [picked, clips, rate],
  );

  const runSync = useCallback(async () => {
    // Solving transfers the audio into the worker and detaches it here, so a
    // second run needs the files decoded again. Cheaper than keeping a spare
    // copy of a shoot day in memory on the main thread.
    let working = clips;
    if (clips.some((c) => !c.samples)) {
      setPhase('ingesting');
      setProgress({ fraction: 0, label: 'Re-reading files' });
      const { clips: again } = await ingestFiles(picked, {
        onProgress: (p) =>
          setProgress({ fraction: p.fraction, label: `Decoding ${p.current ?? ''}` }),
      });
      working = again;
      setClips(again);
    }

    setError(null);
    setPhase('syncing');
    setProgress({ fraction: 0, label: 'Preparing audio' });
    const started = performance.now();
    try {
      const solved = await solve(working, deviceOf, {
        onProgress: (fraction, label) => setProgress({ fraction, label }),
      });
      setTimings((t) => ({ ...t, solveSeconds: (performance.now() - started) / 1000 }));
      setResult(solved);
      setPhase('solved');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('ready');
    }
  }, [clips, picked, deviceOf]);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      await addMedia(await fromDrop(event.dataTransfer));
    },
    [addMedia],
  );

  /**
   * Stop the browser navigating to a dropped file.
   *
   * A drop that reaches the document is handled by the browser, which opens the
   * file in a new tab — the page, and everything decoded into it, is gone. The
   * app used to render a drop target only on the empty state, so the moment a
   * project existed, dropping anything destroyed it. Reported as "it opened a
   * new tab with a blank screen", which is exactly what a raw .mp4 in a tab
   * looks like.
   *
   * Both events need preventing: without `dragover`, `drop` never fires on us
   * at all.
   */
  useEffect(() => {
    const swallow = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  // True when no clip carries a folder — the shape a pick of individual files
  // produces, and the one Premiere cannot chain-relink from.
  const pathsAreBare = useMemo(
    () => clips.length > 0 && clips.every((c) => !c.relativePath.includes('/')),
    [clips],
  );

  const doExport = useCallback(
    (format: 'fcp7' | 'edl') => {
      if (!result || !rate) return;
      const files = exportFiles(
        { projectName, clips, result, deviceOf, mediaRoot, rate, trackLayout },
        format,
      );
      for (const file of files) downloadText(file.filename, file.content);
    },
    [result, rate, projectName, clips, deviceOf, mediaRoot, trackLayout],
  );

  const makeReport = useCallback(async () => {
    const environment = await probeEnvironment(poolSize(Math.max(1, picked.length)));
    setReport(
      buildDiagnosticReport({
        generatedAt: new Date().toISOString(),
        environment,
        filesPicked: picked.length,
        clips,
        failures,
        grouping,
        deviceOf,
        overrides,
        result,
        timings,
        settings: {
          projectName,
          frameRate: FRAME_RATES.find((r) => rate && sameRate(r.rate, rate))?.label ?? '25',
          mediaRoot,
        },
      }),
    );
    setCopied(false);
  }, [
    picked, clips, failures, grouping, deviceOf, overrides,
    result, timings, projectName, rate, mediaRoot,
  ]);

  const copyReport = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      // Clipboard access needs a secure context and a user gesture, and can
      // still be refused. Falling back to a file loses nothing.
      downloadText('polysync-diagnostics.txt', report);
    }
  }, [report]);

  const busy = phase === 'ingesting' || phase === 'syncing';

  // Sync compares one device against another. With one device there is nothing
  // to compare against and every clip comes back unsynced however good the
  // audio is — so say that instead of letting someone sit through the solve to
  // find out. A user did exactly that with 70 clips from one camera.
  const canSync = clips.length >= 2 && devices.length >= 2;
  const syncBlockedReason =
    clips.length < 2
      ? 'Add at least two clips'
      : devices.length < 2
        ? `Everything is on one device (${devices[0]}). Syncing needs two — set the right device per clip below.`
        : undefined;

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {dragOver && (
        <div className="drop-veil">
          <div>Drop to add — files or folders</div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">Poly<span>sync</span></div>
        <div className="privacy">LOCAL ONLY · NOTHING IS UPLOADED</div>
        <div className="spacer" />
        <div className="actions">
          {clips.length > 0 && (
            <button onClick={() => void makeReport()} disabled={busy}>
              Diagnostics
            </button>
          )}
          {clips.length > 0 && (
            <button onClick={() => fileInputRef.current?.click()} disabled={busy}>
              Add files
            </button>
          )}
          {clips.length > 0 && (
            <button onClick={() => folderInputRef.current?.click()} disabled={busy}>
              Add folder
            </button>
          )}
          {clips.length > 0 && (
            <button
              className="primary"
              onClick={runSync}
              disabled={busy || !canSync}
              title={syncBlockedReason}
            >
              {phase === 'solved' ? 'Synchronize again' : 'Synchronize'}
            </button>
          )}
        </div>
      </header>

      {/*
        Two inputs, because one cannot do both jobs. `webkitdirectory` turns the
        OS dialog into a folder-only picker, which greys out every individual
        file — reported as "the files are greyed out". The fix is not a flag, it
        is a second input.
        The value is cleared on each change so picking the same folder twice in
        a row still fires an event.
      */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          const result = fromInput(e.target.files);
          e.target.value = '';
          void addMedia(result);
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          const result = fromInput(e.target.files);
          e.target.value = '';
          void addMedia(result);
        }}
      />

      <main>
        {clips.length === 0 && !busy && (
          <div className={`dropzone ${dragOver ? 'over' : ''}`}>
            <h1>Drop a shoot day here</h1>
            <p>
              Drop files or whole folders, anywhere on this page. Ideally one folder per device —
              a camera and a recorder, or two cameras. Everything runs in this tab: your media is
              never uploaded, and there is no account.
            </p>
            <div className="buttons">
              <button className="primary" onClick={() => fileInputRef.current?.click()}>
                Choose files…
              </button>
              {hasDirectoryPicker() ? (
                <button
                  onClick={() =>
                    void pickDirectory()
                      .then(addMedia)
                      .catch(() => undefined) /* the user cancelled the picker */
                  }
                >
                  Choose a folder…
                </button>
              ) : (
                <button onClick={() => folderInputRef.current?.click()}>Choose a folder…</button>
              )}
            </div>
            <p className="hint">
              Works best in Chrome or Edge. Compressed camera audio (AAC) needs WebCodecs; WAV and
              BWF from any recorder work everywhere.
            </p>
          </div>
        )}

        {busy && (
          <section className="panel">
            <h2>{phase === 'syncing' ? 'Synchronizing' : 'Reading media'}</h2>
            <div className="panel-body progress">
              <div className="bar">
                <div className="fill" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
              </div>
              <div className="label">
                <span>{progress.label}</span>
                <span>{Math.round(progress.fraction * 100)}%</span>
              </div>
              {phase === 'ingesting' && (
                <div className="label">
                  <span>
                    {poolSize(picked.length)} decoder{poolSize(picked.length) === 1 ? '' : 's'} running
                    in parallel
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {error && (
          <div className="note bad">
            <h3>Problem</h3>
            {error}
          </div>
        )}

        {!busy && ignored.length > 0 && (
          <div className="note warn">
            <h3>
              Ignored {ignored.length} file{ignored.length === 1 ? '' : 's'} that {ignored.length === 1 ? 'is' : 'are'} not audio or video
            </h3>
            <p style={{ margin: 0 }}>
              {ignored.slice(0, 8).join(', ')}
              {ignored.length > 8 ? `, and ${ignored.length - 8} more` : ''}
            </p>
          </div>
        )}

        {!busy && clips.length > 0 && !canSync && (
          <div className="note warn">
            <h3>Nothing to sync yet</h3>
            <p style={{ margin: 0 }}>{syncBlockedReason}</p>
          </div>
        )}

        {grouping && !busy && (
          <section className="panel">
            <h2>Devices</h2>
            <div className="panel-body">
              <div className="devices">
                {devices.map((device) => (
                  <div className="device-chip" key={device}>
                    <b>{device}</b>
                    <span>
                      {clips.filter((c) => deviceOf(c.id) === device).length} clip
                      {clips.filter((c) => deviceOf(c.id) === device).length === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="basis">
                Grouped by <code>{grouping.basis.replace('-', ' ')}</code>. Change any clip's device
                in the table below — the grouping is a suggestion, not a decision.
              </p>
              {grouping.warnings.map((warning) => (
                <div className="note warn" key={warning} style={{ marginTop: 12 }}>
                  {warning}
                </div>
              ))}
            </div>
          </section>
        )}

        {result && rate && (
          <section className="panel">
            <h2>Timeline</h2>
            <div className="panel-body">
              <Timeline
                clips={clips}
                placements={result.placements}
                deviceOf={deviceOf}
                devices={devices}
              />
              <div className="stats" style={{ marginTop: 16 }}>
                <span>
                  <b>{result.placements.filter((p) => p.synced).length}</b> of{' '}
                  <b>{result.placements.length}</b> synced
                </span>
                <span>
                  <b>{result.groupCount}</b> group{result.groupCount === 1 ? '' : 's'}
                </span>
                <span>
                  <b>{result.stats.aligned}</b> of <b>{result.stats.totalPairs}</b> pairs compared
                </span>
                {result.stats.skippedByRecordingTime > 0 && (
                  <span>
                    <b>{result.stats.skippedByRecordingTime}</b> ruled out on recording time
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {result && result.unsyncedClipIds.length > 0 && (
          <div className="note warn">
            <h3>Unsynced — nothing matched these</h3>
            <p style={{ margin: '0 0 6px' }}>
              They are laid out after the synced material with a gap, which is where an editor
              expects to find them. A clip only lands here when no match was found at all.
            </p>
            <ul>
              {result.unsyncedClipIds.map((id) => (
                <li key={id}>{clips.find((c) => c.id === id)?.name ?? id}</li>
              ))}
            </ul>
          </div>
        )}

        {result && result.inconsistencies.length > 0 && (
          <div className="note bad">
            <h3>Matches that disagree</h3>
            <p style={{ margin: '0 0 6px' }}>
              These pairs matched each other, but at a different offset than the solved timeline
              puts them. At least one of the two is wrong — check these by ear before cutting.
            </p>
            <ul>
              {result.inconsistencies.map((bad) => (
                <li key={`${bad.aId}~${bad.bId}`}>
                  {clips.find((c) => c.id === bad.aId)?.name ?? bad.aId} vs{' '}
                  {clips.find((c) => c.id === bad.bId)?.name ?? bad.bId} — off by{' '}
                  {(bad.errorSeconds * 1000).toFixed(0)} ms
                </li>
              ))}
            </ul>
          </div>
        )}

        {clips.length > 0 && !busy && (
          <section className="panel">
            <h2>Clips</h2>
            <div className="panel-body table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Clip</th>
                    <th>Device</th>
                    <th>Duration</th>
                    <th>Format</th>
                    <th>Timecode</th>
                    {result && <th>Start</th>}
                    {result && <th>Quality</th>}
                    {result && <th>Drift</th>}
                    {result && <th>Status</th>}
                  </tr>
                </thead>
                <tbody>
                  {clips.map((clip) => {
                    const placement = result?.placements.find((p) => p.clipId === clip.id);
                    return (
                      <tr key={clip.id}>
                        <td className="name" title={clip.relativePath}>
                          {clip.name}
                        </td>
                        <td>
                          <select
                            value={deviceOf(clip.id)}
                            onChange={(e) =>
                              setOverrides((o) => ({ ...o, [clip.id]: e.target.value }))
                            }
                          >
                            {devices.map((device) => (
                              <option key={device} value={device}>
                                {device}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">{formatClock(clip.durationSeconds)}</td>
                        <td className="num">
                          {clip.probe.audioCodec ?? '—'} · {clip.probe.sampleRate} Hz ×
                          {clip.probe.channels}
                        </td>
                        <td className="num">
                          {clip.timecodeSeconds !== undefined
                            ? `${formatTimeOfDay(clip.timecodeSeconds)} (${clip.probe.timecodeSource})`
                            : '—'}
                        </td>
                        {result && (
                          <td className="num">
                            {placement ? formatClock(placement.startSeconds) : '—'}
                          </td>
                        )}
                        {result && (
                          <td className="num">
                            {placement?.quality !== undefined ? placement.quality.toFixed(3) : '—'}
                          </td>
                        )}
                        {result && (
                          <td className="num">
                            {placement?.driftPpm !== undefined
                              ? `${placement.driftPpm > 0 ? '+' : ''}${placement.driftPpm.toFixed(1)} ppm`
                              : '—'}
                          </td>
                        )}
                        {result && (
                          <td>
                            <span className={`pill ${placement?.synced ? 'ok' : 'no'}`}>
                              {placement?.synced ? 'Synced' : 'Unsynced'}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {failures.length > 0 && !busy && (
          <div className="note warn">
            <h3>Skipped {failures.length} file{failures.length === 1 ? '' : 's'}</h3>
            <ul>
              {failures.map((failure) => (
                <li key={failure.relativePath}>
                  <code>{failure.relativePath}</code> — {failure.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result && rate && (
          <section className="panel">
            <h2>Export</h2>
            <div className="panel-body">
              <div className="export-row">
                <div className="field">
                  <label htmlFor="project-name">Sequence name</label>
                  <input
                    id="project-name"
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="rate">Frame rate</label>
                  <select
                    id="rate"
                    value={FRAME_RATES.find((r) => sameRate(r.rate, rate))?.label ?? '25'}
                    onChange={(e) =>
                      setRate(
                        FRAME_RATES.find((r) => r.label === e.target.value)?.rate ?? rate,
                      )
                    }
                  >
                    {FRAME_RATES.map((r) => (
                      <option key={r.label} value={r.label}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="media-root">Media folder on this machine</label>
                  <input
                    id="media-root"
                    type="text"
                    placeholder="D:\Rushes\Day1   or   /Volumes/Rushes/Day1"
                    value={mediaRoot}
                    onChange={(e) => setMediaRoot(e.target.value)}
                  />
                </div>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="track-layout">Timeline layout</label>
                <select
                  id="track-layout"
                  value={trackLayout}
                  onChange={(e) => setTrackLayout(e.target.value as TrackLayout)}
                >
                  <option value="per-clip">One track per clip — nothing can hide</option>
                  <option value="per-device">One track per camera — compact, multicam-ready</option>
                </select>
              </div>
              <p className="help" style={{ marginTop: 10, maxWidth: '72ch' }}>
                A track holds one clip at a time, so two clips on one track means the later one can
                sit behind the earlier. <em>One track per clip</em> gives every file a track of its
                own — thirty files, thirty video tracks — which makes for a tall timeline and
                guarantees you can see everything that came in. <em>One track per camera</em> is the
                classic layout: angles stacked, ready to cut between.
              </p>
              <p className="help" style={{ marginTop: 10, maxWidth: '72ch' }}>
                A browser is never told where a file lives on disk — that is a privacy rule of the
                platform, not something we can work around. FCP7 XML relinks by path, so paste the
                folder you picked and it gets joined to each clip's relative path.
              </p>
              {!mediaRoot && (
                <div className="note warn" style={{ marginTop: 10 }}>
                  <p style={{ margin: 0 }}>
                    {pathsAreBare
                      ? `Every clip will be written as a bare filename, because these files were ` +
                        `picked individually and a browser only learns a file's folder when you ` +
                        `pick the folder itself. Premiere will show all ${clips.length} as offline ` +
                        `and relink them one at a time. Fill in the folder above, or re-add the ` +
                        `media as a folder, and it can relink the lot in one go.`
                      : `Without the folder above, Premiere will show the clips as offline. ` +
                        `Because they keep their subfolder structure it should relink all of them ` +
                        `once you point it at the first one.`}
                  </p>
                </div>
              )}
              <div className="export-row" style={{ marginTop: 14 }}>
                <button className="primary" onClick={() => doExport('fcp7')}>
                  FCP7 XML — Premiere, Resolve
                </button>
                <button onClick={() => doExport('edl')}>CMX3600 EDL — one per device</button>
              </div>
              <div className="note" style={{ marginTop: 14 }}>
                Unsynced clips are marked with a label colour. In Premiere, <em>Project Settings →
                General → “Display the project item name and label color for all instances”</em>{' '}
                silently overrides that, so turn it off if the colours do not appear.
              </div>
            </div>
          </section>
        )}
        {report && (
          <section className="panel">
            <h2>Diagnostic report</h2>
            <div className="panel-body">
              <p className="help" style={{ marginTop: 0 }}>
                Everything below is what gets sent — read it first. It lists file names, folder
                paths and formats, the device grouping, the solve result, and why each unsynced
                clip did not match. It contains <strong>no audio of any kind</strong>: no samples,
                no waveforms, nothing derived from the sound.
              </p>
              <div className="export-row" style={{ marginBottom: 12 }}>
                <button className="primary" onClick={() => void copyReport()}>
                  {copied ? 'Copied' : 'Copy to clipboard'}
                </button>
                <button onClick={() => downloadText('polysync-diagnostics.txt', report)}>
                  Download as a file
                </button>
                <button onClick={() => setReport(null)}>Close</button>
              </div>
              <pre className="report">{report}</pre>
            </div>
          </section>
        )}
      </main>

      <footer>
        <span>Polysync — a local-first successor to PluralEyes.</span>
        <span>Your media never leaves this machine.</span>
      </footer>
    </div>
  );
}

function sameRate(a: FrameRate, b: FrameRate): boolean {
  return a.nominal === b.nominal && a.ntsc === b.ntsc && a.dropFrame === b.dropFrame;
}

function formatTimeOfDay(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

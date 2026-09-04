import { useCallback, useMemo, useRef, useState } from 'react';
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
import { downloadText, fromDrop, fromInput, hasDirectoryPicker, pickDirectory } from './lib/files.ts';
import { FRAME_RATES, exportFiles, guessFrameRate } from './lib/exportProject.ts';
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
  const [rate, setRate] = useState<FrameRate | null>(null);
  const [timings, setTimings] = useState<{ ingestSeconds?: number; solveSeconds?: number }>({});
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const startIngest = useCallback(async (files: PickedFile[]) => {
    if (files.length === 0) {
      setError('No media files found in that folder.');
      return;
    }
    setError(null);
    setResult(null);
    setPicked(files);
    setPhase('ingesting');
    setProgress({ fraction: 0, label: 'Reading files' });
    setReport(null);
    const started = performance.now();

    try {
      const { clips: ingested, failures: failed } = await ingestFiles(files, {
        onProgress: (p) =>
          setProgress({
            fraction: p.fraction,
            label: p.current ? `Decoding ${p.current}` : `Decoded ${p.done} of ${p.total}`,
          }),
      });
      setTimings({ ingestSeconds: (performance.now() - started) / 1000 });
      setClips(ingested);
      setFailures(failed);
      setOverrides({});
      if (ingested.length > 0 && !rate) setRate(guessFrameRate(ingested));
      setPhase('ready');
      if (ingested.length === 0) {
        setError('Nothing could be decoded. See the skipped files below for why.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }, [rate]);

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
      setDragOver(false);
      const files = await fromDrop(event.dataTransfer);
      await startIngest(files);
    },
    [startIngest],
  );

  const doExport = useCallback(
    (format: 'fcp7' | 'edl') => {
      if (!result || !rate) return;
      const files = exportFiles(
        { projectName, clips, result, deviceOf, mediaRoot, rate },
        format,
      );
      for (const file of files) downloadText(file.filename, file.content);
    },
    [result, rate, projectName, clips, deviceOf, mediaRoot],
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
    <div className="app">
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
            <button onClick={() => inputRef.current?.click()} disabled={busy}>
              Add media
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

      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        // Non-standard attributes that make an <input> accept a folder.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => void startIngest(fromInput(e.target.files))}
      />

      <main>
        {clips.length === 0 && !busy && (
          <div
            className={`dropzone ${dragOver ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void onDrop(e)}
          >
            <h1>Drop a shoot day here</h1>
            <p>
              Cameras and recorders in one folder, one subfolder per device. Everything runs in
              this tab — your media is never uploaded, and there is no account.
            </p>
            <div className="buttons">
              {hasDirectoryPicker() && (
                <button
                  className="primary"
                  onClick={() =>
                    void pickDirectory()
                      .then(startIngest)
                      .catch(() => undefined) /* the user cancelled the picker */
                  }
                >
                  Choose folder
                </button>
              )}
              <button onClick={() => inputRef.current?.click()}>Browse…</button>
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
              <p className="help" style={{ marginTop: 10, maxWidth: '72ch' }}>
                A browser is never told where a file lives on disk — that is a privacy rule of the
                platform, not something we can work around. FCP7 XML relinks by absolute path, so
                paste the folder you picked and it gets joined to each clip's relative path. Leave
                it blank and the NLE will ask you to relink once, which also works.
              </p>
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

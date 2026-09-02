/**
 * One lane per device, clips drawn at their solved positions.
 *
 * Not the canvas timeline from the plan — there is no pan, no zoom, no
 * scrubbing. It exists to answer one question at a glance: did the clips land
 * where they should have? For that, seeing four devices' waveforms line up
 * vertically is worth more than any table of numbers.
 */

import { useEffect, useRef } from 'react';
import type { Placement } from '@polysync/sync-core';
import type { IngestedClip } from '../lib/engine.ts';

interface Props {
  clips: IngestedClip[];
  placements: Placement[];
  deviceOf: (clipId: string) => string;
  devices: string[];
}

export function Timeline({ clips, placements, deviceOf, devices }: Props) {
  const byId = new Map(clips.map((c) => [c.id, c]));
  const placed = placements
    .map((p) => ({ placement: p, clip: byId.get(p.clipId) }))
    .filter((x): x is { placement: Placement; clip: IngestedClip } => Boolean(x.clip));

  if (placed.length === 0) return null;

  const span = Math.max(
    ...placed.map((x) => x.placement.startSeconds + x.clip.durationSeconds),
    1,
  );
  const origin = Math.min(...placed.map((x) => x.placement.startSeconds), 0);
  const total = span - origin;

  return (
    <div>
      <div className="timeline">
        {devices.map((device) => (
          <div className="tl-row" key={device}>
            <div className="tl-name">{device}</div>
            <div className="tl-lane">
              {placed
                .filter((x) => deviceOf(x.clip.id) === device)
                .map(({ placement, clip }) => {
                  const left = ((placement.startSeconds - origin) / total) * 100;
                  const width = (clip.durationSeconds / total) * 100;
                  return (
                    <div
                      key={clip.id}
                      className={`tl-clip ${placement.synced ? 'synced' : 'unsynced'}`}
                      style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%` }}
                      title={`${clip.name} — starts ${formatClock(placement.startSeconds - origin)}`}
                    >
                      <PeakStrip peaks={clip.peaks} synced={placement.synced} />
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <div className="tl-ruler">
        <span>0:00</span>
        <span>{formatClock(total / 2)}</span>
        <span>{formatClock(total)}</span>
      </div>
    </div>
  );
}

/** The 400-point peak summary the ingest worker sent, drawn to fill its clip. */
function PeakStrip({ peaks, synced }: { peaks: Float32Array; synced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = synced ? 'rgba(79,181,131,0.85)' : 'rgba(217,115,106,0.85)';

    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      const peak = peaks[Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length))] ?? 0;
      const h = Math.max(1, peak * mid);
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, synced]);

  return <canvas ref={ref} />;
}

export function formatClock(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${sign}${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

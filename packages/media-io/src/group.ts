/**
 * Working out which device shot which file.
 *
 * PluralEyes called this Smart Start and it was the feature people liked most.
 * It was also not overridable, which is the feature people complained about
 * most — so every decision here carries the `basis` it was made on, and the UI
 * is expected to show that and let the user change it.
 *
 * Strategies are tried in order and the first that produces a usable split
 * wins. "Usable" matters: a strategy that puts every file on one device has
 * not identified anything, so we fall through to the next one rather than
 * confidently returning a single track.
 */

export type GroupBasis =
  | 'card-structure'
  | 'directory'
  | 'filename-prefix'
  | 'container-metadata'
  | 'extension-class'
  | 'manual';

export interface GroupInput {
  id: string;
  /** Path relative to the folder the user dropped, e.g. `CAM_A/CLIPS/A001.MOV`. */
  path: string;
  hasVideo?: boolean;
  /** Recording device as declared by the container, e.g. from `©mak`/`©mod`. */
  make?: string;
  model?: string;
  serial?: string;
}

export interface GroupAssignment {
  clipId: string;
  deviceId: string;
  basis: GroupBasis;
}

export interface GroupResult {
  assignments: GroupAssignment[];
  /** Device ids in a stable order: cards and cameras first, audio last. */
  deviceIds: string[];
  basis: GroupBasis;
  /**
   * Set when the card structure was recognised but a file appears to have been
   * dragged out of it. Spanned clips silently stop spanning when this happens,
   * which is the commonest cause of an AVCHD card syncing as loose fragments.
   */
  warnings: string[];
}

/**
 * Camera-card layouts, in the order they are tested.
 *
 * The device is the path segment *above* the marker: dropping a folder holding
 * `CAM_A/PRIVATE/AVCHD/...` and `CAM_B/PRIVATE/AVCHD/...` gives two devices.
 */
const CARD_MARKERS: Array<{ segments: string[]; label: string }> = [
  { segments: ['private', 'avchd'], label: 'AVCHD' },
  { segments: ['avchd'], label: 'AVCHD' },
  { segments: ['bpav'], label: 'XDCAM' },
  { segments: ['contents', 'clip'], label: 'P2' },
  { segments: ['contents'], label: 'CanonXF' },
  { segments: ['dcim'], label: 'DCIM' },
];

const AUDIO_EXTENSIONS = new Set(['wav', 'bwf', 'w64', 'rf64', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac']);

export function groupClips(inputs: GroupInput[]): GroupResult {
  if (inputs.length === 0) {
    return { assignments: [], deviceIds: [], basis: 'directory', warnings: [] };
  }

  // Computed before any strategy runs, and independently of which one wins.
  // A loose card file is precisely the case where card detection *fails*, so
  // deriving the warning from the winning strategy would suppress it exactly
  // when it is needed.
  const warnings = looseCardWarnings(inputs);

  const strategies: Array<{ basis: GroupBasis; key: (i: GroupInput) => string | undefined }> = [
    { basis: 'card-structure', key: cardDevice },
    { basis: 'directory', key: topDirectory },
    { basis: 'filename-prefix', key: filenamePrefix },
    { basis: 'container-metadata', key: metadataDevice },
    { basis: 'extension-class', key: extensionClass },
  ];

  // The first strategy that manages to name every file, kept aside in case no
  // strategy manages to split them. A folder of one camera's rushes really is
  // one device, and calling it `C2` because that is what the files are called
  // beats falling through to the extension-class last resort and calling it
  // VIDEO.
  let fallback: { basis: GroupBasis; keys: string[] } | undefined;

  for (const { basis, key } of strategies) {
    const keys = inputs.map(key);
    if (keys.some((k) => k === undefined)) continue;
    const named = keys as string[];
    if (!fallback) fallback = { basis, keys: named };

    // A strategy that names every file *and* names more than one device has
    // actually identified something. One device is not yet a reason to stop —
    // a later strategy may still separate them.
    if (new Set(named).size < 2) continue;
    return finish(inputs, named, basis, warnings);
  }

  if (fallback) return finish(inputs, fallback.keys, fallback.basis, warnings);

  const only = inputs.length === 1 ? deviceNameFor(inputs[0]) : 'DEVICE_1';
  return finish(inputs, inputs.map(() => only), 'extension-class', warnings);
}

function finish(
  inputs: GroupInput[],
  keys: string[],
  basis: GroupBasis,
  warnings: string[],
): GroupResult {
  const assignments = inputs.map((input, i) => ({
    clipId: input.id,
    deviceId: keys[i],
    basis,
  }));
  const deviceIds = orderDevices(assignments, inputs);

  // The single most useful thing to say when it is true. Sync compares one
  // device against another; with only one there is nothing to compare against,
  // and every clip will come back unsynced no matter how good the audio is.
  if (deviceIds.length < 2 && inputs.length > 1) {
    warnings.push(
      `All ${inputs.length} clips look like they came from one device (${deviceIds[0]}). ` +
        `Syncing needs at least two — a camera and a recorder, or two cameras. ` +
        `If more than one device really is in here, set the right device per clip below.`,
    );
  }

  return { assignments, deviceIds, basis, warnings };
}

/** The folder containing a recognised card structure. */
function cardDevice(input: GroupInput): string | undefined {
  const parts = input.path.split('/').filter(Boolean);
  const lower = parts.map((p) => p.toLowerCase());
  for (const marker of CARD_MARKERS) {
    for (let i = 0; i + marker.segments.length <= lower.length; i++) {
      if (marker.segments.every((seg, k) => lower[i + k] === seg)) {
        // The segment above the marker names the card; at the root, the marker
        // itself is all we have, so the card label stands in.
        return i > 0 ? sanitise(parts[i - 1]) : `${marker.label}_CARD`;
      }
    }
  }
  return undefined;
}

/** Files loose in a card folder, which breaks spanned-clip detection. */
function looseCardWarningsFor(input: GroupInput): string | undefined {
  const parts = input.path.split('/').filter(Boolean);
  if (parts.length !== 1) return undefined;
  const ext = extensionOf(input.path);
  if (ext === 'mts' || ext === 'm2ts') {
    return `${parts[0]} looks like an AVCHD stream sitting outside its card folder. Spanned clips only join up when the whole PRIVATE/AVCHD tree is kept together.`;
  }
  return undefined;
}

function looseCardWarnings(inputs: GroupInput[]): string[] {
  const out: string[] = [];
  for (const input of inputs) {
    const w = looseCardWarningsFor(input);
    if (w) out.push(w);
  }
  return out;
}

/** Top-level subdirectory of the drop — the way most people actually organise. */
function topDirectory(input: GroupInput): string | undefined {
  const parts = input.path.split('/').filter(Boolean);
  return parts.length > 1 ? sanitise(parts[0]) : undefined;
}

/**
 * Reel or prefix from the filename.
 *
 * Cameras name files in a handful of recognisable shapes, and the right answer
 * differs for each:
 *
 *   `A001C002_240101AB.MOV`  Canon — the reel is `A001`, the clip is `C002`.
 *                            Taking the leading letter alone merges every card.
 *   `C2_4928.MP4`            body/camera id, then a counter after a separator.
 *   `MVI_1234.MOV`           the same shape with a letters-only prefix.
 *   `ZOOM0001.WAV`           prefix runs straight into the counter.
 *   `GX010123.MP4`           GoPro, likewise.
 *   `C0001.MP4`              Sony — a single letter, then the counter.
 *   `00001.MTS`             nothing to go on; give up rather than guess.
 */
function filenamePrefix(input: GroupInput): string | undefined {
  const base = baseName(input.path).replace(/\.[^.]+$/, '');

  const canon = /^([A-Za-z]\d{3})[A-Za-z]\d{3,4}/.exec(base);
  if (canon) return sanitise(canon[1]);

  // Everything before the first separator, when it carries a letter. This is
  // what makes `C2_4928` group as `C2` rather than falling through to the
  // extension-class last resort and being labelled, unhelpfully, VIDEO.
  const separated = /^([^_\-.]*[A-Za-z][^_\-.]*)[_\-.]/.exec(base);
  if (separated) return sanitise(separated[1]);

  const alpha = /^([A-Za-z]{2,})/.exec(base);
  if (alpha) return sanitise(alpha[1]);

  const single = /^([A-Za-z])\d+$/.exec(base);
  if (single) return sanitise(single[1]);

  return undefined;
}

function metadataDevice(input: GroupInput): string | undefined {
  const parts = [input.make, input.model, input.serial].filter(Boolean);
  return parts.length ? sanitise(parts.join('_')) : undefined;
}

/**
 * The last resort, and the one case where a single group is a real answer:
 * a folder of camera files and a folder of recorder files split correctly
 * into picture and sound even when nothing else distinguishes them.
 */
function extensionClass(input: GroupInput): string {
  const ext = extensionOf(input.path);
  if (input.hasVideo === false || (input.hasVideo === undefined && AUDIO_EXTENSIONS.has(ext))) {
    return 'AUDIO';
  }
  return 'VIDEO';
}

function deviceNameFor(input: GroupInput): string {
  return extensionClass(input) === 'AUDIO' ? 'AUDIO' : 'VIDEO';
}

/** Cameras before recorders: it is the order an editor expects on a timeline. */
function orderDevices(assignments: GroupAssignment[], inputs: GroupInput[]): string[] {
  const audioOnly = new Map<string, boolean>();
  const byId = new Map(inputs.map((i) => [i.id, i]));
  for (const a of assignments) {
    const input = byId.get(a.clipId);
    const isAudio = input ? extensionClass(input) === 'AUDIO' : false;
    audioOnly.set(a.deviceId, (audioOnly.get(a.deviceId) ?? true) && isAudio);
  }
  return [...audioOnly.keys()].sort((a, b) => {
    const aAudio = audioOnly.get(a) ? 1 : 0;
    const bAudio = audioOnly.get(b) ? 1 : 0;
    return aAudio - bAudio || a.localeCompare(b);
  });
}

export function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function extensionOf(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Device ids end up as NLE track names and EDL reels, so keep them tame. */
function sanitise(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return cleaned || 'DEVICE';
}

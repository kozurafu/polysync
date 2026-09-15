/**
 * Whether the solve may use every core, or just one.
 *
 * Worth exposing because the parallel path is the newest and least-travelled
 * code in the app: if a result ever looks wrong, the most useful thing a user
 * can do is run it again the old way and see whether the answer changes. That
 * should be a button, not a URL parameter only I know about.
 *
 * The choice is remembered per browser. It is a convenience, not project data —
 * if the browser refuses to store it (a private window, blocked site data), the
 * app carries on with the default rather than failing.
 */

export type CoreMode = 'all' | 'single';

const KEY = 'polysync.coreMode';

export function loadCoreMode(): CoreMode {
  try {
    return localStorage.getItem(KEY) === 'single' ? 'single' : 'all';
  } catch {
    return 'all';
  }
}

export function saveCoreMode(mode: CoreMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // A browser that will not remember the choice is not a reason to refuse it.
  }
}

/** What to hand `solve`: a forced count, or undefined to let it decide. */
export function workersFor(mode: CoreMode): number | undefined {
  return mode === 'single' ? 1 : undefined;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCoreMode, saveCoreMode, workersFor } from '../src/lib/coreMode.ts';

/** A working store, since the Node test environment has no localStorage. */
function stubStorage(): void {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    clear: () => data.clear(),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('coreMode', () => {
  it('defaults to using every core', () => {
    stubStorage();
    expect(loadCoreMode()).toBe('all');
  });

  it('defaults to using every core when there is no storage at all', () => {
    // The Node test environment has none, which is the same shape as a browser
    // that blocks it — and the app must still run.
    expect(loadCoreMode()).toBe('all');
    expect(() => saveCoreMode('single')).not.toThrow();
  });

  it('remembers the choice', () => {
    stubStorage();
    saveCoreMode('single');
    expect(loadCoreMode()).toBe('single');
    saveCoreMode('all');
    expect(loadCoreMode()).toBe('all');
  });

  it('carries on when the browser refuses to store anything', () => {
    // A private window, or site data blocked. Losing a preference must not
    // take the app down with it.
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    });
    expect(() => saveCoreMode('single')).not.toThrow();
    expect(loadCoreMode()).toBe('all');
  });

  it('treats anything unexpected in storage as the default', () => {
    stubStorage();
    localStorage.setItem('polysync.coreMode', 'sixteen');
    expect(loadCoreMode()).toBe('all');
  });

  it('forces one worker for single, and defers otherwise', () => {
    // undefined means "decide for yourself": the memory budget still applies,
    // so choosing all cores is a preference, not an override.
    expect(workersFor('single')).toBe(1);
    expect(workersFor('all')).toBeUndefined();
  });
});

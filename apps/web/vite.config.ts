import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A stamp identifying exactly which source built this bundle.
 *
 * Every asset filename is content-hashed, so a stale one can never be loaded
 * by a fresh page — but `index.html` is not hashed, and it is the one file
 * that decides which hashed assets get requested. A browser holding a cached
 * copy of it therefore serves the *entire* old app, coherently, and a bug
 * report from it looks exactly like a report from a real old build.
 *
 * That cost a round trip: a report was diagnosed by inferring its build from
 * which sections it happened to contain. Now it says so itself.
 */
function buildStamp(): string {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
    if (dirty) commit += '+';
  } catch {
    // Building outside a checkout is fine; the timestamp still identifies it.
  }
  return `${commit} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildStamp()) },
  plugins: [react()],
  // Relative asset URLs, so the built site works from a subdirectory —
  // GitHub Pages project sites and preview deploys both need this.
  base: './',
  worker: { format: 'es' },
  optimizeDeps: {
    // Workspace packages ship TypeScript source rather than a build, so let
    // Vite compile them with the app instead of pre-bundling them.
    exclude: ['@polysync/sync-core', '@polysync/media-io', '@polysync/timecode', '@polysync/exporters'],
  },
  build: { target: 'es2022', sourcemap: true },
});

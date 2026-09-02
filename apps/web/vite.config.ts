import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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

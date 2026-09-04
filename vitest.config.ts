import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@polysync/sync-core': r('./packages/sync-core/src/index.ts'),
      '@polysync/timecode': r('./packages/timecode/src/index.ts'),
      '@polysync/exporters': r('./packages/exporters/src/index.ts'),
      '@polysync/media-io': r('./packages/media-io/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    testTimeout: 120_000,
  },
});

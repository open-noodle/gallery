import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Opt-in benchmarks (see test/perf/README.md). No CI suite includes this config or these files.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'server:perf',
    root: serverRoot,
    globals: true,
    include: ['test/perf/**/*.bench.ts'],
    testTimeout: 4 * 60 * 60 * 1000,
    hookTimeout: 4 * 60 * 60 * 1000,
    env: {
      TZ: 'UTC',
    },
  },
  plugins: [swc.vite()],
});

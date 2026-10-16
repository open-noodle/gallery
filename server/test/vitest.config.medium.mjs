import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'server:medium',
    root: serverRoot,
    globals: true,
    include: ['test/medium/**/*.spec.ts'],
    globalSetup: ['test/medium/globalSetup.ts'],
    // Metadata extraction falls back to the server's zone (#1147), so pin it
    // like the unit config does; otherwise results depend on the machine's zone.
    env: {
      TZ: 'UTC',
    },
  },
  plugins: [swc.vite()],
});

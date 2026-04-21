import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

process.env.PUBLIC_IMMICH_BUY_HOST = process.env.PUBLIC_IMMICH_BUY_HOST || 'https://buy.immich.app';
process.env.PUBLIC_IMMICH_PAY_HOST = process.env.PUBLIC_IMMICH_PAY_HOST || 'https://pay.futo.org';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    // TODO pending `@immich/ui` to enable it
    // runes: true,
  },
  preprocess: vitePreprocess(),
  kit: {
    // Only set version.name when IMMICH_BUILD is provided (Docker builds set
    // it from the BUILD_ID arg). Setting `version.name = Date.now().toString()`
    // as a fallback breaks SvelteKit's `__sveltekit_<hash>` global because
    // `load_config` re-imports svelte.config.js with a `?ts=` cache buster
    // between Vite phases — the user's `Date.now()` is recomputed each time,
    // so chunks and the SPA fallback HTML get different hashes and the chunk's
    // `globalThis.__sveltekit_<hash>.env` lookup is undefined at runtime.
    // Omitting `version.name` falls back to SvelteKit's own default, which is
    // stable across reloads.
    ...(process.env.IMMICH_BUILD ? { version: { name: process.env.IMMICH_BUILD } } : {}),
    paths: {
      relative: false,
    },
    adapter: adapter({
      fallback: 'index.html',
      precompress: true,
    }),
    alias: {
      $lib: 'src/lib',
      '$lib/*': 'src/lib/*',
      $tests: 'src/../tests',
      '$tests/*': 'src/../tests/*',
      '@test-data': 'src/test-data',
      $i18n: '../i18n',
      'chromecast-caf-sender': './node_modules/@types/chromecast-caf-sender/index.d.ts',
    },
  },
  onwarn: (warning, handler) => {
    if (warning.code === 'state_referenced_locally') {
      return;
    }
    handler(warning);
  },
};

export default config;

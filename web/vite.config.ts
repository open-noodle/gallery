import adapter from '@sveltejs/adapter-static';
import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import dotenv from 'dotenv';
import { defaultTreeAdapter, parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type Plugin, type ProxyOptions, type UserConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { galleryI18nVitePlugin, writeMergedI18n } from '../i18n/gallery/merge.mjs';

const buildDir = 'build';
const inlineTags = ['script', 'style'];
const shadowTemplatePackages = ['media-chrome', 'custom-media-element'];
const shadowTemplateModulePattern = new RegExp(`/node_modules/(${shadowTemplatePackages.join('|')})/dist/`);
const shadowTemplateModules = new Set<string>();
const pinInputStyle = '';

type ShadowTemplateElement = { getTemplateHTML: (attributes: Record<string, string>) => string };

const isShadowTemplateElement = (value: unknown): value is ShadowTemplateElement =>
  typeof value === 'function' && 'getTemplateHTML' in value && typeof value.getTemplateHTML === 'function';

const cspManifest = (): Plugin => ({
  name: 'immich:csp-manifest',
  apply: 'build',
  generateBundle(_, bundle) {
    for (const chunk of Object.values(bundle)) {
      for (const id of chunk.type === 'chunk' ? chunk.moduleIds : []) {
        if (shadowTemplateModulePattern.test(id)) {
          shadowTemplateModules.add(id);
        }
      }
    }
  },
  buildApp: {
    order: 'post',
    async handler() {
      const indexHtml = path.join(buildDir, 'index.html');
      const hashes: Record<string, Set<string>> = Object.fromEntries(
        inlineTags.map((tag) => [`${tag}-src`, new Set()]),
      );
      const addHash = (tag: string, content: string) =>
        hashes[`${tag}-src`].add(`'sha256-${createHash('sha256').update(content).digest('base64')}'`);

      const walk = (node: DefaultTreeAdapterMap['node']) => {
        if (
          defaultTreeAdapter.isElementNode(node) &&
          inlineTags.includes(node.tagName) &&
          !node.attrs.some(({ name }) => name === 'src')
        ) {
          const [child] = node.childNodes;
          const content = child && defaultTreeAdapter.isTextNode(child) ? child.value : '';
          addHash(node.tagName, content);
        }

        if ('childNodes' in node) {
          for (const child of node.childNodes) {
            walk(child);
          }
        }
      };

      walk(parse(readFileSync(indexHtml, 'utf8')));
      addHash('style', pinInputStyle);

      for (const id of shadowTemplateModules) {
        for (const value of Object.values(await import(pathToFileURL(id).href))) {
          if (isShadowTemplateElement(value)) {
            walk(parseFragment(value.getTemplateHTML({})));
          }
        }
      }

      const manifest = JSON.stringify(hashes, (_, value) => (value instanceof Set ? [...value] : value), 2);
      writeFileSync(path.join(buildDir, '.csp.json'), manifest + '\n');
    },
  },
});

const notFoundGetLine = /^404 (GET|HEAD) /;

const testing = (): Plugin => ({
  name: 'immich:test',
  apply: () => !!process.env.VITEST,
  configureServer: (server) => {
    const { logger } = server.config;
    const error = logger.error.bind(logger);
    logger.error = (message, options) => {
      if (isUnmockedMediaOrDownload(message)) {
        return;
      }

      error(message, options);
    };
  },
});

const isUnmockedMediaOrDownload = (message: string) => notFoundGetLine.test(stripVTControlCharacters(message));

const upstream = {
  target: process.env.IMMICH_SERVER_URL || 'http://immich-server:2283/',
  secure: true,
  changeOrigin: true,
  logLevel: 'info',
  ws: true,
};

const proxy: Record<string, string | ProxyOptions> = {
  '/api': upstream,
  '/.well-known/immich': upstream,
  '/.well-known/webauthn': upstream,
  '/custom.css': upstream,
};

dotenv.config({ quiet: true });

// #i18n is upstream i18n/ plus the Gallery overlay (i18n/gallery/merged); build it for every tool that loads this config.
writeMergedI18n();
process.env.PUBLIC_IMMICH_BUY_HOST = process.env.PUBLIC_IMMICH_BUY_HOST || 'https://buy.immich.app';
process.env.PUBLIC_IMMICH_PAY_HOST = process.env.PUBLIC_IMMICH_PAY_HOST || 'https://pay.futo.org';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  resolve: {
    alias: {
      'xmlhttprequest-ssl': './node_modules/engine.io-client/lib/xmlhttprequest.js',
    },
  },
  // '@immich/ui': path.resolve(import.meta.dirname, '../../ui/packages/ui'),
  server: {
    // connect to a remote backend during web-only development
    proxy: process.env.VITEST ? {} : proxy,
    // Gallery: no HMR socket per test iframe; hundreds of them in one browser session drop Vitest's own connection.
    hmr: process.env.VITEST ? false : undefined,
    allowedHosts: true,
  },
  preview: {
    proxy,
  },
  plugins: [
    enhancedImages(),
    tailwindcss(),
    sveltekit({
      compilerOptions: {},
      // TODO pending `@immich/ui` to enable it
      // runes: true,
      preprocess: vitePreprocess(),

      version: {
        name: process.env.IMMICH_BUILD || process.env.npm_package_version || 'local',
      },
      paths: { relative: false },
      adapter: adapter({ fallback: 'index.html', precompress: true }),
      onwarn: (warning, handler) => {
        if (warning.code === 'state_referenced_locally') {
          return;
        }

        handler(warning);
      },
      // TODO remove as this way of doing it is deprecated
      alias: {
        'chromecast-caf-sender': './node_modules/@types/chromecast-caf-sender/index.d.ts',
      },
    }),
    galleryI18nVitePlugin(),
    cspManifest(),
    testing(),

    process.env.BUILD_STATS === 'true'
      ? visualizer({
          emitFile: true,
          filename: 'stats.html',
        })
      : undefined,
  ],
  optimizeDeps: {
    entries: ['src/**/*.{svelte,ts,html}'],
  },
  test: {
    globals: true,
    sequence: {
      hooks: 'list',
    },
    env: {
      TZ: 'UTC',
    },
    server: {
      deps: {
        inline: ['@futo-org/backups-orchestrator-ui', '@material-symbols/svg-400'],
      },
    },
    clearMocks: true,
    // Gallery: at most three test iframes at once. With one per core (17 on a large machine) the browser drops
    // Vitest's own connection partway through the suite. CI's 4-core runners get three anyway.
    maxWorkers: 3,
    name: 'web:unit',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['./test/unit/setup.ts', './test/unit/gallery-setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ contextOptions: { timezoneId: 'UTC', locale: 'en-US' } }),
      instances: [{ browser: 'chromium' }],
    },
  },
} as UserConfig);

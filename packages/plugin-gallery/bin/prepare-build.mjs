import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Upstream's five, plus the fork's single generic dispatcher. The first five are declared only so
// that the plugin-sdk `wrapper()` helper behaves identically to upstream's plugin; the shims call
// `gallery` exclusively. Keep in sync with `functions` in workflow-execution.service.ts.
const hostFunctions = [
  'searchAlbums',
  'createAlbum',
  'addAssetsToAlbum',
  'addAssetsToAlbums',
  'httpRequest',
  'gallery',
];

const output = 'dist/index.d.ts';
const content = readFileSync('manifest.json', { encoding: 'utf-8' });
const methods = JSON.parse(content).methods.map(({ name }) => name);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `
declare module 'extism:host' {
  interface user {
${hostFunctions.map((name) => `    ${name}(ptr: PTR): I64;`).join('\n')}
  }
}

declare module 'main' {
${methods.map((method) => `  export function ${method}(): I32;`).join('\n')}
}

export type Manifest = ${content};
`,
);

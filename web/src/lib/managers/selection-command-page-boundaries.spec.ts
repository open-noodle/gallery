import { describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';

const allowedPages = [
  'src/routes/(user)/photos/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  // The search page registers through its fork module.
  'src/lib/gallery/search/search-page.ts',
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte',
];

const deniedPages = [
  'src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/utilities/duplicates/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/utilities/large-files/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'src/routes/(user)/memories/[id]/[[photos=photos]]/[[assetId=id]]/+page.svelte',
];

// Paths are relative to web/.
const read = (path: string) => commands.readFile(path);

describe('v1.5A selection command page boundaries', () => {
  it('registers selection context only on approved pages in this slice', async () => {
    for (const path of allowedPages) {
      expect(await read(path), `${path} should register v1.5A selection context`).toContain('registerSelectionContext');
    }
    for (const path of deniedPages) {
      expect(await read(path), `${path} is out of scope for v1.5A`).not.toContain('registerSelectionContext');
    }
  });
});

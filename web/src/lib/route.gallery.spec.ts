describe('Route.search call sites', () => {
  // The specs run in the browser, so the sources come in through Vite as raw text. Keys are
  // root-relative (`/src/lib/route.ts`); SRC_ROOT is stripped to match the paths below.
  const SRC_ROOT = '/src/';
  const SOURCES = import.meta.glob<string>('/src/**/*.{ts,svelte}', { query: '?raw', import: 'default' });

  // Every in-app link to the deprecated /search page. The page itself is kept as a landing page
  // for old bookmarks, but nothing new may point at it: a palette/search-bar result belongs on
  // the surface it has context of (#922). This is a SUBSET assertion, so PRs that remove a call
  // site (#778 for the info panel, #884 for the Explore/Places tiles) do not have to edit it.
  // If this fails, the fix is almost never to add the new file here — it's to route the result
  // contextually (filter the surface the user is already on), the way Tasks 2-5 did for the
  // palette. Only extend the allowlist for a genuinely new, deliberate landing-page-style link.
  // The check is a literal substring match on `Route.search`, not an AST or type-aware scan: it
  // does not catch computed access (`Route['search'](...)`) or an aliased import
  // (`import { Route as R } from '#lib/route.ts'; R.search(...)`). Neither shape exists in web/src
  // today; if one appears, this guard will not see it.
  const ALLOWED = new Set([
    'lib/components/asset-viewer/DetailPanel.svelte',
    'lib/services/asset.service.ts',
    // Full paths use the existing metadata results page: timeline buckets have no path predicate.
    'lib/gallery/search/full-path-search.ts',
    'routes/(user)/explore/+page.svelte',
    'routes/(user)/places/PlacesCardGroup.svelte',
    'routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  ]);

  // Loads the sources in parallel: each one is a request to Vite, and one at a time takes longer than the test
  // timeout when the whole suite runs.
  async function walk(): Promise<string[]> {
    const entries = Object.entries(SOURCES).filter(([file]) => !/\.spec\.ts$/.test(file));
    const sources = await Promise.all(entries.map(([file, load]) => load().then((source) => [file, source] as const)));
    // Anchored so a local like `previousRoute.search` cannot masquerade as `Route.search`
    // — a plain substring match reads the tail of any identifier ending in `Route`.
    return sources
      .filter(([, source]) => /(?<![A-Za-z0-9_$])Route\.search\b/.test(source))
      .map(([file]) => file.slice(SRC_ROOT.length));
  }

  // Upstream's own search UI is carried dormant — present, byte-identical to upstream, and never
  // mounted — so that upstream's search commits auto-merge instead of conflicting. See
  // lib/components/shared-components/search-bar/DORMANT.md. Its `Route.search` calls are not
  // in-app links, because nothing in the fork imports those files. They are excluded rather than
  // allowlisted, so that a real new call site in live code still fails this guard.
  const DORMANT = ['lib/components/shared-components/search-bar/', 'lib/managers/search-manager.svelte.ts'];

  it('are a subset of the allowlist', async () => {
    const found = await walk();
    // Control on the scan itself: the allowlisted call sites are found.
    expect(found).toContain('lib/services/asset.service.ts');
    const unexpected = found
      .filter((file) => DORMANT.every((prefix) => !file.startsWith(prefix)))
      .filter((file) => !ALLOWED.has(file));

    expect(unexpected).toEqual([]);
  }, 60_000);
});

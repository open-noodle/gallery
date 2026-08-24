import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { OpenQueryParam } from '$lib/constants';
import { Route } from '$lib/route';

describe('Route', () => {
  describe(Route.login.name, () => {
    it('should encode continue', () => {
      expect(Route.login({ continue: '/some/path?with=query', autoLaunch: 1 })).toBe(
        '/auth/login?continue=%2Fsome%2Fpath%3Fwith%3Dquery&autoLaunch=1',
      );
    });
  });

  describe(Route.search.name, () => {
    it('should work', () => {
      expect(Route.search({})).toBe('/search');
    });

    it('should work', () => {
      expect(Route.search({ make: undefined, model: 'Immich' })).toBe('/search?query=%7B%22model%22%3A%22Immich%22%7D');
    });

    it('should support query parameters', () => {
      expect(Route.systemSettings({ isOpen: OpenQueryParam.OAUTH })).toBe('/admin/system-settings?isOpen=oauth');
    });
  });

  describe(Route.viewSharedLink.name, () => {
    it('should work with key', () => {
      expect(Route.viewSharedLink({ key: 'uuid-key' })).toBe('/share/uuid-key');
    });

    it('should work with key and slug', () => {
      expect(Route.viewSharedLink({ key: 'uuid-key', slug: 'custom-slug' })).toBe('/s/custom-slug');
    });

    it('should URI encode slug', () => {
      expect(Route.viewSharedLink({ key: 'uuid-key', slug: 'albums/the-moon?' })).toBe('/s/albums%2Fthe-moon%3F');
    });
  });

  describe(Route.memories.name, () => {
    it('should link to the memories index', () => {
      expect(Route.memories()).toBe('/memories');
    });
  });

  describe(Route.tags.name, () => {
    it('should work', () => {
      expect(Route.tags()).toBe('/tags');
    });

    it('should support query parameters', () => {
      expect(Route.tags({ path: '/some/path' })).toBe('/tags?path=%2Fsome%2Fpath');
    });

    it('should ignore an empty path', () => {
      expect(Route.tags({ path: '' })).toBe('/tags');
    });
  });

  describe(Route.systemSettings.name, () => {
    it('should work', () => {
      expect(Route.systemSettings()).toBe('/admin/system-settings');
    });

    it('should support query parameters', () => {
      expect(Route.systemSettings({ isOpen: OpenQueryParam.OAUTH })).toBe('/admin/system-settings?isOpen=oauth');
    });
  });

  describe(Route.continue.name, () => {
    beforeEach(() => {
      // @ts-expect-error - override location for testing
      // eslint-disable-next-line unicorn/no-global-object-property-assignment
      globalThis.location = new URL('https://my.immich.server');
      vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://my.immich.server/');
    });

    it('should resolve relative URLs', () => {
      expect(Route.continue('/some/path', '/fallback')).property('href', 'https://my.immich.server/some/path');
    });

    it('should resolve absolute URLs on the same origin', () => {
      expect(Route.continue('https://my.immich.server/some/path', '/fallback')).property(
        'href',
        'https://my.immich.server/some/path',
      );
    });

    it('should return fallback for absolute URLs on a different origin', () => {
      expect(Route.continue('https://malicious.site/evil', '/fallback')).toBe('/fallback');
    });

    it('should return fallback for null URLs', () => {
      expect(Route.continue(null, '/fallback')).property('href', 'https://my.immich.server/fallback');
    });

    it('should block javascript: URLs', () => {
      expect(Route.continue('javascript:alert(1)', '/fallback')).toBe('/fallback');
    });

    it(String.raw`should block \/ URLs`, () => {
      expect(Route.continue(String.raw`\/malicious.com`, '/fallback')).toBe('/fallback');
    });
  });

  describe(Route.photos.name, () => {
    it('should work', () => {
      expect(Route.photos()).toBe('/photos');
    });

    // #867: place tiles now land on the filtered timeline instead of the deprecated /search view.
    it('should support a city filter', () => {
      expect(Route.photos({ city: 'Cape Town' })).toBe('/photos?city=Cape%20Town');
    });

    it('should ignore an empty city', () => {
      expect(Route.photos({ city: '' })).toBe('/photos');
    });

    // #989: a city alone lands in the location filter as an ORPHAN — the panel has no country to
    // nest it under, so it renders flat beside the countries. Carrying the country makes the panel
    // expand that country and select the city inside it.
    it('should support a city scoped to its country', () => {
      expect(Route.photos({ city: 'Cape Town', country: 'South Africa' })).toBe(
        '/photos?city=Cape%20Town&country=South%20Africa',
      );
    });

    it('should ignore an empty country', () => {
      expect(Route.photos({ city: 'Cape Town', country: '' })).toBe('/photos?city=Cape%20Town');
    });

    // The param order is fixed by the route helper, not by the caller's object literal, so the two
    // call sites (#989: the Explore strip and the Places grid) cannot drift apart.
    it('should emit a stable param order regardless of the caller key order', () => {
      expect(Route.photos({ country: 'South Africa', city: 'Cape Town' })).toBe(
        '/photos?city=Cape%20Town&country=South%20Africa',
      );
    });
  });

  describe('viewSpaceAlbum', () => {
    it('links to an album inside a space', () => {
      expect(Route.viewSpaceAlbum({ spaceId: 'space-1', albumId: 'album-2' })).toBe('/spaces/space-1/albums/album-2');
    });

    it('links to a space albums tab', () => {
      expect(Route.viewSpaceAlbums({ id: 'space-1' })).toBe('/spaces/space-1/albums');
    });
  });

  describe(Route.map.name, () => {
    it('emits a bare /map with no arguments', () => {
      expect(Route.map()).toBe('/map');
    });

    it('emits only the viewport hash when given a point', () => {
      expect(Route.map({ zoom: 12, lat: 52.52, lng: 13.4 })).toBe('/map#12/52.52/13.4');
    });

    // E11 — query AND hash together. The map keeps its viewport in the hash and its scope/filters in
    // the query; before this, Route.map could only emit the hash.
    it('E11: emits query params and the viewport hash together', () => {
      const url = Route.map({
        zoom: 12,
        lat: 52.52,
        lng: 13.4,
        spaceId: 'space-1',
        query: 'ski',
        filters: { ...createFilterState(), make: 'Apple', rating: 4 },
      });

      expect(url).toBe('/map?spaceId=space-1&q=ski&make=Apple&rating=4#12/52.52/13.4');
    });

    // E10 — a pin dropped from inside a Space carries the space AND the active filters.
    it('E10: carries spaceId and filters without a point', () => {
      const url = Route.map({
        spaceId: 'space-1',
        filters: { ...createFilterState(), personIds: ['space-person:p1'] },
      });

      expect(url).toBe('/map?spaceId=space-1&people=space-person%3Ap1');
    });

    it('omits an empty query and an empty filter state', () => {
      expect(Route.map({ spaceId: 'space-1', query: ' '.repeat(3), filters: createFilterState() })).toBe(
        '/map?spaceId=space-1',
      );
    });
  });
});

describe('Route.search call sites', () => {
  // web/src/lib/ -> up 1 -> web/src
  const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  // Every in-app link to the deprecated /search page. The page itself is kept as a landing page
  // for old bookmarks, but nothing new may point at it: a palette/search-bar result belongs on
  // the surface it has context of (#922). This is a SUBSET assertion, so PRs that remove a call
  // site (#778 for the info panel, #884 for the Explore/Places tiles) do not have to edit it.
  // If this fails, the fix is almost never to add the new file here — it's to route the result
  // contextually (filter the surface the user is already on), the way Tasks 2-5 did for the
  // palette. Only extend the allowlist for a genuinely new, deliberate landing-page-style link.
  // The check is a literal substring match on `Route.search`, not an AST or type-aware scan: it
  // does not catch computed access (`Route['search'](...)`) or an aliased import
  // (`import { Route as R } from '$lib/route'; R.search(...)`). Neither shape exists in web/src
  // today; if one appears, this guard will not see it.
  const ALLOWED = new Set([
    'lib/components/asset-viewer/DetailPanel.svelte',
    'lib/services/asset.service.ts',
    'routes/(user)/explore/+page.svelte',
    'routes/(user)/places/PlacesCardGroup.svelte',
    'routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  ]);

  function walk(dir: string, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, found);
        continue;
      }
      if (!/\.(ts|svelte)$/.test(name) || /\.spec\.ts$/.test(name)) {
        continue;
      }
      // Anchored so a local like `previousRoute.search` cannot masquerade as `Route.search`
      // — a plain substring match reads the tail of any identifier ending in `Route`.
      if (/(?<![A-Za-z0-9_$])Route\.search\b/.test(readFileSync(full, 'utf8'))) {
        found.push(relative(SRC_ROOT, full));
      }
    }
    return found;
  }

  // Upstream's own search UI is carried dormant — present, byte-identical to upstream, and never
  // mounted — so that upstream's search commits auto-merge instead of conflicting. See
  // lib/components/shared-components/search-bar/DORMANT.md. Its `Route.search` calls are not
  // in-app links, because nothing in the fork imports those files. They are excluded rather than
  // allowlisted, so that a real new call site in live code still fails this guard.
  const DORMANT = ['lib/components/shared-components/search-bar/', 'lib/managers/search-manager.svelte.ts'];

  it('are a subset of the allowlist', () => {
    const unexpected = walk(SRC_ROOT)
      .filter((file) => DORMANT.every((prefix) => !file.startsWith(prefix)))
      .filter((file) => !ALLOWED.has(file));

    expect(unexpected).toEqual([]);
  });
});

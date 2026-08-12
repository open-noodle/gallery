import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import {
  applyContextualFilter,
  buildContextualFilterUrl,
  buildContextualMapUrl,
  buildFilterStateUrl,
  buildPersonFilterPatch,
  isFilterStateUrlUnchanged,
  resolveFilterTarget,
} from '$lib/utils/filter-target';
import { getPhotosPersonFilterId } from '$lib/utils/photos-filter-options';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('$app/navigation', () => ({
  goto: gotoMock,
}));

// applyContextualFilter reads the reactive `page` from `$app/state` — see reactive-page.mock's own
// docs for why this needs to be a real $state object rather than a plain vi.hoisted literal.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

const u = (path: string) => new URL(`https://g.test${path}`);

describe('resolveFilterTarget', () => {
  it('resolves /photos, with or without an open asset', () => {
    expect(resolveFilterTarget(u('/photos'))).toMatchObject({ kind: 'photos', basePath: '/photos' });
    expect(resolveFilterTarget(u('/photos/asset-1'))).toMatchObject({ kind: 'photos', basePath: '/photos' });
  });

  it('resolves a space, with or without an open asset', () => {
    expect(resolveFilterTarget(u('/spaces/s1'))).toMatchObject({ kind: 'space', spaceId: 's1' });
    expect(resolveFilterTarget(u('/spaces/s1/photos/a1'))).toMatchObject({ kind: 'space', spaceId: 's1' });
  });

  it('resolves an album, with or without an open asset', () => {
    expect(resolveFilterTarget(u('/albums/al1'))).toMatchObject({ kind: 'album', albumId: 'al1' });
    expect(resolveFilterTarget(u('/albums/al1/photos/a1'))).toMatchObject({ kind: 'album', albumId: 'al1' });
  });

  // E23 — /map is a filter target too
  it('E23: resolves the map, carrying its spaceId', () => {
    expect(resolveFilterTarget(u('/map'))).toMatchObject({ kind: 'map', basePath: '/map' });
    expect(resolveFilterTarget(u('/map/photos/a1?spaceId=s1'))).toMatchObject({ kind: 'map', spaceId: 's1' });
  });

  // E3 — non-filterable surfaces
  it('E3: returns null for surfaces with no filterable timeline', () => {
    for (const path of [
      '/favorites',
      '/archive',
      '/trash',
      '/folders',
      '/memories',
      '/search',
      '/people/p1',
      '/tags/x',
    ]) {
      expect(resolveFilterTarget(u(path)), path).toBeNull();
    }
  });
});

describe('buildContextualFilterUrl', () => {
  it('merges the patch into the current filters, preserving the others', () => {
    const url = buildContextualFilterUrl(u('/spaces/s1/photos/a1?people=person:p1'), {
      make: 'Apple',
      model: 'iPhone 17 Pro Max',
    });

    expect(url).toContain('/spaces/s1');
    expect(url).toContain('people=person%3Ap1');
    expect(url).toContain('make=Apple');
  });

  it('closes the asset viewer by targeting the base path', () => {
    expect(buildContextualFilterUrl(u('/photos/asset-1'), { make: 'Apple' })).not.toContain('asset-1');
  });

  it('preserves an active search query and sort', () => {
    const url = buildContextualFilterUrl(u('/photos?q=beach&sort=asc'), { make: 'Apple' });

    expect(url).toContain('q=beach');
    expect(url).toContain('sort=asc');
  });

  // E25 — arrays replace, never append
  it('E25: replaces the tag array rather than appending', () => {
    const url = buildContextualFilterUrl(u('/photos?tags=beach'), { tagIds: ['sunset'] });

    expect(url).toContain('tags=sunset');
    expect(url).not.toContain('beach');
  });

  it('E25: replaces the person array rather than appending', () => {
    const url = buildContextualFilterUrl(u('/photos?people=person:anna'), { personIds: ['person:ben'] });

    expect(url).toContain('people=person%3Aben');
    expect(url).not.toContain('anna');
  });

  // E24 — clicking the same value twice is a no-op.
  //
  // Assert the IDEMPOTENCE PROPERTY f(f(u)) === f(u), not string equality against the original
  // URL. The encoder re-emits filter params in its own canonical order, so `/photos?model=X&make=Y`
  // legitimately normalises to `/photos?make=Y&model=X`. A string-equality test against the raw
  // input would only pass when the fixture happens to already be in canonical order — it would be
  // green by luck, not by design.
  it('E24: applying the same patch twice is idempotent', () => {
    const patch = { make: 'Apple', model: 'iPhone 17 Pro Max' };
    const once = buildContextualFilterUrl(u('/photos?model=iPhone%2017%20Pro%20Max&make=Apple'), patch);
    const twice = buildContextualFilterUrl(new URL(`https://g.test${once}`), patch);

    expect(twice).toBe(once);
  });

  it('drops the one-shot `at` scroll target', () => {
    expect(buildContextualFilterUrl(u('/photos?at=asset-9'), { make: 'Apple' })).not.toContain('at=');
  });

  it('preserves non-filter params such as view and panel', () => {
    const url = buildContextualFilterUrl(u('/photos?view=timeline'), { make: 'Apple' });

    expect(url).toContain('view=timeline');
    expect(url).toContain('make=Apple');
  });

  // D2 — a behaviour change that falls out of putting year/month in the codec. buildContextualFilterUrl
  // merges decodeFilterParams(url) under the patch, so the picked year is now carried over by a
  // contextual-filter click (e.g. "show me this camera") where it used to be silently dropped.
  it('D2: preserves an active year/month when applying a contextual patch', () => {
    const url = buildContextualFilterUrl(u('/photos?year=2023&month=6'), { make: 'Apple' });

    expect(url).toContain('year=2023');
    expect(url).toContain('month=6');
    expect(url).toContain('make=Apple');
  });

  it('D2: a patch that sets an explicit date range evicts the year (from/to wins)', () => {
    const url = buildContextualFilterUrl(u('/photos?year=2023'), { dateAfter: '2024-01-01' });

    expect(url).toContain('from=2024-01-01');
    expect(url).not.toContain('year=');
  });

  it('D2: global: true does not carry the year over', () => {
    const url = buildContextualFilterUrl(u('/photos?year=2023'), { make: 'Apple' }, { global: true });

    expect(url).not.toContain('year=');
    expect(url).toContain('make=Apple');
  });

  // E5 / global — escape the current context, starting from a clean slate
  it('global: true targets /photos and carries NOTHING over — not filters, not the query', () => {
    const url = buildContextualFilterUrl(
      u('/spaces/s1/photos/a1?q=beach&sort=asc&people=space-person:p1&city=Berlin'),
      { make: 'Apple' },
      { global: true },
    );

    expect(url).toContain('/photos');
    expect(url).not.toContain('/spaces');
    expect(url).toContain('make=Apple');
    // A space-scoped person token matches nothing on /photos.
    expect(url).not.toContain('space-person');
    expect(url).not.toContain('city=Berlin');
    // "Search everywhere for THIS camera" is a NEW search, not the old one plus a camera.
    expect(url).not.toContain('q=');
  });

  // E3 — fallback
  it('E3: falls back to /photos from a non-filterable surface', () => {
    const url = buildContextualFilterUrl(u('/favorites/a1'), { make: 'Apple' });

    expect(url).toContain('/photos');
    expect(url).toContain('make=Apple');
  });

  it('keeps the map on the map, preserving its spaceId', () => {
    const url = buildContextualFilterUrl(u('/map/photos/a1?spaceId=s1'), { make: 'Apple' });

    expect(url).toContain('/map');
    expect(url).toContain('spaceId=s1');
    expect(url).toContain('make=Apple');
  });

  // The map stores its viewport in the hash. Losing it resets the map on every filter click.
  it('preserves the map viewport hash', () => {
    const url = buildContextualFilterUrl(u('/map/photos/a1?spaceId=s1#12.5/52.52/13.40'), { make: 'Apple' });

    expect(url).toContain('#12.5/52.52/13.40');
  });

  it('does not leak a hash onto non-map surfaces', () => {
    expect(buildContextualFilterUrl(u('/photos/a1#foo'), { make: 'Apple' })).not.toContain('#');
  });
});

// applyContextualFilter is the navigating wrapper — Task 1 of Slice 7 (R1). It did not exist before
// this: only the pure buildContextualFilterUrl shipped in Slice 2. Kept thin on purpose, so these
// tests are about the WIRING (does it read page.url, forward opts, and call goto with the exact
// result), not the merge/target logic already covered above.
describe('buildContextualMapUrl', () => {
  // A space-scoped map cannot represent an album filter: space ∩ album is unsatisfiable and the
  // server 400s it (hydrateMapFilters drops albumId there). So the 🗺️ pin, which carries the
  // active filters from a Space over to the map, must NOT let albumId ride along.
  it('drops an active albumId when carrying a Space scope to the map', () => {
    const url = buildContextualMapUrl(u('/spaces/s1/photos/a1?albumId=al1'));
    expect(url).not.toBeNull();
    expect(url).toContain('spaceId=s1');
    expect(url).not.toContain('albumId');
  });

  // The reverse guard: a NON-space map is a legitimate home for an album scope (/map?albumId=X),
  // so the pin must keep albumId when there is no Space in play.
  it('keeps an albumId when the target map is not space-scoped', () => {
    const url = buildContextualMapUrl(u('/photos/a1?albumId=al1'));
    expect(url).not.toBeNull();
    expect(url).toContain('albumId=al1');
    expect(url).not.toContain('spaceId');
  });
});

describe('applyContextualFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.reset('https://g.test/photos');
  });

  it('goto()s exactly the URL that buildContextualFilterUrl(page.url, patch, opts) returns', () => {
    mockPage.reset('https://g.test/spaces/s1/photos/a1?people=person:p1');
    const patch = { make: 'Apple', model: 'iPhone 17 Pro Max' };

    applyContextualFilter(patch);

    const expected = buildContextualFilterUrl(mockPage.url, patch);
    expect(gotoMock).toHaveBeenCalledTimes(1);
    expect(gotoMock).toHaveBeenCalledWith(expected);
  });

  // global: true escapes to /photos and carries NOTHING over — not filters, not q, not sort.
  it('{ global: true } lands on /photos, carrying nothing over', () => {
    mockPage.reset('https://g.test/spaces/s1/photos/a1?q=beach&sort=asc&people=space-person:p1&city=Berlin');

    applyContextualFilter({ make: 'Apple' }, { global: true });

    expect(gotoMock).toHaveBeenCalledWith('/photos?make=Apple');
  });

  // A single goto() must close the asset viewer: the target is the surface's BASE path, which
  // never contains the open assetId.
  it("navigates to the surface's base path, closing the asset viewer in one goto()", () => {
    mockPage.reset('https://g.test/photos/asset-1');

    applyContextualFilter({ make: 'Apple' });

    const [url] = gotoMock.mock.calls[0] as [string];
    expect(url).not.toContain('asset-1');
    expect(url.startsWith('/photos')).toBe(true);
  });

  // E24 — clicking the same value twice must be a no-op, not a toggle. Removal is the chip's ✕.
  it('E24: applying the same patch twice produces the identical URL (idempotent, not a toggle)', () => {
    mockPage.reset('https://g.test/photos');
    const patch = { make: 'Apple', model: 'iPhone 17 Pro Max' };

    applyContextualFilter(patch);
    const [firstUrl] = gotoMock.mock.calls[0] as [string];

    mockPage.reset(`https://g.test${firstUrl}`);
    applyContextualFilter(patch);
    const [secondUrl] = gotoMock.mock.calls[1] as [string];

    expect(secondUrl).toBe(firstUrl);
  });

  // E3 — a non-filterable surface (resolveFilterTarget returns null) must not throw; it falls back
  // to /photos.
  it('does not throw from a non-filterable surface, falling back to /photos', () => {
    mockPage.reset('https://g.test/favorites/asset-1');

    expect(() => applyContextualFilter({ make: 'Apple' })).not.toThrow();
    expect(gotoMock).toHaveBeenCalledWith('/photos?make=Apple');
  });
});

// R8 — the single most dangerous patch in the slice. The Space timeline sends FilterState.personIds
// as `spacePersonIds`, which the server validates as `z.array(z.uuidv4())` — a BARE uuid, never a
// scoped token. Sending `space-person:<uuid>` there is a zod reject → 400 → the whole Space timeline
// errors out. Everywhere else `personIds` is the field, and it is the ONLY one that accepts the
// scoped token — which is also the only id a viewer of a shared-space asset can resolve on /photos.
describe('buildPersonFilterPatch', () => {
  const SPACE_ASSET_PERSON = {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    spacePersonId: 'f0f0f0f0-0000-4000-8000-000000000002',
  };
  const OWN_PERSON = { id: 'a1b2c3d4-0000-4000-8000-000000000003' };
  const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

  it('emits the BARE spacePersonId in a Space (a scoped token there is a 400, not a miss)', () => {
    const patch = buildPersonFilterPatch(u('/spaces/space-1/photos/asset-1'), SPACE_ASSET_PERSON);

    expect(patch).toEqual({ personIds: [SPACE_ASSET_PERSON.spacePersonId] });
    expect(patch?.personIds?.[0]).toMatch(UUID);
    expect(patch?.personIds?.[0]).not.toContain('space-person:');
  });

  it('emits the BARE spacePersonId on the SPACE map (spacePersonIds again — map-filter-options:111)', () => {
    const patch = buildPersonFilterPatch(u('/map/photos/asset-1?spaceId=space-1'), SPACE_ASSET_PERSON);

    expect(patch).toEqual({ personIds: [SPACE_ASSET_PERSON.spacePersonId] });
    expect(patch?.personIds?.[0]).toMatch(UUID);
  });

  // The affordance would be a lie: there is no bare space-person uuid to filter the Space by, and
  // the owner's person uuid is not a space-person row — it would silently return nothing.
  it('returns null in a Space when the person carries no spacePersonId', () => {
    expect(buildPersonFilterPatch(u('/spaces/space-1/photos/asset-1'), OWN_PERSON)).toBeNull();
    expect(buildPersonFilterPatch(u('/map/photos/asset-1?spaceId=space-1'), OWN_PERSON)).toBeNull();
  });

  it('emits the SCOPED token for a space asset off the Space (photos / album / global map)', () => {
    const scoped = `space-person:${SPACE_ASSET_PERSON.spacePersonId}`;

    expect(buildPersonFilterPatch(u('/photos/asset-1'), SPACE_ASSET_PERSON)).toEqual({ personIds: [scoped] });
    expect(buildPersonFilterPatch(u('/albums/album-1/photos/asset-1'), SPACE_ASSET_PERSON)).toEqual({
      personIds: [scoped],
    });
    expect(buildPersonFilterPatch(u('/map/photos/asset-1'), SPACE_ASSET_PERSON)).toEqual({ personIds: [scoped] });
  });

  // The bare uuid the server ACCEPTS is not the id the surface's own filter options are keyed by:
  // /photos, an album, the global map and Recently Added all build their people options — and their
  // personNames map — with `getPhotosPersonFilterId`, which emits `person:<uuid>`. A bare uuid
  // therefore filters correctly but matches no option: the chip degrades to a raw UUID and the panel
  // renders a SECOND, orphaned UUID row next to the named one it should have ticked.
  it('emits the SCOPED person token for an own person off the Space (so the chip and panel can name it)', () => {
    const scoped = `person:${OWN_PERSON.id}`;

    expect(buildPersonFilterPatch(u('/photos/asset-1'), OWN_PERSON)).toEqual({ personIds: [scoped] });
    expect(buildPersonFilterPatch(u('/albums/album-1/photos/asset-1'), OWN_PERSON)).toEqual({
      personIds: [scoped],
    });
    expect(buildPersonFilterPatch(u('/map/photos/asset-1'), OWN_PERSON)).toEqual({ personIds: [scoped] });
    expect(buildPersonFilterPatch(u('/recently-added/photos/asset-1'), OWN_PERSON)).toEqual({ personIds: [scoped] });
  });

  it('emits the token that getPhotosPersonFilterId derives for the SAME person', () => {
    const patch = buildPersonFilterPatch(u('/photos/asset-1'), OWN_PERSON)!;

    expect(patch.personIds).toEqual([
      getPhotosPersonFilterId({ id: OWN_PERSON.id, primaryProfile: { type: 'user-person', id: OWN_PERSON.id } }),
    ]);
  });

  it('emits the token that getPhotosPersonFilterId derives for the same SPACE person', () => {
    const patch = buildPersonFilterPatch(u('/photos/asset-1'), SPACE_ASSET_PERSON)!;

    expect(patch.personIds).toEqual([
      getPhotosPersonFilterId({
        id: SPACE_ASSET_PERSON.id,
        primaryProfile: { type: 'space-person', id: SPACE_ASSET_PERSON.spacePersonId, spaceId: 'space-1' },
      }),
    ]);
  });

  // A non-filterable surface falls back to /photos (buildContextualFilterUrl's own fallback), so it
  // must use the /photos shape, not the Space one.
  it('uses the /photos shape on a non-filterable surface', () => {
    expect(buildPersonFilterPatch(u('/favorites/asset-1'), SPACE_ASSET_PERSON)).toEqual({
      personIds: [`space-person:${SPACE_ASSET_PERSON.spacePersonId}`],
    });
  });

  // E25 — the array is REPLACED, never appended: personIds is AND-ed server-side, so appending two
  // adjacent chips of the same panel would narrow to the intersection instead of switching.
  it('E25: always emits a SINGLE id, replacing whatever was there', () => {
    const url = new URL('https://g.test/photos/asset-1?people=other-person');
    const patch = buildPersonFilterPatch(url, OWN_PERSON)!;

    expect(patch.personIds).toEqual([`person:${OWN_PERSON.id}`]);
    expect(buildContextualFilterUrl(url, patch)).toContain(`people=person%3A${OWN_PERSON.id}`);
    expect(buildContextualFilterUrl(url, patch)).not.toContain('other-person');
  });
});

describe('buildFilterStateUrl', () => {
  const state = (overrides: Partial<FilterState> = {}): FilterState => ({ ...createFilterState(), ...overrides });

  it('writes the complete state into the current path', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1'), state({ make: 'Apple', rating: 4 }));

    expect(url).toContain('/albums/al1');
    expect(url).toContain('make=Apple');
    expect(url).toContain('rating=4');
  });

  // THE anti-merge test. buildContextualFilterUrl would keep `rating=4` here, because it decodes
  // the URL first and merges. A complete state must REPLACE: a field the caller cleared has to
  // disappear from the URL, or a filter could never be removed.
  it('drops filter params that are absent from the state (replace, never merge)', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1?make=Apple&rating=4'), state({ make: 'Apple' }));

    expect(url).toContain('make=Apple');
    expect(url).not.toContain('rating');
  });

  it('clears every filter param for an empty state', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1?make=Apple&people=person:p1'), state());

    expect(url).toBe('/albums/al1');
  });

  it('keeps non-filter params (q, sort, spaceId, view)', () => {
    const url = buildFilterStateUrl(
      new URL('https://g.test/map?spaceId=s1&q=ski&sort=asc&view=timeline'),
      state({ make: 'Apple' }),
    );

    expect(url).toContain('spaceId=s1');
    expect(url).toContain('q=ski');
    expect(url).toContain('sort=asc');
    expect(url).toContain('view=timeline');
    expect(url).toContain('make=Apple');
  });

  it('drops the one-shot `at` scroll target', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1?at=asset-9'), state({ make: 'Apple' }));

    expect(url).not.toContain('at=');
  });

  // The map stores its viewport in the hash. Losing it re-centres the map on every filter change.
  it('preserves the hash', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/map?spaceId=s1#12.5/52.52/13.4'), state({ make: 'Apple' }));

    expect(url).toBe('/map?spaceId=s1&make=Apple#12.5/52.52/13.4');
  });

  // The write-back loop can fire while the asset viewer is open; it must not close it. (This is the
  // deliberate difference from buildContextualFilterUrl, which targets the BASE path precisely so a
  // single goto() both closes the viewer and applies the filter.)
  it('keeps the current path, including an open asset viewer', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1/photos/asset-1'), state({ make: 'Apple' }));

    expect(url).toBe('/albums/al1/photos/asset-1?make=Apple');
  });

  it('is idempotent', () => {
    const filters = state({ make: 'Apple', model: 'iPhone 17 Pro Max', tagIds: ['t1'] });
    const once = buildFilterStateUrl(new URL('https://g.test/albums/al1?rating=4'), filters);
    const twice = buildFilterStateUrl(new URL(`https://g.test${once}`), filters);

    expect(twice).toBe(once);
  });
});

describe('isFilterStateUrlUnchanged', () => {
  const state = (overrides: Partial<FilterState> = {}): FilterState => ({ ...createFilterState(), ...overrides });

  it('is true when the rebuilt URL is identical', () => {
    const url = new URL('https://g.test/map?spaceId=s1&make=Apple');

    expect(isFilterStateUrlUnchanged(url, buildFilterStateUrl(url, state({ make: 'Apple' })))).toBe(true);
  });

  // THE reason this function exists. buildFilterStateUrl deletes the filter params and re-appends
  // them last, so `?make=Apple&spaceId=s1` comes back as `?spaceId=s1&make=Apple` — a different
  // string with the same meaning. A raw string compare would report "changed" and burn a spurious
  // replaceState on the first panel interaction.
  it('is true when only the param ORDER differs', () => {
    const url = new URL('https://g.test/map?make=Apple&spaceId=s1');
    const next = buildFilterStateUrl(url, state({ make: 'Apple' }));

    expect(next).toBe('/map?spaceId=s1&make=Apple'); // re-ordered, on purpose
    expect(next).not.toBe(url.pathname + url.search + url.hash); // …so a string compare would lie
    expect(isFilterStateUrlUnchanged(url, next)).toBe(true);
  });

  it('is false when a filter param is added, changed or removed', () => {
    const url = new URL('https://g.test/map?spaceId=s1&make=Apple');

    expect(isFilterStateUrlUnchanged(url, '/map?spaceId=s1&make=Apple&rating=4')).toBe(false);
    expect(isFilterStateUrlUnchanged(url, '/map?spaceId=s1&make=Canon')).toBe(false);
    expect(isFilterStateUrlUnchanged(url, '/map?spaceId=s1')).toBe(false);
  });

  // `at` is dropped by buildFilterStateUrl. That IS a change worth navigating for — the one-shot
  // scroll target must not survive a filter change.
  it('is false when the one-shot `at` param is dropped', () => {
    const url = new URL('https://g.test/albums/al1?at=asset-9&make=Apple');

    expect(isFilterStateUrlUnchanged(url, buildFilterStateUrl(url, state({ make: 'Apple' })))).toBe(false);
  });

  it('is false when the path or the hash differs', () => {
    const url = new URL('https://g.test/map?spaceId=s1#12/52.52/13.4');

    expect(isFilterStateUrlUnchanged(url, '/albums/al1?spaceId=s1#12/52.52/13.4')).toBe(false);
    expect(isFilterStateUrlUnchanged(url, '/map?spaceId=s1')).toBe(false);
  });

  // The free-text filters (description, filename, ocr) may contain `&` and `=`. Canonicalising by
  // joining raw values would let ONE entry impersonate TWO — the single description below would
  // read as `description=x` plus `make=Apple` — and the guard would swallow a real filter change.
  it('is false when a free-text value merely looks like a second param', () => {
    const url = new URL('https://g.test/photos');
    url.searchParams.set('description', 'x&make=Apple');

    expect(isFilterStateUrlUnchanged(url, '/photos?description=x&make=Apple')).toBe(false);
  });
});

import { goto } from '$app/navigation';
import { page } from '$app/state';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { Route } from '$lib/route';
import { clearFilterParams, decodeFilterParams, encodeFilterParams } from '$lib/utils/filter-url';
import { storeTypedSearchNames } from '$lib/utils/typed-search/typed-search-name-cache';

export type FilterTarget =
  | { kind: 'photos'; basePath: '/photos' }
  | { kind: 'space'; basePath: string; spaceId: string }
  | { kind: 'album'; basePath: string; albumId: string }
  | { kind: 'map'; basePath: '/map'; spaceId?: string };

/**
 * Which timeline surface is this URL on, for the purpose of contextual filtering?
 *
 * Deliberately SEPARATE from `getSearchablePageBasePath` in searchable-page-search.ts, which
 * answers a different question ("can ⌘K run a text query here?"). The two overlap but do not
 * coincide: a space ALBUM is a searchable page yet has no FilterTarget of its own, and /map is a
 * FilterTarget that is not searchable. Keep them independent.
 */
export function resolveFilterTarget(url: URL): FilterTarget | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const [root, id, sub] = parts;

  if (root === 'photos') {
    return { kind: 'photos', basePath: '/photos' };
  }

  if (root === 'map') {
    const spaceId = url.searchParams.get('spaceId') ?? undefined;
    return { kind: 'map', basePath: '/map', spaceId };
  }

  // /spaces/{id}, /spaces/{id}/photos, /spaces/{id}/photos/{assetId}
  if (root === 'spaces' && id && (sub === undefined || sub === 'photos')) {
    return { kind: 'space', basePath: `/spaces/${id}`, spaceId: id };
  }

  // /albums/{id}, /albums/{id}/photos, /albums/{id}/photos/{assetId}
  if (root === 'albums' && id && (sub === undefined || sub === 'photos')) {
    return { kind: 'album', basePath: `/albums/${id}`, albumId: id };
  }

  return null;
}

/**
 * Merge one metadata patch into the current URL's filters and return the URL to navigate to.
 *
 * The result targets the surface's BASE path, which excludes any open assetId — so a single
 * goto() both closes the asset viewer and applies the filter.
 *
 * Merge semantics: the patched fields are SET; every other active filter is preserved. Array
 * fields (personIds, tagIds) are REPLACED, never appended — see the module docs and spec §5.6.
 */
export function buildContextualFilterUrl(url: URL, patch: Partial<FilterState>, opts?: { global?: boolean }): string {
  const target = opts?.global ? null : resolveFilterTarget(url);
  const basePath = target?.basePath ?? '/photos';

  // `global` (and the non-filterable-surface fallback) start from a CLEAN slate rather than
  // carrying the current context over. This replaces the old link to the `/search` page, which
  // always began a fresh search. It deliberately drops the active `q` and `sort` as well as the
  // filters: "search everywhere for THIS camera" is a new search, not the old one plus a camera.
  // It also avoids dragging a Space's `space-person:<uuid>` scoped tokens onto /photos, where a
  // scoped token matches nothing.
  const carryOver = target !== null;

  const params = new URLSearchParams(carryOver ? url.searchParams : undefined);

  // `at` is a one-shot grid scroll target left behind by closing the asset viewer. It must not
  // survive a filter change, or the timeline re-scrolls to a now-filtered-out asset.
  params.delete('at');
  clearFilterParams(params);

  const current: FilterState = {
    ...createFilterState(),
    ...(carryOver && decodeFilterParams(url)),
    ...patch,
  };

  encodeFilterParams(params, current);

  // The map keeps its viewport (zoom/lat/lng) in the URL HASH — `<Map hash>` on the map page, and
  // Route.map emits `#zoom/lat/lng`. Dropping it would silently reset the map's viewport every
  // time you filter from an asset opened on the map. No other surface uses the hash.
  const hash = target?.kind === 'map' ? url.hash : '';

  const search = params.toString();
  return basePath + (search ? `?${search}` : '') + hash;
}

/**
 * The navigating counterpart to `buildContextualFilterUrl`: apply a metadata patch to the CURRENT
 * page (`page.url` from `$app/state`) and navigate there.
 *
 * Thin on purpose — all the interesting logic (target resolution, merge semantics, the `global`
 * escape hatch, dropping `at`) already lives in `buildContextualFilterUrl` and is tested there. This
 * is just the wiring: it is what a DetailPanel row's `onclick` calls.
 *
 * The resulting `goto()` targets the surface's base path (no `assetId`), so a single call both
 * closes the asset viewer and applies the filter.
 */
export function applyContextualFilter(patch: Partial<FilterState>, opts?: { global?: boolean }): void {
  void goto(buildContextualFilterUrl(page.url, patch, opts));
}

/**
 * The `personIds` patch for ONE asset-viewer person — and it is a function of the SURFACE, not just
 * of the person (spec §5.5/E4 are wrong about this; see the slice-7 plan's R8).
 *
 * Two different server fields are behind `FilterState.personIds`:
 * - a Space (and the space map) sends it as **`spacePersonIds`** (space-filter-options.ts,
 *   map-filter-options.ts), which the server validates as `z.array(z.uuidv4())` — a **bare uuid**.
 *   A `space-person:<uuid>` token there is a zod REJECT → 400 → the whole Space timeline errors out.
 *   That is a hard error, not merely a wrong result.
 * - /photos, an album and the global map send it as **`personIds`**, the only field that accepts the
 *   SCOPED token — and the scoped token is the only id a viewer of a shared-space asset can resolve
 *   there: the owner's person uuid is invisible to them, so it would return nothing (P1).
 *
 * Returns **null when there is nothing honest to filter by**: a Space person with no
 * `spacePersonId`. The owner's person uuid is not a space_person row, so filtering the Space by it
 * would silently return an empty timeline. Callers must not render the affordance when this is null.
 *
 * Off the Space the token is ALWAYS scoped — `person:<uuid>` for an own person, never the bare uuid.
 * The server accepts all three forms (`ScopedPersonTokenSchema`), so a bare uuid narrows the timeline
 * correctly; but it is not the id the surface's own filter options are keyed by. /photos, an album,
 * the global map and Recently Added all build their people options — and the `personNames` map the
 * chip reads — with `getPhotosPersonFilterId`, which emits `person:<uuid>`. A bare uuid therefore
 * matches no option: the chip degrades to a raw UUID and the panel renders a SECOND, orphaned UUID
 * row beside the named one it should have ticked.
 *
 * Do NOT reach for `getPhotosPersonFilterId` itself here — it is built for the filter-suggestion DTO
 * shape (`filterId` / `primaryProfile`), neither of which `mapPerson` sets on an asset-viewer person,
 * so it would fall through to the bare `person.id`. This mirrors its OUTPUT, not its input.
 */
export function buildPersonFilterPatch(
  url: URL,
  person: { id: string; spacePersonId?: string },
): Partial<FilterState> | null {
  const target = resolveFilterTarget(url);
  const isSpaceScoped = target?.kind === 'space' || (target?.kind === 'map' && !!target.spaceId);

  if (isSpaceScoped) {
    return person.spacePersonId ? { personIds: [person.spacePersonId] } : null;
  }

  return {
    personIds: [person.spacePersonId ? `space-person:${person.spacePersonId}` : `person:${person.id}`],
  };
}

/**
 * Bank the label of a contextual person filter against the URL it navigates to, so the destination
 * can NAME the chip (and tick the right panel row) the moment it hydrates.
 *
 * Without this the label is at the mercy of the filter-suggestions response, which is a network
 * round-trip late — and which never carries this token at all when the viewer also owns a person for
 * the same identity: the suggestion ranks the user-person first and emits `person:<own uuid>`, so a
 * `space-person:<uuid>` chip would show its raw token forever. Both render an id where a name
 * belongs, which is the reported bug.
 *
 * Reuses typed search's session-scoped cache because every filter surface already drains it on
 * navigation (`consumeTypedSearchNamesInto`) — there is no second mechanism to keep in sync. Like
 * typed search's own hand-off it is one-shot and best-effort: a middle-click into a new tab, or a
 * second visit to the same URL, simply falls back to the suggestions response.
 *
 * `destination` is keyed on pathname + search, dropping any hash: the map keeps its viewport in the
 * hash, and every consumer keys on `page.url.pathname + page.url.search`.
 */
export function rememberContextualPersonName(destination: string, personId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }

  storeTypedSearchNames(destination.split('#', 1)[0], {
    personNames: new Map([[personId, trimmed]]),
    tagNames: new Map(),
  });
}

/**
 * The map URL for the CURRENT context (E10): the surface's scope plus its active filters, optionally
 * centered on a point.
 *
 * This is the 🗺️ pin on the asset viewer's location row: "show me this, on the full map, without
 * losing what I am looking at". It carries the Space scope (`spaceId`), the active search term and
 * every active filter over to `/map` — dropping them is bug #767.
 *
 * Returns **null when there is nothing honest to link to**, which today means the ALBUM surface:
 * there is no album-map URL at all (`AlbumMap` is a modal rendered over the album page). A pin there
 * would land on the GLOBAL map carrying the album's filters but NOT its album scope — silently
 * widening "this album" to "the whole library". Callers must not render the pin when this is null.
 *
 * A non-filterable surface (`resolveFilterTarget` → null, e.g. /search) carries nothing over, exactly
 * like `buildContextualFilterUrl`'s fallback: there is no scope to preserve, so there is none to lie
 * about either.
 */
export function buildContextualMapUrl(url: URL, point?: { lat: number; lng: number; zoom?: number }): string | null {
  const target = resolveFilterTarget(url);

  if (target?.kind === 'album') {
    return null;
  }

  const carryOver = target !== null;
  const filters: FilterState = { ...createFilterState(), ...(carryOver && decodeFilterParams(url)) };
  const spaceId = target && (target.kind === 'space' || target.kind === 'map') ? target.spaceId : undefined;
  const query = carryOver ? (url.searchParams.get('q') ?? undefined) : undefined;

  // A space-scoped map cannot represent an album filter: space ∩ album is unsatisfiable and the
  // server 400s it (see hydrateMapFilters, which drops it on arrival). Don't let albumId ride along
  // into the carried URL — it would be a dead param.
  if (spaceId) {
    filters.albumId = undefined;
  }

  return Route.map({ spaceId, query, filters, ...point });
}

/**
 * Write a COMPLETE FilterState into the current URL and return the URL to navigate to.
 *
 * This is the WRITE half of the hydrate → write → react loop on /map (where
 * `getSearchablePageBasePath` returns null, so `buildSearchablePageUrl` cannot be reused at all)
 * and on the two album detail routes. Those two ARE searchable pages now, but they still write
 * through here rather than through `buildSearchablePageUrl`, for the pathname reason below: their
 * filter panel can be used with the asset viewer open, and targeting the base path would close it
 * on every filter tweak. `q` and `sort` ride along untouched as ordinary non-filter params.
 *
 * Semantics, and how they differ from buildContextualFilterUrl:
 * - It REPLACES rather than merges. Every filter param is deleted, then re-emitted from `filters`
 *   alone. Do NOT reimplement this by passing a full FilterState as buildContextualFilterUrl's
 *   `patch`: that function decodes the URL first, so any key absent from the object would silently
 *   survive and the filter could never be cleared.
 * - It keeps the CURRENT pathname (including an open asset viewer), because the panel can write
 *   while the viewer is open. buildContextualFilterUrl deliberately targets the base path instead,
 *   so that one goto() both closes the viewer and applies the filter.
 * - Non-filter params (q, sort, spaceId, view, …) are preserved; the hash is preserved (the map
 *   keeps its viewport there); the one-shot `at` grid scroll target is dropped.
 */
export function buildFilterStateUrl(url: URL, filters: FilterState): string {
  const params = new URLSearchParams(url.searchParams);

  // `at` is a one-shot grid scroll target left behind by closing the asset viewer. It must not
  // survive a filter change, or the timeline re-scrolls to a now-filtered-out asset.
  params.delete('at');
  clearFilterParams(params);
  encodeFilterParams(params, filters);

  const search = params.toString();
  return url.pathname + (search ? `?${search}` : '') + url.hash;
}

/**
 * `search` (a `location.search`-shaped string, e.g. `page.url.search`) with the one-shot
 * `?at=<assetId>` grid-scroll-target param removed.
 *
 * `replaceScrollTarget` (navigation.ts) writes `?at=` into the URL when the asset viewer closes,
 * which changes the surrounding page's `page.url.search`. A URL-backed filter surface's hydrate ⇄
 * write token guard must NOT treat that as a filter change — otherwise closing the viewer
 * re-hydrates its FilterState from a URL that never encoded a transient (URL-less)
 * selectedYear/selectedMonth, silently dropping it and widening the timeline back to "all time". A
 * real filter change still reads as changed: `buildFilterStateUrl` already drops `at` from any URL
 * it writes.
 */
export function withoutAtParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('at');
  const next = params.toString();
  return next ? `?${next}` : '';
}

/**
 * Order-insensitive canonical form of a query string: `a=1&b=2` and `b=2&a=1` collapse to one.
 *
 * Each entry is percent-encoded before it is joined. The free-text filters (description, filename,
 * ocr) can legitimately contain `&` and `=`, so joining raw values would let one entry impersonate
 * two — `description=x&make=Apple` as a single value would canonicalise identically to a separate
 * `description=x` plus `make=Apple`, and the guard below would call a real filter change a no-op.
 */
function canonicalizeParams(params: URLSearchParams): string {
  return [...params]
    .sort(([keyA, valueA], [keyB, valueB]) => keyA.localeCompare(keyB) || valueA.localeCompare(valueB))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * Would navigating to `nextUrl` actually change anything?
 *
 * This is the no-op guard for the write half of the hydrate → write → react loop, and it must NOT
 * be a raw string compare: buildFilterStateUrl deletes the filter params and re-appends them last,
 * so `/map?make=Apple&spaceId=s1` rebuilds as `/map?spaceId=s1&make=Apple` — same meaning, different
 * string. A string compare would report "changed" and fire a pointless replaceState (plus an extra
 * $effect pass) the first time the panel is touched on such a URL.
 *
 * Path and hash are compared verbatim; the query is compared as a canonicalised param set, so a
 * dropped `at` or any added/changed/removed filter still reads as a real change.
 */
export function isFilterStateUrlUnchanged(url: URL, nextUrl: string): boolean {
  const next = new URL(nextUrl, url);

  return (
    next.pathname === url.pathname &&
    next.hash === url.hash &&
    canonicalizeParams(next.searchParams) === canonicalizeParams(url.searchParams)
  );
}

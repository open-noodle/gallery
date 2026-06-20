# "Has album" filter — design

**Issue:** [open-noodle/gallery#675](https://github.com/open-noodle/gallery/issues/675)
**Date:** 2026-06-19

## Problem

The timeline filter panel's Album section offers only two states:

- **All**
- **Has no album**

The logical third state is missing:

- **Has album** — show only assets assigned to at least one album.

Without it the filter is asymmetric: a user can find unorganized photos (Has no album) but cannot do the reverse — filter to photos that are already in an album. Both directions are equally useful for organizing a large library.

## Approach

Add a parallel boolean `isInAlbum` everywhere the existing fork-only `isNotInAlbum` boolean is wired **on web and server**. The two are **mutually exclusive in the UI** — selecting one clears the other — so the only reachable states are _All / Has album / Has no album_.

This was chosen over a tri-state enum (`albumFilter: 'all' | 'inAlbum' | 'notInAlbum'`) because:

- It is purely **additive** — every existing `isNotInAlbum` site gains a mirrored `isInAlbum` site, never rewriting existing behavior. This keeps upstream rebases low-conflict (the fork's guiding constraint).
- **No API/URL migration.** Existing `?album=none` deep links and persisted state keep working; we only add a new value `?album=has`.
- **Mechanical and low-risk** — easy to TDD, easy to review, nothing existing can regress.

The enum's only real advantage — type-level impossibility of a contradictory state — is already guaranteed in practice by the UI, and defended server-side (see Edge cases).

### Scope

Mirror `isInAlbum` on **every web + server surface `isNotInAlbum` already lives**: the photos/timeline filter panel, the shared-space filter, the map-markers filter, and the smart-search request/terms display. `AlbumsFilter.svelte` is a single shared component and the filter-option utils already each thread `isNotInAlbum`, so full symmetry across those web surfaces is the natural result — restricting to just the timeline panel would require _extra_ branching to suppress the new button elsewhere.

### Out of scope

- **Mobile (Flutter/Dart).** The mobile app has its own parallel `isNotInAlbum` wiring (`search_filter.model.dart`, the filter sheet, the photos-filter provider, chips, and the search API repository). Issue #675 is specifically about the **web** timeline filter panel (the screenshot is web), the mobile filter UX is a separate surface, and mobile cannot be verified locally in this worktree (Flutter toolchain mismatch — verification is CI-only). Adding the mobile "Has album" toggle is a clean follow-up that can be done independently; it is intentionally excluded here to keep this change focused and verifiable.
- **Command palette / global search** (`global-search-manager.svelte.ts`). It does not support any album filter today (its smart/metadata search only passes `query`/`size`), so there is nothing to mirror.
- **`web/src/lib/types.ts` `SearchDisplayFilters` / `SearchFilter`.** These web types are **dead code** — defined but never imported or constructed anywhere in `web/`. They are left untouched (adding to unused types serves nothing; removing them is unrelated cleanup). The live web filter type is `FilterState` in `filter-panel.ts`.

## Changes

### 1. UI — `web/src/lib/components/filter-panel/albums-filter.svelte`

The only genuinely new code. Convert the 2-button group to 3 buttons. Change the prop contract from `selected?: boolean` + `onToggle(boolean | undefined)` to an explicit tri-state:

```ts
interface Props {
  selected: 'all' | 'has' | 'none';
  onChange: (value: 'all' | 'has' | 'none') => void;
}
```

Buttons (preserve existing test ids, add one):

- **All** — `data-testid="albums-all"` (`selected === 'all'`)
- **Has album** — `data-testid="albums-has"` (new, icon `mdiImageAlbum`)
- **Has no album** — `data-testid="albums-none"` (existing, icon `mdiImageOffOutline`)

`filter-panel.svelte` maps the two booleans ↔ tri-state, clearing the other on select:

```svelte
<AlbumsFilter
  selected={filters.isInAlbum ? 'has' : filters.isNotInAlbum ? 'none' : 'all'}
  onChange={(v) =>
    updateFilters({
      ...filters,
      isInAlbum: v === 'has' ? true : undefined,
      isNotInAlbum: v === 'none' ? true : undefined,
    })}
/>
```

### 2. Web plumbing (mirror `isNotInAlbum` 1:1)

**Filter state / context** — `web/src/lib/components/filter-panel/filter-panel.ts`: `FilterState`, `createFilterState`, `getActiveFilterCount`, `FilterContext`, `buildFilterContext`, `clearFilters`.

**Filter panel** — `web/src/lib/components/filter-panel/filter-panel.svelte`: the effect-tracking `current` object; `hasActiveFilter('albums')` returns true if **either** boolean is set; the `AlbumsFilter` binding above.

**Active filters bar** — `web/src/lib/components/filter-panel/active-filters-bar.svelte`: new chip with `labelKey: 'filter_has_album'` for `isInAlbum === true` (alongside the existing `filter_has_no_album` chip).

**URL params** — `web/src/lib/utils/searchable-page-search.ts`: new value `?album=has` (existing `?album=none` untouched). `parseAlbumFilter` returns `'has' | 'none' | undefined`; map `'none' → isNotInAlbum`, `'has' → isInAlbum` in `getSearchablePageFilterState`; serialize `isInAlbum` → `album=has` in `appendSearchablePageFilterParams`; add `'isInAlbum'` to the `SearchablePageFilterState` key union.

**Filter-option utils** — build-option + remove-filter cases (a "remove albums" action clears **both** booleans):

- `web/src/lib/utils/photos-filter-options.ts`
- `web/src/lib/utils/space-filter-options.ts`
- `web/src/lib/utils/space-search.ts`
- `web/src/lib/utils/map-filter-options.ts`
- `web/src/lib/utils/map-filter-config.ts`

**Page-level request threading** — these route components pass the field explicitly (not via the utils), so each needs the mirrored line:

- `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` — `isInAlbum: nextFilters.isInAlbum === true ? true : undefined` in the suggestions-provider request.
- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` — same.
- `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte` — add `isInAlbum: $t('in_any_album')` to the `getHumanReadableSearchKey` keyMap so an active "in album" search term renders with a human label. (The request itself already flows via `{ ...terms }`; `onAlbumAddAssets` needs **no** `isInAlbum` branch — adding assets to an album does not remove them from a "has album" result set.)

**Test stubs** — carry `isInAlbum` + new button/data-attr:

- `web/src/test-data/mocks/bindable-filter-panel.stub.svelte` (used by the photos, spaces, and map page specs) — add `selectHasAlbum()`, a `select-has-album-filter` button, and a `data-is-in-album` attribute
- `web/src/test-data/mocks/smart-search-results.stub.svelte` — add a `data-filter-in-album` attribute
- (`filter-panel-favorites.stub.svelte` is **not** updated — it has zero importers; dead, like the unused types above.)

**i18n** — `i18n/en.json`:

- `"filter_has_album": "Has album"` (filter-panel button + active-filters chip), next to `filter_has_no_album`.
- `"in_any_album": "In an album"` (smart-search terms label), next to `not_in_any_album`.

Other locales fall back to English until the next Weblate sync.

### 3. Server (mirror `isNotInAlbum` 1:1)

- DTOs:
  - `server/src/dtos/search.dto.ts` — base schema field (`z.boolean().optional()`), the `SmartSearchFacets` pick list, and the two `stringToBool` variants
  - `server/src/dtos/time-bucket.dto.ts`
  - `server/src/dtos/gallery-map.dto.ts`
- Repos / SQL — the inverse is the **same `EXISTS(album_asset)` subquery without `NOT`**, guarded by the same `!options.albumId(s)` condition:
  - `server/src/repositories/asset.repository.ts` — option type (one site) + the two SQL sites
  - `server/src/repositories/search.repository.ts` — option types (three sites) + the two SQL sites
  - `server/src/utils/database.ts` — `searchAssetBuilder`
- `server/src/services/shared-space.service.ts` — map `isInAlbum: dto.isInAlbum`
- `server/src/services/timeline.service.ts` — **no change** (`buildTimeBucketOptions` spreads the DTO via `...options`, so the field flows once added to the DTO + option type)

### 4. SDK / OpenAPI

Regenerate the spec + TS SDK (required: the web passes `isInAlbum` through generated `@immich/sdk` types — `getTimeBucket(s)`, `getTimeBucketCovers`, `getFilteredMapMarkers`, `searchLargeAssets`, `getSearchSuggestions`, `getFilterSuggestions`, the smart-search DTOs — so it must typecheck). Workflow: build server → `pnpm sync:open-api` → `make open-api` (regenerates the TS SDK and the Dart client). The Dart client regenerates automatically; mobile app code is not changed (see Out of scope).

## Testing (TDD — failing test first, then implementation)

### Server

- `server/src/dtos/search.dto.spec.ts` — accept/coerce `isInAlbum` on smart search, facets, filter-suggestion, and dependent-suggestion requests (mirror existing `isNotInAlbum` cases)
- `server/src/dtos/time-bucket.dto.spec.ts` — coerce `isInAlbum` `'true'`/`'false'`
- `server/src/dtos/gallery-map.dto.spec.ts` — coerce `isInAlbum`
- `server/src/repositories/search.repository.spec.ts` — `compileFilteredAssetIds(sut, { isInAlbum: true })` emits an `EXISTS (… album_asset …)` predicate **without** a leading `NOT` (and still distinct from the `isNotInAlbum: true` snapshot)
- `server/src/services/timeline.service.spec.ts` — `getTimeBuckets` / `getTimeBucket` forward `isInAlbum`
- `server/src/services/shared-space.service.spec.ts` — `getFilteredMapMarkers` forwards `isInAlbum`

### Web — filter state & components

- `web/src/lib/components/filter-panel/__tests__/albums-filter.spec.ts` — **rewrite** for the new tri-state contract: renders all three buttons; highlights the button matching `selected`; clicking each calls `onChange('all' | 'has' | 'none')`
- `web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts` — `getActiveFilterCount` counts `isInAlbum`; `clearFilters` clears it; `buildFilterContext` includes/excludes it
- `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts` — clicking `albums-has` fires `onFiltersChange` with `isInAlbum: true`; `hasActiveFilter('albums')` (collapsed-dot) true for `isInAlbum`. Verify the existing `albums-none → isNotInAlbum: true` test still passes under the new mapping.
- `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts` — `isInAlbum: true` produces the `filter_has_album` chip; removing it clears the filter

### Web — utils

- `web/src/lib/utils/__tests__/photos-filter-options.spec.ts` — `isInAlbum: true` maps onto options; `false`/unset omitted; remove `'albums'` clears both booleans; remove `'isInAlbum'` clears it
- `web/src/lib/utils/__tests__/space-filter-options.spec.ts` — mirror (build options + remove cases)
- `web/src/lib/utils/__tests__/space-search.spec.ts` — sets/omits `isInAlbum`
- `web/src/lib/utils/__tests__/map-filter-options.spec.ts` — includes/omits `isInAlbum`
- `web/src/lib/utils/__tests__/map-filter-config.spec.ts` — suggestions provider forwards `isInAlbum`
- `web/src/lib/utils/__tests__/searchable-page-search.spec.ts` — `?album=has` round-trips to `isInAlbum: true`; `?album=none` still → `isNotInAlbum: true`; serializing `isInAlbum` produces `album=has`

### Web — page integration

- `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts` — request includes `isInAlbum: true` when set
- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts` — request includes `isInAlbum: true`
- `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts` — `getFilteredMapMarkers` called with `isInAlbum: true`

### E2E

Mirror any existing Playwright coverage for the "Has no album" toggle if present; otherwise the unit/component/integration coverage above is sufficient for this UI-symmetry change.

## Edge cases

- **Both booleans `true`** (unreachable via UI): the SQL ANDs both predicates → `EXISTS … AND NOT EXISTS …` → empty result, the literally-correct intersection. No special handling required.
- **Album-scoped queries** (`albumId` / `albumIds` set): the existing `isNotInAlbum` predicates already no-op in that case via the `!options.albumId(s)` guard; `isInAlbum` uses the same guard, so it likewise no-ops when an explicit album scope is present.
- **Adding assets to an album while "Has album" is active** (`onAlbumAddAssets`): the asset now matches the filter, so it should remain visible — no client-side pruning, unlike the `isNotInAlbum` case which removes newly-albumed assets from view. Hence no `isInAlbum` branch is added there.

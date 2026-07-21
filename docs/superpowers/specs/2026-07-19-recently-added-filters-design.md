# Filters + item count for the "Recently Added" view (#805)

- **Discussion:** https://github.com/open-noodle/gallery/discussions/805
- **Date:** 2026-07-19
- **Scope:** Web only. No server / API / mobile changes.
- **Approach:** Mirror the existing per-view filter integration pattern (Photos), adding two new
  `web/src/lib/utils/` modules and wiring them into the Recently Added route. Do **not** modify the
  Photos page or the shared `filter-panel` / `Timeline` components.
- **Delivery:** three impl-loop slices (§Slice 1–3). Each slice is independently shippable, TDD-first
  (unit red→green→refactor), with BDD acceptance scenarios for user-facing behavior, and ends green on
  the repo gate + a commit.

## 1. Goal

Give the web **Recently Added** view (`/recently-added`) the two things the discussion asks for:

1. **A visible item count** — "N items" in the page header, reflecting what is currently shown and
   updating live as filters change.
2. **Filter navigation** — the same 10-section Filter panel used by Photos
   (Timeline, People, Location, Camera, Tags, Rating, Media type, Favorites, Albums, Text).

…while preserving what makes the view "recently added": assets are **ordered and day-grouped by
_added_ date** (`orderBy: AssetOrderBy.CreatedAt`) and the view stays scoped to **own + partner**
assets (never shared spaces).

## 2. Background: how the pieces work today

- **The route** `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  renders the shared `<Timeline {options}>` with a static
  `options = { visibility: Timeline, withStacked: true, withPartners: true, orderBy: CreatedAt }`.
  It has a header **title** ("Recently Added") via `UserPageLayout` but **no count and no filters**.
  It shares the multi-select bulk-action machinery (`AssetSelectControlBar`) with Photos.

- **`UserPageLayout`** (`web/src/lib/components/layouts/UserPageLayout.svelte`) exposes a
  `description?: string` prop rendered next to the title (line 86–92), inside the header row that only
  shows when `!hideNavbar && (title || buttons)`. The current route already passes
  `hideNavbar={assetMultiSelectManager.selectionActive}`, so the count naturally hides during
  multi-select (the selection bar shows its own count instead).

- **The Filter panel** `web/src/lib/components/filter-panel/` is reusable. Each host view supplies a
  `FilterPanelConfig` (which `sections` to show + suggestion providers) and converts the panel's
  `FilterState` into a timeline query via a per-view **options builder**
  (`buildPhotosTimelineOptions`, `buildSpaceTimelineOptions`, `buildAlbumTimelineOptions`,
  `buildMapTimelineOptions`). The **URL is the source of truth** for filter state
  (`web/src/lib/utils/searchable-page-search.ts`).

- **Photos is the full template** (`web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`):
  it seeds `FilterState` from the URL, builds an all-10-section config, feeds
  `buildPhotosTimelineOptions(filters)` into `<Timeline>`, renders `<ActiveFiltersBar>` + `<FilterToolbar>`,
  and switches between **browse mode** (`<Timeline>`) and **query mode** (`<SmartSearchResults>`) when
  free-text is entered.

- **The count is free client-side.** `TimelineManager.assetCount` is a live grand total (time buckets
  carry per-bucket counts) available once buckets load. No photos/videos split without backend work.
  The `items_count` i18n key already exists: `"{count, plural, one {# item} other {# items}}"`.

- **Scope subtlety in `buildPhotosTimelineOptions`:** `withPartners` and `withSharedSpaces` are only
  added when `filters.isFavorite === undefined` (favorites are treated as strictly personal). Recently
  Added must never add `withSharedSpaces` — see §Slice 2.

## 3. Architecture

### 3.1 The single scope invariant

Recently Added is an **own + partner** surface, **never shared spaces**. This holds in every data path:
timeline options (Slice 2), filter suggestions (Slice 2), and smart search (Slice 3). It is the one rule
distinguishing Recently Added from Photos.

### 3.1.1 Prerequisite discovered during Slice 2 planning: `/recently-added` is not a searchable page

`buildSearchablePageUrl()` returns `null` unless `getSearchablePageBasePath()` recognises the pathname,
and today it recognises only `/photos` and `/spaces/…`. On `/recently-added` the filter→URL write path
would therefore **silently no-op** — filters would apply to the grid but never reach the URL, breaking
"URL is the source of truth", deep links, and survive-a-reload.

Registering the path is necessary but not sufficient, and the flag is not where the risk lives.
`global-search-manager`'s `buildSearchDestination()` branches purely on whether
`buildSearchablePageUrl()` returns non-null — it never consults `isSearchable`:

```ts
const searchablePageUrl = buildSearchablePageUrl(page.url, text, this.searchSortOrder, filters);
if (searchablePageUrl) { return searchablePageUrl; }
…
return buildSearchablePageUrl(new URL('/photos', page.url), text, …) ?? '/photos';
```

Today a global search typed on Recently Added falls through to `/photos` and works. The moment the
base path resolves, that fallback stops firing and the user lands on `/recently-added?q=beach` — a
route with no query handling until Slice 3. Unfiltered grid, stale `q`, no error. Setting
`isSearchable: false` does not prevent this: it only suppresses pre-filling the search box.

**Decision:** separate the two capabilities, and enforce the separation where the query is
_written_, not merely where it is advertised. Slice 2 registers `/recently-added` in
`getSearchablePageBasePath()` (so filter URL persistence works) and adds a query-capable predicate
that excludes `/recently-added`. That predicate is enforced in **two** places: `getSearchablePageState()`
reports `isSearchable: false`, and `buildSearchablePageUrl()` returns `null` when asked to build a
URL carrying a non-empty query for a non-query-capable page — which keeps `buildSearchDestination`'s
`/photos` fallback intact. Slice 3 deletes the exclusion in one place, and the text section, the
search path, and query support all land together. Photos and Spaces behaviour is unchanged throughout.

### 3.2 Decision logic lives in pure, unit-tested functions

To keep the route thin (a full `+page.svelte` with all managers is impractical to mount in vitest), all
branching logic is extracted into pure functions that get exhaustive TDD unit coverage. The route is glue
whose behavior is verified by BDD e2e acceptance scenarios.

| Pure function                                           | Module                             | Slice             |
| ------------------------------------------------------- | ---------------------------------- | ----------------- |
| `shouldShowRecentlyAddedCount(count, hasActiveFilters)` | `recently-added-filter-options.ts` | 1                 |
| `buildRecentlyAddedTimelineOptions(filters)`            | `recently-added-filter-options.ts` | 2                 |
| `buildRecentlyAddedSuggestionRequest(filters)`          | `recently-added-filter-options.ts` | 2                 |
| `buildRecentlyAddedFilterConfig()`                      | `recently-added-filter-config.ts`  | 2 (extended in 3) |

### 3.3 Testing strategy: TDD + BDD

- **TDD (example-based)** for the pure functions — the right tool for input→output logic. Each is built
  red→green→refactor with concrete failing-test commands and expected red output (per slice).
- **BDD (Given/When/Then)** for user-facing behavior — the count display, applying/removing filters, and
  search. These become Playwright e2e specs under `e2e/src/specs/web/`, written **red-first** (the feature
  is absent → scenario fails), then made green by the route wiring. BDD is deliberately _not_ forced onto
  the pure functions, where example tables are clearer.

### 3.4 Files (whole feature)

**New source:**

| File                                                 | Responsibility                                                                                             | Slice |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----- |
| `web/src/lib/utils/recently-added-filter-options.ts` | `shouldShowRecentlyAddedCount`, `buildRecentlyAddedTimelineOptions`, `buildRecentlyAddedSuggestionRequest` | 1, 2  |
| `web/src/lib/utils/recently-added-filter-config.ts`  | `buildRecentlyAddedFilterConfig()` → `FilterPanelConfig`                                                   | 2, 3  |

**New tests:**

| File                                                                                               | Covers                                             | Slice   |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------- |
| `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts`                                | the three pure functions                           | 1, 2    |
| `web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts`                                 | the config (mirrors `album-filter-config.spec.ts`) | 2, 3    |
| `e2e/src/specs/web/recently-added-filters.e2e-spec.ts` (mirrors `photos-filter-panel.e2e-spec.ts`) | BDD acceptance scenarios                           | 1, 2, 3 |

**Modified:**

| File                                                                                 | Change                                                                                                                                    | Slice   |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte` | header count (1); filter panel + toolbar + chips + URL sync (2); text/search mode (3). The `AssetSelectControlBar` block stays unchanged. | 1, 2, 3 |

No i18n additions: `items_count` exists (Slices 1–2); Slice 3 reuses existing search keys
(`filter_result_count`, etc.) already used by Photos.

## 4. Slice overview

| Slice                                      | Delivers (shippable)                                                                                                                                                                                     | Depends on |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **1 — Header item count**                  | "N items" in the header for the (unfiltered) view; hides on empty/loading. Half of #805, ships alone.                                                                                                    | —          |
| **2 — Browse filter panel (9 sections)**   | Full metadata filtering (People, Location, Camera, Tags, Rating, Media type, Favorites, Albums, Timeline-date) with chips, URL persistence, and the count reflecting the filtered set. The bulk of #805. | 1          |
| **3 — Text / smart-search (10th section)** | Free-text search → `SmartSearchResults`, search-total count; completes all-10 parity.                                                                                                                    | 2          |

---

## Slice 1 — Header item count

**Goal:** show "N items" in the Recently Added header, sourced from `timelineManager.assetCount`, with
sensible visibility. No filter panel yet; the `<Timeline>` body is unchanged.

**Files:** `recently-added-filter-options.ts` (new, `shouldShowRecentlyAddedCount` only),
its spec (new), the route (add header count), the e2e spec (new).

### The pure function

```ts
// recently-added-filter-options.ts
export function shouldShowRecentlyAddedCount(count: number, hasActiveFilters: boolean): boolean {
  return count > 0 || hasActiveFilters;
}
```

Rationale for each rule (each is a test row below):

- `count === 0` & no filters → **hidden**: no "0 items" flash before buckets load; the `EmptyPlaceholder`
  already communicates an empty account.
- `count === 0` & filters active → **"0 items"**: informative ("your filter matched nothing"). (The
  `hasActiveFilters` arm is always `false` in Slice 1 but the function is written and tested complete so
  Slice 2 needs no change.)
- `count > 0` → **"N items"**, live-updating as buckets load.

### TDD steps

1. **Red.** Create `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts` with the
   `shouldShowRecentlyAddedCount` cases (below). Run:
   `cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-options.spec.ts`
   Expected red: `does not provide an export named 'shouldShowRecentlyAddedCount'` (import fails).
2. **Green.** Add the one-line function to `recently-added-filter-options.ts`. Re-run → all pass.
3. **Refactor.** None expected (single expression).

### Unit tests (exhaustive)

```
shouldShowRecentlyAddedCount:
  (0, false) → false   // loading / empty account: hidden
  (0, true)  → true    // filter matched nothing: "0 items"
  (5, false) → true    // normal: "5 items"
  (5, true)  → true    // filtered result
  (1, false) → true    // plural boundary handled by i18n, not this fn
```

### Route change

- `const count = $derived(timelineManager?.assetCount ?? 0);`
- `const countLabel = $derived(shouldShowRecentlyAddedCount(count, false) ? $t('items_count', { values: { count } }) : undefined);`
- Pass `description={countLabel}` to the existing `<UserPageLayout ... title={data.meta.title}>`.

### BDD acceptance scenarios (e2e, red-first)

```gherkin
Feature: Recently Added item count

  Scenario: Count shown for a populated library
    Given my library has 12 assets in the timeline
    When I open the Recently Added view
    Then the header shows "12 items"

  Scenario: Count hidden for an empty library
    Given my library has no assets
    When I open the Recently Added view
    Then no item count is shown in the header
    And the empty-state placeholder is shown

  Scenario: Count is not shown while selecting
    Given the Recently Added view with assets
    When I enter multi-select and select an asset
    Then the header (title + count) is replaced by the selection bar
```

### Edge cases

| Edge case                                           | Expected                                   | Verified by                                   |
| --------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Buckets not yet loaded (`assetCount` 0 transiently) | No "0 items" flash                         | `shouldShowRecentlyAddedCount(0,false)=false` |
| Empty account                                       | Count hidden; placeholder shown            | unit + e2e "empty library"                    |
| Multi-select active (`hideNavbar`)                  | Header + count hidden; selection bar shown | e2e "while selecting"                         |
| Plural vs singular ("1 item")                       | Handled by `items_count` ICU plural        | rendered by i18n (not this fn)                |

### Done gate

`cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test`; commit
`feat(web): item count in Recently Added header (#805)`.

---

## Slice 2 — Browse filter panel (9 metadata sections)

**Goal:** add the Filter panel with the 9 metadata sections, chips, URL persistence, grouping control,
and make the Slice-1 count reflect the filtered set. **No free-text/search mode** (that is Slice 3);
nothing in this slice references `committedQuery`/`SmartSearchResults`/smart facets.

**Files:** `recently-added-filter-options.ts` (add two builders), `recently-added-filter-config.ts`
(new), their specs, the route (restructure body to host the panel), the e2e spec (add scenarios).

### The options builder

```ts
// recently-added-filter-options.ts
import { AssetOrderBy } from '@immich/sdk';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { buildPhotosTimelineOptions } from '$lib/utils/photos-filter-options';

export function buildRecentlyAddedTimelineOptions(filters: FilterState): Record<string, unknown> {
  // Reuse Photos' predicate mapping, then apply the two Recently-Added invariants:
  //   1. never surface shared-space assets (strip withSharedSpaces in every case)
  //   2. always order/group by *added* date
  const { withSharedSpaces: _omitShared, ...base } = buildPhotosTimelineOptions(filters);
  return { ...base, orderBy: AssetOrderBy.CreatedAt };
}
```

**Invariants (each a test row):**

- **`orderBy: CreatedAt` always** — the defining trait; holds under every filter combination.
- **`withSharedSpaces` never present** — asserted by exact-shape `toEqual` on the default case (so a
  _future_ new shared-scope key added by `buildPhotosTimelineOptions` would fail the test), plus explicit
  `not.toHaveProperty('withSharedSpaces')` under a filter and under favorites.
- **`withPartners` inherited** — `true` by default / non-favorite filters (own+partners, matching today's
  static options); **absent** under a Favorites filter (own-only, matching Photos: a favorite is a
  personal flag). New behavior for a new capability → no regression.
- **`order`** inherited from `filters.sortOrder`; default `Desc` = newest-added first.
- **Date filters → `takenAfter`/`takenBefore`** (inherited). Documented semantic: the Timeline date
  filter filters _taken_ date while day-groups reflect _added_ date — intentional (e.g. old photos just
  imported); not remapped to created-at (no created-at range predicate exists; that is backend work,
  a non-goal).

### The suggestion request

```ts
// recently-added-filter-options.ts
export function buildRecentlyAddedSuggestionRequest(filters: FilterState) {
  const context = buildFilterContext(filters);
  return {
    personIds: filters.personIds.length > 0 ? filters.personIds : undefined,
    country: filters.country,
    city: filters.city,
    make: filters.make,
    model: filters.model,
    tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
    rating: filters.rating,
    isFavorite: filters.isFavorite,
    mediaType:
      filters.mediaType === 'all'
        ? undefined
        : filters.mediaType === 'image'
          ? AssetTypeEnum.Image
          : AssetTypeEnum.Video,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
    // no withSharedSpaces / albumId / spaceId — own+partners scope only
  };
}
```

Mirrors `album-filter-config.ts`'s private `toSuggestionRequest` (which likewise omits `withSharedSpaces`).

### The filter config

```ts
// recently-added-filter-config.ts (mirrors album-filter-config.ts)
export function buildRecentlyAddedFilterConfig(): FilterPanelConfig {
  return {
    // 9 metadata sections. 'text' is appended in Slice 3 together with its search path, so the text
    // input is never present without a working submit.
    // NOTE (corrected during Slice 3 planning): the `'text'` section is NOT a smart-search query
    // box — `filter-panel.svelte` renders it as `<TextFilter>` editing three *metadata* filters
    // (description / originalFileName / ocr), which already round-trip through the URL and through
    // `buildRecentlyAddedTimelineOptions`. The smart-search query arrives only via `?q=` or the
    // navbar global search. Deferring `'text'` to Slice 3 was therefore a conservative grouping,
    // not a correctness requirement; the "never render a text input without a working submit"
    // rationale below is mistaken about what the section does.
    sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media', 'favorites', 'albums'],
    suggestionsProvider: async (filters) =>
      mapSuggestions(await getFilterSuggestions(buildRecentlyAddedSuggestionRequest(filters))),
    providers: {
      cities: (country, context) => getSearchSuggestions({ $type: SearchSuggestionType.City, country, ...context }),
      cameraModels: (make, context) =>
        getSearchSuggestions({ $type: SearchSuggestionType.CameraModel, make, ...context }),
    },
  };
}
```

`mapSuggestions` uses the exported `getPhotosPersonFilterId` / `getPhotosPersonFilterThumbnailUrl` from
`photos-filter-options.ts` (as album-filter-config does) and maps tags `{id, value}`→`{id, name}`. The
route wraps the config with `withNameCapture(config, personNames, tagNames)` so chips can be labelled.

### TDD steps

1. **Red (options).** Add `buildRecentlyAddedTimelineOptions` + `buildRecentlyAddedSuggestionRequest`
   cases to the existing options spec. Run
   `cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-options.spec.ts`
   → red (`does not provide an export named 'buildRecentlyAddedTimelineOptions'`).
2. **Green (options).** Implement both functions → re-run → pass.
3. **Red (config).** Create `web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts`
   (mock `@immich/sdk`, mirror `album-filter-config.spec.ts`). Run
   `pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-config.spec.ts`
   → red (`buildRecentlyAddedFilterConfig` not exported).
4. **Green (config).** Implement `recently-added-filter-config.ts` → re-run → pass.
5. **Refactor.** De-dup any local mapping; keep functions pure.
6. **Wire the route** (glue): seed `filters` from the URL (`getSearchablePageFilterState`/`State`);
   `options = $derived({ ...buildRecentlyAddedTimelineOptions(filters), grouping: timelineGrouping })`;
   restructure the body to `‹div flex›‹FilterPanel/›‹div›‹FilterToolbar/›‹Timeline/›‹/div›‹/div›` inside
   the existing header; add `<ActiveFiltersBar>`; reuse the exported `handlePhotosRemoveFilter`;
   `syncFilterUrl(nextFilters)` calls `buildSearchablePageUrl(page.url, '', nextFilters.sortOrder, nextFilters)`
   (literal `''` query — no search in this slice); URL→filters `$effect` (filter-only variant of Photos');
   register with `globalSearchManager.registerSearchablePageFilters`. Update the count:
   `hasActiveFilters = $derived(getActiveFilterCount(filters) > 0)`, and
   `countLabel = shouldShowRecentlyAddedCount(count, hasActiveFilters) ? … : undefined`.
   Verify against the e2e scenarios (red before wiring → green after).

### Count derivations added this slice

- `storageKey="gallery-filter-visible-sections-recently-added"` on `<FilterPanel>`.
- `isTimelineEmpty = $derived(!!timelineManager?.isEmptyForOptions(options) && !hasActiveFilters)`
  (verbatim from Photos) → `hidden` on the panel and toolbar gating.
- **Single count, no duplicate:** pass `<ActiveFiltersBar>` **no** `resultCount` and **no**
  `onAddAllToCollection`; the header remains the one count. (Chips + "Clear all" still work.
  "Add all to collection" is intentionally omitted — see §5 decisions.)

### Unit tests (exhaustive)

`buildRecentlyAddedTimelineOptions`:

- **default** → `toEqual({ visibility: Timeline, withStacked: true, withPartners: true, order: Desc, orderBy: CreatedAt })`
  (exact shape — catches any future stray key).
- **`withSharedSpaces` never present** — default (via `toEqual`); with a `country` filter
  (`not.toHaveProperty`); with `isFavorite: true` (`not.toHaveProperty`).
- **`orderBy` always `CreatedAt`** — default; `country`; `isFavorite: true`; `sortOrder: 'asc'`.
- **`withPartners`** — `true` with a non-favorite filter; **absent** with `isFavorite: true`.
- **`order`** — `Desc` for default and `sortOrder: 'relevance'`; `Asc` for `sortOrder: 'asc'`.
- **predicate passthrough** — `personIds`, `city`+`country`, `make`+`model`, `tagIds`, `rating`,
  `mediaType`→`$type` (image/video) and omitted for `all`, trimmed `description`/`originalFileName`/`ocr`
  and omitted when blank, `isNotInAlbum`/`isInAlbum` true-only, `takenAfter`/`takenBefore` for year /
  year+month / custom-bounded / from-only / to-only.
- **multi-filter** combo with `orderBy` still `CreatedAt` and no `withSharedSpaces`.

`buildRecentlyAddedSuggestionRequest`:

- omits `withSharedSpaces`, `albumId`, `spaceId` (always).
- maps `mediaType`; passes `takenAfter`/`takenBefore` (year & custom), `isFavorite`; `personIds`/`tagIds`
  `undefined` when empty, arrays when set.

`buildRecentlyAddedFilterConfig` (mirror `album-filter-config.spec.ts`):

- `sections` equals the **9** metadata sections in plan order.
- `suggestionsProvider` calls `getFilterSuggestions` **without** `withSharedSpaces`/`albumId`/`spaceId`;
  maps tags (`{id, name}`) and people (scoped id via `getPhotosPersonFilterId`, incl. a space-primary
  thumbnail case), passes `hasUnnamedPeople`, custom dates, `isFavorite`, mapped `mediaType`.
- `providers.cities` / `cameraModels` call `getSearchSuggestions` without `withSharedSpaces`/`albumId`/`spaceId`.

### BDD acceptance scenarios (e2e)

```gherkin
Feature: Recently Added filters

  Scenario: Filtering by media type updates grid, URL, and count
    Given the Recently Added view with 20 assets, 5 of them videos
    When I open the filter panel and set Media type = Video
    Then the grid shows 5 assets
    And the header shows "5 items"
    And the URL carries the media-type filter parameter

  Scenario: Removing a filter chip restores the full view
    Given the Recently Added view filtered to Media type = Video
    When I remove the media-type chip
    Then the grid shows all 20 assets
    And the header shows "20 items"

  Scenario: A filter matching nothing shows a zero count, not an empty account
    Given the Recently Added view
    When I apply a Rating = 5 filter that matches no asset
    Then the header shows "0 items"
    And the filter panel stays open so I can change the filter

  Scenario: Filters survive a reload (URL is source of truth)
    Given the Recently Added view filtered to a specific person
    When I reload the page
    Then the person filter is still applied and reflected in the count

  Scenario: Recently Added stays ordered by added date under a filter
    Given assets whose *added* order differs from their *taken* order
    When I apply any metadata filter
    Then the results remain grouped/ordered by added date (newest added first)
```

### Edge cases

| Edge case                                          | Expected                                                                                                                                                                                                                | Verified by                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Filter matches zero assets                         | Panel stays open; count "0 items"                                                                                                                                                                                       | config/options units + e2e "matching nothing" |
| `withSharedSpaces` leakage (any path)              | Never sent in options or suggestions                                                                                                                                                                                    | options `toEqual` + config unit               |
| Future stray key from `buildPhotosTimelineOptions` | Caught                                                                                                                                                                                                                  | options default `toEqual`                     |
| Favorites filter                                   | Own-only (partners excluded)                                                                                                                                                                                            | options unit                                  |
| Any filter combination                             | `orderBy` stays `CreatedAt`                                                                                                                                                                                             | options units + e2e "ordered by added date"   |
| Sort asc/desc                                      | `order` flips; `orderBy` unchanged                                                                                                                                                                                      | options units                                 |
| Count flicker on filter apply (`assetCount`→0→N)   | Accept: momentary "0 items"→"N items" reflects the reload; not gated further (added date, own+partners; extra gating would risk the panel-unmount race Photos avoids with `isEmptyForOptions`). Documented, not hidden. | e2e observes final count; noted decision      |
| Deep-link with filter params                       | Filters seeded from URL on load                                                                                                                                                                                         | e2e "survive a reload" / deep-link            |
| Grouping day↔month via toolbar                     | Grouping changes; temporal anchor preserved                                                                                                                                                                             | mirrors Photos (manual/e2e smoke)             |
| Suggestion fetch failure                           | `FilterPanel`'s own AbortController path; no uncaught throw                                                                                                                                                             | mirrors album/Photos (no new handling)        |

### Done gate

Repo gate as Slice 1 **plus** the e2e web run for `recently-added-filters.e2e-spec.ts`; commit
`feat(web): browse filters for Recently Added (#805)`.

---

## Slice 3 — Text / smart-search section (completes all-10 parity)

**Goal:** add the 10th (`text`) section and the browse↔query mode switch, mirroring Photos'
smart-search wiring, with **`withSharedSpaces` forced `false`** everywhere.

**Files:** `recently-added-filter-config.ts` (append `text` + a query-mode `suggestionsProvider` branch),
its spec (bump to 10 sections + search-branch), the route (add `committedQuery`, `showSearchResults`,
`SmartSearchResults`, smart-facet state), the e2e spec (add search scenarios).

### Changes

- Config `sections` → append `'text'` (now 10, plan order). `suggestionsProvider` branches: browse →
  `getFilterSuggestions` (Slice 2); query → map `searchSmartFacets` facets. `providers.cities`/`cameraModels`
  gain the same browse/query branch.
- Route: `committedQuery` from the URL; `showSearchResults = committedQuery.trim().length > 0`;
  `smartFacets` state + `loadSmartFacets` via `searchSmartFacets({ ...buildSmartSearchFacetsParams({ query, filters, withSharedSpaces: false, language }) })`
  with AbortController cancellation + key-cache (mirror Photos §216–266, `withSharedSpaces` pinned false).
- Render `{#if showSearchResults}<SmartSearchResults searchQuery={committedQuery} {filters} withSharedSpaces={false} total={smartFacetTotal}/>{:else}<Timeline .../>{/if}`.
- `timeBuckets={showSearchResults ? (smartFacets?.timeBuckets ?? []) : timelineBuckets}` on the panel.
- Count: `count = showSearchResults ? (smartFacetTotal ?? 0) : (timelineManager?.assetCount ?? 0)`;
  `hasActiveFilters` also true whenever `showSearchResults`. `clearSearch` mirrors Photos.

### TDD steps

1. **Red (config).** Update the config spec: `sections` now 10; add a search-branch case asserting the
   query-mode provider calls `searchSmartFacets` with `withSharedSpaces: false`. Run the config spec → red.
2. **Green (config).** Append `'text'` and the query branch → pass.
3. **Wire the route** search mode; verify the search e2e scenarios (red-first → green).
4. **Refactor.** Extract the smart-facet loader as a small named function for readability.

### Unit tests

`buildRecentlyAddedFilterConfig`:

- `sections` equals the full **10** in plan order.
- browse-mode provider unchanged (Slice-2 assertions still pass).
- query-mode provider (given an active query) calls `searchSmartFacets` with `withSharedSpaces: false`
  and maps facets to suggestions. (Where the provider needs page state, cover the separable payload
  builder; the rest is e2e.)

### BDD acceptance scenarios (e2e)

```gherkin
Feature: Recently Added text search

  Scenario: A text query switches to search results with a total count
    Given the Recently Added view
    When I type "beach" into the text filter and submit
    Then search results are shown
    And the header shows the search-result total as "N items"

  Scenario: Clearing the query returns to the added-date timeline
    Given the Recently Added view showing text-search results
    When I clear the text query
    Then the added-date timeline is shown again with its item count

  Scenario: Text search stays within own + partner scope
    Given a shared-space asset that would match "invoice"
    When I run a text search for "invoice" in Recently Added
    Then the shared-space asset is not included in the results
```

### Edge cases

| Edge case                         | Expected                                                 | Verified by                                         |
| --------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Empty query submitted             | Stays in browse mode (`showSearchResults` false)         | route logic + e2e                                   |
| Smart-facet fetch failure         | Caught, `console.error`, falls back to prior facets      | mirrors Photos §252–257                             |
| `withSharedSpaces` in search path | Forced `false` (own+partners)                            | config search-branch unit + e2e "own+partner scope" |
| Query then filter change          | Facets refetch (keyed by query+filters); abort in-flight | mirrors Photos key-cache                            |
| Count in query mode               | Uses `smartFacetTotal`, not `assetCount`                 | route derivation + e2e                              |

### Done gate

Repo gate + e2e web run; commit `feat(web): text/smart-search filter for Recently Added (#805)`.

---

## 5. Cross-cutting

### Error handling

- **Filter-suggestion fetch (browse):** the config's `suggestionsProvider` adds no try/catch (matching
  `album-filter-config.ts`); `FilterPanel` owns debouncing + `AbortController` cancellation.
- **Smart-facet fetch (Slice 3):** catch → `console.error` → fall back to the last good facets (mirror
  Photos §252–257).
- **URL navigation:** mirror Photos — `goto(..., { replaceState, keepFocus, noScroll })`; no special handling.

### Decisions taken (open to override)

1. **Text/smart-search is the last slice** — isolates the risky, page-coupled, least-unit-testable
   plumbing. End state still includes all 10 sections.
2. **"Add all to collection" omitted** from Recently Added's `ActiveFiltersBar`, so the header carries the
   single count. Additive later if wanted (pass `resultCount` + `onAddAllToCollection`, and suppress the
   header count while filters are active to avoid duplication).
3. **Favorites filter excludes partner assets** (own-only), matching Photos — new behavior for a new
   capability, so no regression.
4. **The Timeline date filter filters taken-at** while day-grouping reflects added-at; kept as-is (no
   created-at range predicate exists; adding one is backend work / non-goal).
5. **Count flicker on filter apply** ("0 items" for a tick before the filtered count loads) is accepted
   and documented rather than gated with extra state that would risk the panel-unmount race Photos
   guards against.

### Non-goals

- Any server / API / DTO change.
- Photos/videos count breakdown (needs a server stats change).
- Per-day-group counts in the timeline day headers (would edit the shared `Timeline` component).
- Mobile parity (separate filter stack).
- Extracting a shared `<FilteredTimelinePage>` component / shared logic helpers (Approaches B/C).
- Fixing the pre-existing cross-view filter-parity issues #802 / #797 / #796.

## 6. Coverage matrix (every edge case → slice → test)

| #   | Edge case / behavior                                   | Slice | Test                                                            |
| --- | ------------------------------------------------------ | ----- | --------------------------------------------------------------- |
| 1   | Count hidden while loading / empty account             | 1     | unit `shouldShowRecentlyAddedCount(0,false)`; e2e empty library |
| 2   | Count shown for populated library                      | 1     | e2e populated                                                   |
| 3   | Count hidden during multi-select                       | 1     | e2e selecting                                                   |
| 4   | Plural/singular wording                                | 1     | i18n `items_count` (ICU)                                        |
| 5   | `orderBy` always CreatedAt                             | 2     | options units; e2e "ordered by added date"                      |
| 6   | `withSharedSpaces` never in options                    | 2     | options `toEqual` + `not.toHaveProperty`                        |
| 7   | Future stray key regression                            | 2     | options default `toEqual`                                       |
| 8   | `withPartners` inherited / dropped on favorites        | 2     | options units                                                   |
| 9   | `order` asc/desc                                       | 2     | options units                                                   |
| 10  | All predicate passthroughs + date ranges               | 2     | options units                                                   |
| 11  | Suggestion request omits shared/album/space scope      | 2     | options unit                                                    |
| 12  | Config = 9 sections, correct suggestion/provider calls | 2     | config unit                                                     |
| 13  | Filter matches nothing → "0 items", panel stays        | 2     | e2e "matching nothing"                                          |
| 14  | Filters persist via URL / deep-link / reload           | 2     | e2e reload                                                      |
| 15  | Chip removal / clear all                               | 2     | e2e remove chip                                                 |
| 16  | Count flicker on apply                                 | 2     | documented decision; e2e final count                            |
| 17  | Grouping day↔month                                     | 2     | e2e/manual smoke                                                |
| 18  | Config = 10 sections incl. text                        | 3     | config unit                                                     |
| 19  | Text query → search results + search-total count       | 3     | e2e search                                                      |
| 20  | Clear query → back to added-date timeline              | 3     | e2e clear                                                       |
| 21  | Search stays own+partner (no shared spaces)            | 3     | config search-branch unit + e2e scope                           |
| 22  | Empty query submitted → stays browse                   | 3     | route logic + e2e                                               |
| 23  | Smart-facet fetch failure fallback                     | 3     | mirrors Photos (manual/e2e)                                     |

## 7. Process notes for impl-loop

- Slice plans are saved to `docs/superpowers/plans/2026-07-19-recently-added-filters-slice-<n>.md`.
- Each slice: pure-function TDD (red→green with the commands above) → route wiring → e2e acceptance
  (red-first) → repo gate (`check:typescript`, `check:svelte`, `lint`, `test`) + e2e web run → commit → push.
- Slices are independent increments: Slice 1 ships the count alone; Slice 2 adds browse filters; Slice 3
  completes all-10 parity. A later slice may modify an earlier slice's file only for that slice's feature
  (e.g., Slice 3 appends `'text'` to the config from Slice 2).

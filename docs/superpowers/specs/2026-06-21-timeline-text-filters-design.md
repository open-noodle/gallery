# Timeline text filters (description / filename / OCR) — design

**Discussion:** [open-noodle/gallery#722](https://github.com/open-noodle/gallery/discussions/722)
**Date:** 2026-06-21
**Base branch:** `rebase/upstream-rolling-20260509-active` (rolling upstream rebase / v3 cutover). Toolchain is **`mise`**, not `make`.

## Problem

A user wants to **list every asset whose description, filename, or OCR text matches a search term** — not just a preview. Today that is impossible:

- The ⌘K command palette already has **Filename / Description / OCR** preview modes, but each only requests `size: 5` (`global-search-manager.svelte.ts:2570-2573`), and the photos result section is never given a "See all" callback (`global-search.svelte:827-836`; `global-search-section.svelte:45-53` renders the dormant `cmdk_see_all` button only when `onSeeAll` is provided — no section provides it).
- Pressing **Enter** in any of those modes does **not** run a field search. It calls `activateSearch(topSearchMatch.rawQuery)` with the plain typed text (`global-search-manager.svelte.ts:2055`), which navigates to the `/photos` timeline with `?q=<text>` — a **smart/CLIP** search (`photos/+page.svelte` → `searchSmartFacets`). The selected Filename/Description/OCR mode is silently discarded.
- The timeline **filter panel** has people / location / camera / tags / rating / media / favorites / albums, but **no free-text field** for description, filename, or OCR.

The capability exists at the data layer — `MetadataSearchDto` accepts all three and the SQL is implemented (`database.ts:725-740`: `originalFileName` ILIKE + trigram index, `description` ILIKE, `ocr` trigram `%>>` + GIN index) — but it is only reachable through the truncated palette preview, never as a full, paginated, filterable result set.

## Approach

Make **description / filename / OCR** first-class **timeline filters**, and bridge the palette's existing preview modes to the full filtered timeline.

1. **Timeline result set** — teach the timeline bucket query (`withTimeBucketAssetFilters`, the single chokepoint for every bucket query) to filter by `originalFileName` / `description` / `ocr`, reusing the **exact** SQL conditions already used by `searchAssetBuilder` (`database.ts:725-740`). The repository option type already carries these fields (`AssetBuilderOptions`, inherited by `TimeBucketOptions`), and `buildTimeBucketOptions` already spreads them through (`timeline.service.ts:50,91`), so the only server gap is the DTO schema + the three `$if` conditions.
2. **Filter panel** — add a new **"Text"** filter section (on the photos and shared-space timelines) with three independent text inputs that AND-combine with each other and with every other filter, persisted in the URL like all other filters.
3. **⌘K handoff** — wire the dormant `onSeeAll` for the photos section, and make **Enter** mode-aware: in Filename/Description/OCR mode both navigate to the timeline with the matching new filter param. Smart mode is unchanged.

This was chosen over **reusing the dedicated `/search` page** (which already renders these three fields and paginates) because that page is a **legacy surface** the fork is moving away from — it does not host the `FilterPanel`, so results there can't be combined with people/tags/dates, and investing in it works against the consolidation onto the timeline. The data layer change is small and the timeline is where users already expect filters.

It mirrors the **additive, low-conflict** pattern of the recent ["Has album" filter](2026-06-19-has-album-filter-design.md): every new field is threaded alongside an existing one (`city` / `make`), never rewriting existing behavior — keeping upstream rebases low-conflict (the fork's guiding constraint).

### Naming (locked, for consistency)

| Layer                                      | Description   | Filename           | OCR   |
| ------------------------------------------ | ------------- | ------------------ | ----- |
| Server DTO / repo option / timeline option | `description` | `originalFileName` | `ocr` |
| Web `FilterState` field                    | `description` | `originalFileName` | `ocr` |
| URL param (friendly short name)            | `description` | `filename`         | `ocr` |

`FilterState` mirrors the server option names exactly (like `city`/`make`/`model`). The URL layer maps the friendly `filename` ⇄ `originalFileName`, exactly as it already maps `type`⇄`mediaType`, `favorite`⇄`isFavorite`, `album`⇄`isInAlbum`/`isNotInAlbum`. `description` and `ocr` are identical across all layers (no mapping).

### Matching semantics (unchanged from existing field search)

- **Substring, accent-insensitive.** `originalFileName` / `description` → `f_unaccent(col) ILIKE '%' || f_unaccent(term) || '%'`; `ocr` → `f_unaccent(ocr_search.text) %>> f_unaccent(tokenizeForSearch(term))`. Byte-for-byte the same predicates as `database.ts:725-740`, so metadata search and timeline filtering behave identically.
- **AND.** Each text field is independent and AND-combined with the others and with all non-text filters (same as every existing filter).
- **Empty / whitespace-only input is treated as unset** (no predicate emitted), so an empty box never collapses the timeline to zero.

### Scope

- **Server:** timeline bucket query (covers `getTimeBuckets`, `getTimeBucketAssets`/`getTimeBucket`, `getTimeBucketCovers` — all route through `withTimeBucketAssetFilters`). Applies to the photos timeline **and** shared-space timelines (same query path, `spaceId` set).
- **Web:** the photos timeline and shared-space timelines (both are "searchable pages" hosting the `FilterPanel`); the ⌘K palette handoff.
- **Description trigram index** migration (filename and OCR are already indexed).

### Out of scope

- **The dedicated `/search` page** (`routes/(user)/search/...`). Legacy; intentionally not extended. No regression — its existing `description`/`originalFileName`/`ocr` rendering is untouched.
- **Map (`/map`) and album filter surfaces.** The shared `FilterPanel` is configured per-surface via its `sections` array; `'text'` is added only to the photos and spaces configs, so map/album panels are unaffected. The new `FilterState` fields simply stay unset there.
- **Facet-suggestion narrowing by text filters.** The people/tags/camera suggestion dropdowns will continue to narrow by the _other_ active filters but **not** by the new text fields (free-text fields don't generate facets, and wiring them would expand the change into the `SmartSearchFacets` / `getFilterSuggestions` DTOs and request builders). The result set is fully filtered; only the suggestion-narrowing is deliberately bounded. Documented so it isn't mistaken for an omission.
- **Mobile (Flutter/Dart).** The DTO change flows to the Dart client via codegen, but no mobile filter UI is added (separate surface; mobile cannot be verified locally in this worktree — Flutter toolchain mismatch, CI-only). Clean follow-up.
- **OCR availability gating.** The palette already exposes the OCR mode unconditionally (`global-search-footer.svelte:17`), and an OCR filter on an instance without OCR simply matches an empty `ocr_search` table (no rows, no error). The "Text" section therefore shows all three inputs unconditionally, consistent with the palette. (Gating OCR on a feature flag is a possible future refinement for both surfaces, tracked separately.)

## Changes

### 1. Server

**DTO — `server/src/dtos/time-bucket.dto.ts`**

Add three optional string fields to `TimeBucketQueryBaseSchema` (inherited by `TimeBucketDto`, `TimeBucketAssetDto`, `TimeBucketCoverDto`):

```ts
originalFileName: z.string().optional().describe('Filter by original filename (substring, case/accent-insensitive)'),
description: z.string().optional().describe('Filter by asset description (substring, case/accent-insensitive)'),
ocr: z.string().optional().describe('Filter by OCR text content (substring, case/accent-insensitive)'),
```

**SQL — `server/src/repositories/asset.repository.ts › withTimeBucketAssetFilters`**

Three additive `$if` blocks reusing the `database.ts:725-740` predicates. `description` joins `asset_exif` — fold it into the **existing** conditional `asset_exif` join (currently gated on `bbox || city || country || make || model || rating`) by adding `|| !!options.description` to that guard and a `q.where(...)` inside the block; `originalFileName` needs no join; `ocr` joins `ocr_search`:

```ts
// inside the existing asset_exif join block, alongside city/make/model:
if (options.description) {
  q = q.where(sql`f_unaccent(asset_exif.description)`, 'ilike', sql`'%' || f_unaccent(${options.description}) || '%'`) as any;
}
// new top-level $if blocks:
.$if(!!options.originalFileName, (qb) =>
  qb.where(sql`f_unaccent(asset."originalFileName")`, 'ilike', sql`'%' || f_unaccent(${options.originalFileName}) || '%'`),
)
.$if(!!options.ocr, (qb) =>
  qb.innerJoin('ocr_search', 'asset.id', 'ocr_search.assetId')
    .where(() => sql`f_unaccent(ocr_search.text) %>> f_unaccent(${tokenizeForSearch(options.ocr!).join(' ')})`),
)
```

Add `originalFileName?` / `description?` / `ocr?` to `AssetBuilderOptions` (`asset.repository.ts:86`, alongside `city`/`make`/`model`) — `TimeBucketOptions` inherits them. Add `tokenizeForSearch` to the `src/utils/database` import.

**Service — `server/src/services/timeline.service.ts`** — **no change.** `buildTimeBucketOptions` destructures a fixed set and spreads `...options` (`:50,91`), so the new DTO fields flow into `TimeBucketOptions` automatically.

**Index — schema decorator + fork migration** (mirrors the person-name trigram index, the most recent analogue):

1. **Schema decorator** on `server/src/schema/tables/asset-exif.table.ts` — `@Index({ name: 'idx_asset_exif_description_trigram', using: 'gin', expression: 'f_unaccent("description") gin_trgm_ops' })` (same shape as `asset.table.ts`'s `asset_originalFilename_trigram_idx` and `person.table.ts`'s `idx_person_name_trigram`). Required so the schema-drift check matches the DB.
2. **Fork migration** `server/src/schema/migrations-gallery/1782000000000-AddAssetExifDescriptionTrigramIndex.ts` — `up()` runs `CREATE INDEX IF NOT EXISTS … USING gin (f_unaccent("description") gin_trgm_ops)` **and** an `INSERT INTO "migration_overrides" … ON CONFLICT DO NOTHING` row registering the expression index (the fork pattern for `f_unaccent` indexes sql-tools can't otherwise reconcile); `down()` drops the index + deletes the override. Place in `migrations-gallery/` (never touched by rebases); `postbuild` copies it into `dist/schema/migrations/`. `f_unaccent` is already `IMMUTABLE` (the existing `originalFileName`/`ocr_search` trigram indexes use it).

### 2. Web — `FilterState` + the "Text" filter section

**`web/src/lib/components/filter-panel/filter-panel.ts`**

- `FilterSection` union — add `'text'`.
- `FilterState` — add `description?: string`, `originalFileName?: string`, `ocr?: string`.
- `getActiveFilterCount` — `+1` per non-empty trimmed text field.
- `clearFilters` — reset all three to `undefined`.
- (`buildFilterContext` / `FilterContext` — **not** extended; that type feeds facet-suggestion narrowing, which is out of scope.)

**New component — `web/src/lib/components/filter-panel/text-filter.svelte`** (the only genuinely new UI). Three labelled debounced text inputs:

```ts
interface Props {
  description?: string;
  originalFileName?: string;
  ocr?: string;
  onChange: (next: { description?: string; originalFileName?: string; ocr?: string }) => void;
}
```

- Labels reuse existing i18n: `description` ("Description"), `file_name_text` ("File name"), `ocr` ("OCR").
- Test ids: `text-filter-description`, `text-filter-filename`, `text-filter-ocr`.
- Empty/whitespace input emits `undefined` for that field (never `''`).
- Internal debounce (~250 ms) before `onChange`, matching the palette's typed-search responsiveness, so each keystroke doesn't refetch the timeline.

**`web/src/lib/components/filter-panel/filter-panel.svelte`**

- Import `TextFilter`; add `case 'text'` to the `hasActiveFilter` switch (`:621`) → true if any of the three trimmed fields is non-empty.
- Add the section label (`:344-351` map) and the render block (alongside `:772-834`) wiring `TextFilter` → `updateFilters`.
- Include `'text'` in the effect-tracked `current` object so timeline refetches when a text field changes.

**Per-surface section config** — add `'text'` to the `sections` arrays in the two timeline pages only:

- `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte:281`
- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:362`

(Map/album configs unchanged → section hidden there.)

### 3. Web — plumbing (mirror `city`/`make`)

**URL params — `web/src/lib/utils/searchable-page-search.ts`**

- `SEARCHABLE_PAGE_FILTER_PARAMS` — add `'description'`, `'filename'`, `'ocr'`.
- `SearchablePageFilterState` key union — add `'description' | 'originalFileName' | 'ocr'`.
- `getSearchablePageFilterState` — read `description`/`ocr` directly; read `filename` → `result.originalFileName`. Trim; ignore empty.
- `appendSearchablePageFilterParams` — serialize `description`→`description`, `originalFileName`→`filename`, `ocr`→`ocr` (skip empty/undefined). (`clearSearchablePageFilterParams` already clears every key in `SEARCHABLE_PAGE_FILTER_PARAMS`, so the new params clear for free.)

**Timeline request options — `web/src/lib/utils/photos-filter-options.ts` + `space-filter-options.ts` + `space-search.ts`**

In the `FilterState → timeline options` builders, alongside `city`/`make`/`model`:

```ts
if (filters.description?.trim()) base.description = filters.description.trim();
if (filters.originalFileName?.trim()) base.originalFileName = filters.originalFileName.trim();
if (filters.ocr?.trim()) base.ocr = filters.ocr.trim();
```

`TimelineManagerOptions = Omit<AssetApiGetTimeBucketsRequest, …>` already includes the three fields after the SDK regen, and `getApiRequestOptions` (`request-options.ts:4-10`) spreads everything not on its blocklist → the fields reach `getTimeBuckets`/`getTimeBucket` **with no change to `request-options.ts` or `types.ts`**. Also add the three fields to each util's **remove-filter** handling so a "remove text filter" action clears them.

**Active filters bar — `web/src/lib/components/filter-panel/active-filters-bar.svelte`**

Three new chips in the `chips` `$derived.by` (`:82`), each emitted when its field is non-empty:

- description → `{ type: 'description', icon: mdiTextBox, label: <value> }`
- filename → `{ type: 'filename', icon: mdiFileOutline, label: <value> }`
- ocr → `{ type: 'ocr', icon: mdiOcr /* or mdiTextRecognition */, label: <value> }`

Add the three to the chip `type` union. The removal is dispatched by chip type via `onRemoveFilter(type, id)` (`active-filters-bar.svelte:35,203`); extend the two page-level handlers — `handleRemoveActiveFilter` (`photos/+page.svelte:550`) and `handleRemoveFilter` (`spaces/…/+page.svelte:1069`) — with `description`/`filename`/`ocr` cases that clear exactly that field.

**i18n** — reuse the existing `description` / `file_name_text` / `ocr` keys (already translated). New **fork-only** keys must be added to **`i18n/en.json`, `i18n/de.json`, and `i18n/fr.json`** in the same alphabetical slot (fork convention — fork-only strings are not Weblate-synced):

- `filter_text` — the "Text" section heading (EN `"Text"`, DE `"Text"`, FR `"Texte"`).
- `cmdk_see_all_results` — the count-less palette button (EN `"See all results"`, DE `"Alle Ergebnisse anzeigen"`, FR `"Voir tous les résultats"`).

(No separate placeholder keys — the inputs reuse their field labels as placeholders.)

### 4. Web — ⌘K → timeline handoff (`global-search-manager.svelte.ts`, `global-search.svelte`, `global-search-section.svelte`)

**Mode-aware navigation, centralized in `activateSearch`.** All three Enter/click sites call `manager.activateSearch(manager.topSearchMatch.rawQuery)` — keydown Enter (`global-search.svelte:556`) and the top-search-row `onclick` in the palette (`:771`) and dropdown (`:1177`) variants. Rather than edit three sites, **branch inside `activateSearch`**: when `this.mode ∈ {metadata, description, ocr}` and the trimmed text is non-empty, delegate to a new private `navigateToFieldResults(text, mode)`; otherwise the existing smart / typed-search path runs unchanged. This makes Enter, both top-row clicks, and re-running a recent (`activateRecent` → `activateSearch`, `:1806`) all mode-aware in **one** place. The empty-query branch (`activateSearch('')`, `:533`) is untouched.

`navigateToFieldResults(text, mode)`:

- Take the **current** searchable-page filters (`this.searchablePageFiltersProvider?.()`, the provider the existing sort-order navigation reads at `:1559`), or a fresh `createFilterState()` when none / not on a searchable page; **set the one field** (`metadata`→`originalFileName`, `description`→`description`, `ocr`→`ocr`); `goto(buildSearchablePageUrl(base, '', this.searchSortOrder, filterState))`. `base` = current searchable page, else `new URL('/photos', page.url)` (the existing `/photos` fallback, `:1553`). No `?q=` is set. Preserving the current filters means a "See all" launched from a timeline that already has a person/date filter **adds** the text constraint (AND) rather than discarding the rest.

**"See all results" affordance — count-less.** There is **no true match count** anywhere: `searchAssets`/`searchSmart` responses report `total = count = items.length` (`search.service.ts:549-550`, `mapResponse`), and the photos provider sets `total: items.length` capped at `size: 5` (`global-search-manager.svelte.ts:2562,2578`). So the existing `cmdk_see_all` gate `status.total > items.length` (`global-search-section.svelte:45`) **can never fire** for photos. Fix without a count:

- **`global-search-section.svelte`** — add optional `seeAllAlways?: boolean` + `seeAllLabel?: string`. When `seeAllAlways`, render the "See all" button whenever `onSeeAll && status.status === 'ok'` (≥1 result), using `seeAllLabel`. The existing count-gated path (`status.total > items.length`, label `cmdk_see_all`) is unchanged for every other section.
- **`global-search.svelte`** — on the photos `GlobalSearchSection` (palette `:827` **and** dropdown `:1234`), wire the button only in field modes:
  `onSeeAll={manager.mode !== 'smart' ? () => manager.navigateToFieldResults(manager.query, manager.mode) : undefined}` and `seeAllAlways={manager.mode !== 'smart'}` with `seeAllLabel={$t('cmdk_see_all_results')}`. Smart mode is unchanged (Enter→`?q=`; no button).

### 5. SDK / OpenAPI

The web passes the three fields through the generated `@immich/sdk` `getTimeBucket(s)` / `getTimeBucketCovers` types, so it must typecheck against a regenerated SDK. Workflow (rolling toolchain): build server → `mise //:open-api` (full Java regen → TS SDK **and** Dart client; commit `open-api/immich-openapi-specs.json` + the Dart client). Per fork memory, a TS-only regen hides drift and fails CI "OpenAPI Clients" — run the full `mise //:open-api`. Mobile app code is not changed (see Out of scope).

## Testing (TDD — failing test first, then implementation)

### Server

- **`server/src/dtos/time-bucket.dto.spec.ts`** — `TimeBucketDto` accepts and passes through `originalFileName` / `description` / `ocr`; omitting them yields `undefined`; whitespace preserved (trimming is the web's job, but document server behavior).
- **`server/src/repositories/asset.repository.spec.ts`** — reuse the existing `compileTimeBucketFilters(options)` helper (`:17`, offline Kysely → compiled `.sql`, no DB; already used by the has-album SQL tests):
  - `originalFileName` set → emits `f_unaccent(asset."originalFileName") ilike …` and **no** extra join.
  - `description` set → joins `asset_exif` and emits the description `ilike` predicate; **reuses** the single `asset_exif` join when `city`/`make` are also set (assert the join appears once).
  - `ocr` set → `inner join "ocr_search"` + `%>>` predicate.
  - all three + people/tags/date set → one query, all predicates AND-ed, `asset_exif`/`ocr_search` each joined once.
  - none set → byte-identical to the pre-change snapshot (no regression).
- **Medium / DB test** (`server/src/repositories/asset.repository.spec.ts` medium, requires the rolling DB) — seed assets with known description / filename / OCR rows; assert `getTimeBuckets`/`getTimeBucket` returns exactly the matching asset ids for each field and for combined filters; accent-insensitivity (`café` matches `cafe`); substring (`ac采` partial); the new description index is used (optional `EXPLAIN` sanity).
- **`server/src/services/timeline.service.spec.ts`** — `getTimeBuckets` / `getTimeBucket` / `getTimeBucketCovers` forward `originalFileName` / `description` / `ocr` into the repository options (spread passthrough).

### Web — filter state & components

- **`web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts`** — `getActiveFilterCount` counts each non-empty text field (and treats whitespace-only as inactive); `clearFilters` clears all three.
- **`web/src/lib/components/filter-panel/__tests__/text-filter.spec.ts`** (new) — renders three inputs with the right labels/test-ids and current values; typing fires `onChange` with the trimmed field (after debounce); clearing an input emits `undefined` (not `''`); the three inputs are independent.
- **`web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`** — `'text'` section renders only when in `config.sections`; `hasActiveFilter('text')` true iff any text field set; changing a text input fires `onFiltersChange` with the field; clears reset it.
- **`web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`** — each non-empty text field produces its chip with the right label; removing a chip clears exactly that field and leaves the others.

### Web — utils

- **`web/src/lib/utils/__tests__/searchable-page-search.spec.ts`** — round-trips: `?description=foo` ⇄ `description: 'foo'`; `?filename=bar` ⇄ `originalFileName: 'bar'`; `?ocr=baz` ⇄ `ocr: 'baz'`; empty params omitted; `clearSearchablePageFilterParams` removes all three; combined with existing params (`people`, `album=has`) coexist.
- **`web/src/lib/utils/__tests__/photos-filter-options.spec.ts`** — text fields map onto timeline options (`originalFileName`/`description`/`ocr`); whitespace-only / unset omitted; remove-text-filter clears them.
- **`web/src/lib/utils/__tests__/space-filter-options.spec.ts`** + **`space-search.spec.ts`** — mirror (build options + remove cases).

### Web — page integration

- **`web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`** — `getTimeBuckets`/`getTimeBucket` called with `description`/`originalFileName`/`ocr` when the corresponding URL params are present; absent when not.
- **`web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`** — same, with `spaceId` set.

### Web — ⌘K handoff

- **`web/src/lib/components/global-search/__tests__/global-search-section.spec.ts`** — with `seeAllAlways` + `onSeeAll`, the button renders for `status: 'ok'` even when `total === items.length` (the field-mode case), using `seeAllLabel`; without `seeAllAlways` the existing count-gated behavior is unchanged (no button when `total === items.length`); never renders for `empty`/`loading`.
- **`web/src/lib/managers/global-search-manager.svelte.spec.ts`** (or the existing manager spec) — `activateSearch` in `metadata`/`description`/`ocr` mode calls `goto` with the matching param (`?filename=` / `?description=` / `?ocr=`) and **no** `?q=`; in `smart` mode it keeps the existing `?q=` smart path (no regression); `navigateToFieldResults` merges into the current `searchablePageFiltersProvider` filters (existing person/date param preserved); falls back to `/photos?<param>=…` when not on a searchable page; empty query is a no-op.
- **`web/src/lib/components/global-search/__tests__/global-search.spec.ts`** — in a field mode the photos section shows "See all results →" when ≥1 result; clicking it triggers the field navigation; in smart mode no button is shown and Enter keeps `?q=`.

### E2E

- **`e2e`** Playwright (web): set a Description (and Filename, OCR) filter on `/photos`, assert the grid shows exactly the seeded matching assets and the param persists in the URL / survives reload; combine with a person/date filter and assert AND semantics. Add an ⌘K flow: Filename mode → "See all" → lands on the filtered timeline. (Reuse the existing filter-panel E2E harness if present; otherwise the unit/component/integration coverage above is the floor.)

## Edge cases

- **Empty / whitespace-only input** — treated as unset at every layer (component emits `undefined`; util/URL/server skip the predicate). An empty box never zeroes the timeline. Covered by component + util + dto tests.
- **`description` + `city`/`make`/`rating` together** — all use `asset_exif`; the conditional join must appear **once**. The `description` predicate is added _inside_ the existing join block (not a second join). Asserted in the repository SQL test.
- **All three text fields + non-text filters** — single query, all predicates AND-ed; `asset_exif` and `ocr_search` each joined at most once. Asserted.
- **OCR filter on an instance without OCR** — `ocr_search` is empty → zero matches, no error (consistent with the palette exposing OCR unconditionally). Documented; medium test seeds zero OCR rows and asserts empty result, not failure.
- **Accent / case / CJK** — `f_unaccent` + `ILIKE` (filename/description) and `tokenizeForSearch` + `%>>` (OCR) are byte-identical to metadata search, so behavior matches the palette preview exactly. Medium test covers `café`⇄`cafe` and a CJK substring.
- **Shared-space timeline** — the same `withTimeBucketAssetFilters` path runs with `spaceId` set, so space members filtering by description/filename/OCR see only assets they can already see (the existing space scoping predicates are unchanged and AND-ed). Spaces page integration test covers this.
- **Deep-link / reload** — params live in the URL (`?description=`/`?filename=`/`?ocr=`) and round-trip through `getSearchablePageFilterState` → identical to every other filter; shareable and reload-stable. Util test covers the round-trip.
- **"See all" with no real count** — the palette has no full match count (`total = items.length`, capped at 5), so the field-mode "See all results" is count-less and shows whenever the preview has ≥1 result. It may appear when ≤5 results exist (where the preview already shows them all); this is intentional — it still routes to the filterable full-page timeline view. Covered by the section + manager tests.
- **Smart-mode handoff unchanged** — `activateSearch` only branches for the three field modes; `smart` mode keeps its `?q=` typed-search navigation. Asserted (no-regression) in the manager test.
- **"See all" preserves active filters** — launching it from a timeline already filtered by a person/date merges the text field in (AND), not a fresh search. Asserted via the `searchablePageFiltersProvider` test.
- **Description index immutability** — the trigram index uses `f_unaccent(...)`; the index creation requires `f_unaccent` to be `IMMUTABLE`. The fork's existing `originalFileName` and `ocr_search` trigram indexes use the same expression, so this is already satisfied; the migration mirrors them.

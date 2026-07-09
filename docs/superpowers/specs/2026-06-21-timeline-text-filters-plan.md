# Timeline text filters (description / filename / OCR) — Implementation Plan

> **For agentic workers / `/impl-loop`:** This plan is a sequence of numbered **slices**. Implement them in order — each is an independently reviewable, test-covered increment. Use `superpowers:test-driven-development` per task: **write the failing test first, run it red, write the minimal code, run it green, commit.** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users list every asset whose **description**, **filename**, or **OCR text** matches a search term, as a full, filterable, paginated result set — by adding these as first-class **timeline filters** (FilterPanel + URL + server bucket query) and bridging the ⌘K palette's existing preview modes to the filtered timeline.

**Spec:** [`2026-06-21-timeline-text-filters-design.md`](2026-06-21-timeline-text-filters-design.md) — read it first. Discussion [#722](https://github.com/open-noodle/gallery/discussions/722).

**Architecture:** Additive, mirroring the recent [Has-album filter](2026-06-19-has-album-filter-design.md). The data layer already supports all three fields (`MetadataSearchDto`, `searchAssetBuilder`); we thread them through the **timeline** path: `TimeBucketDto` → `withTimeBucketAssetFilters` (server), and `FilterState` → URL params → `getTimeBuckets` request (web). The ⌘K handoff makes `activateSearch` mode-aware so Filename/Description/OCR modes navigate to the filtered timeline instead of a smart search.

**Tech Stack:** NestJS 11 + Kysely + Zod DTOs (server), SvelteKit + Svelte 5 runes + `@immich/sdk` (web), Vitest (`pnpm test`), Playwright (e2e). **Toolchain is `mise`** (rolling/v3 branch), not `make`.

## Global Constraints

- **Base branch:** `rebase/upstream-rolling-20260509-active`. **Use `mise`** (`mise //:open-api`, `mise //:sql`, `mise //:check`), never `make`.
- **TDD, strictly:** every task writes the failing test first → red → minimal code → green → commit. No code lands without its test green.
- **Additive / rebase-clean:** thread each new field alongside an existing one (`city`/`make`); never rewrite existing behavior. Fork migrations go in `server/src/schema/migrations-gallery/` only.
- **Imports:** server uses the `src/` alias (no relative imports); web uses `$lib/`.
- **i18n:** new **fork-only** keys go into **`i18n/en.json`, `i18n/de.json`, `i18n/fr.json`** in the same alphabetical slot (reused keys `description`/`file_name_text`/`ocr` already exist).
- **Lint:** zero-warning ESLint, strict TS. Run the fast `pnpm check` (svelte-check + tsc) / `tsc --noEmit` in the loop; **defer the one slow full `pnpm lint`** to the final gate (Slice 7).
- **Mobile:** the DTO change flows to the Dart client via codegen (Slice 2); **no mobile UI** is added and mobile **cannot be verified locally** (Flutter toolchain mismatch — CI-only).
- **Naming (locked):** server/option/`FilterState` = `originalFileName` / `description` / `ocr`; URL params = `filename` / `description` / `ocr` (the URL layer maps `filename`⇄`originalFileName`).

## File Structure

**New:**

- `server/src/schema/migrations-gallery/<ts>-AddAssetExifDescriptionTrigramIndex.ts` — GIN trigram index on `asset_exif.description`.
- `web/src/lib/components/filter-panel/text-filter.svelte` — the three text inputs.
- `web/src/lib/components/filter-panel/__tests__/text-filter.spec.ts`.
- `web/src/lib/components/global-search/__tests__/global-search-section.spec.ts` — if not already present (otherwise extend).
- `e2e/src/web/specs/timeline-text-filters.e2e-spec.ts` (or nearest existing web-spec dir).

**Modified — server:** `dtos/time-bucket.dto.ts` (+ `.spec.ts`), `repositories/asset.repository.ts` (+ `.spec.ts`), `services/timeline.service.spec.ts`.
**Modified — SDK:** `open-api/immich-openapi-specs.json`, generated TS SDK (`fetch-client.ts`) + Dart client.
**Modified — web:** `lib/components/filter-panel/filter-panel.ts` (+ `__tests__/filter-state.spec.ts`), `filter-panel.svelte` (+ `__tests__/filter-panel.spec.ts`), `active-filters-bar.svelte` (+ `__tests__/active-filters-bar.spec.ts`), `lib/utils/searchable-page-search.ts` (+ `__tests__/…spec.ts`), `lib/utils/photos-filter-options.ts` / `space-filter-options.ts` / `space-search.ts` (+ specs), `lib/managers/global-search-manager.svelte.ts` (+ spec), `lib/components/global-search/global-search-section.svelte` + `global-search.svelte`, the photos + spaces `+page.svelte` (sections config + remove-filter handler + page specs), `i18n/{en,de,fr}.json`.

---

### Slice 1 — Server: timeline bucket query filters + description index

**Goal:** `getTimeBuckets` / `getTimeBucket` / `getTimeBucketCovers` accept and apply `originalFileName` / `description` / `ocr` (substring, accent-insensitive), reusing the `database.ts:725-740` predicates. Service unchanged (spread passthrough).

- [ ] **DTO test (red):** `server/src/dtos/time-bucket.dto.spec.ts` — `TimeBucketDto` parses/passes `originalFileName`, `description`, `ocr`; omitted → `undefined`.
- [ ] **DTO impl:** add the three `z.string().optional()` fields to `TimeBucketQueryBaseSchema` (`time-bucket.dto.ts`). Green.
- [ ] **SQL test (red):** `asset.repository.spec.ts`, via the existing `compileTimeBucketFilters(options)` helper (`:17`):
  - `{ originalFileName: 'x' }` → `.sql` contains `f_unaccent` + `"originalFileName"` + `ilike`, and **no** `asset_exif` join.
  - `{ description: 'x' }` → joins `asset_exif` + description `ilike`.
  - `{ ocr: 'x' }` → `inner join "ocr_search"` + `%>>`.
  - `{ description: 'x', city: 'y', make: 'z' }` → `asset_exif` joined **once** (assert single occurrence).
  - `{}` → unchanged vs the current snapshot (no new joins/predicates).
- [ ] **Option type:** add `originalFileName?` / `description?` / `ocr?` to `AssetBuilderOptions` (`asset.repository.ts:86`, alongside `make`/`model`); `TimeBucketOptions` inherits them. Add `tokenizeForSearch` to the `src/utils/database` import.
- [ ] **SQL impl:** in `withTimeBucketAssetFilters` add `|| !!options.description` to the existing `asset_exif`-join guard + the `description` `ilike` inside that block; add top-level `$if` blocks for `originalFileName` (no join) and `ocr` (`ocr_search` join + `%>>`). Green.
- [ ] **Service passthrough test:** `timeline.service.spec.ts` — `getTimeBuckets` forwards the three fields into repository options (spread). No `timeline.service.ts` change.
- [ ] **Index (decorator + migration):** add `@Index({ name: 'idx_asset_exif_description_trigram', using: 'gin', expression: 'f_unaccent("description") gin_trgm_ops' })` to `schema/tables/asset-exif.table.ts`; add fork migration `migrations-gallery/1782000000000-AddAssetExifDescriptionTrigramIndex.ts` (`up`: `CREATE INDEX IF NOT EXISTS … USING gin (f_unaccent("description") gin_trgm_ops)` + `INSERT INTO "migration_overrides" … ON CONFLICT DO NOTHING`; `down`: drop + delete override). Mirrors `1775165531374-AddPersonNameTrigramIndex.ts`.
- [ ] **Behavioral coverage:** matching behavior (substring / accent / CJK / OCR-empty) is identical to the already-tested `searchAssetBuilder` metadata path (byte-identical predicates), so it's covered by the offline SQL assertions above + existing metadata-search coverage. A dedicated `getTimeBuckets` medium test (`pnpm test:medium`, rolling DB) is an optional follow-up — **not run locally** (testcontainers/DB unavailable in this worktree); leave to CI medium if added.
- [ ] **Verify:** `cd server && pnpm test` green; `mise //:sql` (live DB) → confirm **no** change to `asset.repository.sql` (the `@GenerateSql` example params don't set the new fields). Commit.

### Slice 2 — SDK / OpenAPI regen

**Goal:** generated clients carry the three new `getTimeBucket(s)` request fields so the web typechecks.

- [ ] Build server, then `mise //:open-api` (full Java regen → TS SDK + Dart). Per fork memory, a TS-only regen hides drift and fails CI "OpenAPI Clients".
- [ ] **Verify:** `open-api/immich-openapi-specs.json` shows the fields on `TimeBucketDto`/`TimeBucketAssetDto`/`TimeBucketCoverDto`; `AssetApiGetTimeBucketsRequest` (TS) includes them; Dart client regenerated. `mise //:check` (or `cd web && pnpm check`) compiles. Commit `specs.json` + TS `fetch-client.ts` + Dart client.

### Slice 3 — Web: FilterState + URL params

**Goal:** the `FilterState` and URL layers know the three fields. Pure web utils — no SDK dependency.

- [ ] **Test (red):** `filter-panel/__tests__/filter-state.spec.ts` — `getActiveFilterCount` +1 per non-empty trimmed field (whitespace-only = inactive); `clearFilters` clears all three.
- [ ] **Impl:** `filter-panel.ts` — add `'text'` to `FilterSection`; `description?`/`originalFileName?`/`ocr?` to `FilterState`; update `getActiveFilterCount` + `clearFilters`. (`createFilterState` unchanged — fields default `undefined`.) Green.
- [ ] **Test (red):** `lib/utils/__tests__/searchable-page-search.spec.ts` — `?description=foo`⇄`description`; `?filename=bar`⇄`originalFileName`; `?ocr=baz`⇄`ocr`; empty omitted; `clearSearchablePageFilterParams` removes all three; coexists with `people`/`album=has`.
- [ ] **Impl:** `searchable-page-search.ts` — add `'description'`/`'filename'`/`'ocr'` to `SEARCHABLE_PAGE_FILTER_PARAMS`; extend `SearchablePageFilterState`; read in `getSearchablePageFilterState` (`filename`→`originalFileName`, trim, skip empty); write in `appendSearchablePageFilterParams` (`originalFileName`→`filename`). Green.
- [ ] **Verify:** `cd web && pnpm test -- --run <these specs>`; `pnpm check`. Commit.

### Slice 4 — Web: Text filter UI + panel + chips

**Goal:** the FilterPanel shows a "Text" section (photos + spaces) with three debounced inputs; active chips render and remove. Depends on Slice 3.

- [ ] **Test (red):** `filter-panel/__tests__/text-filter.spec.ts` — renders three inputs (test-ids `text-filter-description|filename|ocr`) with current values; typing fires `onChange` with the trimmed field after debounce; clearing emits `undefined`; inputs independent.
- [ ] **Impl:** `text-filter.svelte` (props `description?`/`originalFileName?`/`ocr?` + `onChange`; labels reuse `description`/`file_name_text`/`ocr`; ~250 ms debounce; empty→`undefined`). Green.
- [ ] **Test (red):** `filter-panel/__tests__/filter-panel.spec.ts` — `'text'` section renders only when in `config.sections`; `hasActiveFilter('text')` true iff any field set; changing an input fires `onFiltersChange` with the field.
- [ ] **Impl:** `filter-panel.svelte` — import `TextFilter`; add `case 'text'` to `hasActiveFilter` (`:621`); add the section label (`:344`) + render block (`:772`); include the fields in the effect-tracked `current`. Add `'text'` to the `sections` arrays in `photos/+page.svelte:281` and `spaces/…/+page.svelte:362` (only). Green.
- [ ] **Test (red):** `filter-panel/__tests__/active-filters-bar.spec.ts` — each non-empty field → its chip; removing a chip clears exactly that field.
- [ ] **Impl:** `active-filters-bar.svelte` — three chips + `type` union; extend `handleRemoveActiveFilter` (`photos/+page.svelte:550`) and `handleRemoveFilter` (`spaces/…:1069`) with `description`/`filename`/`ocr` cases.
- [ ] **i18n:** add `filter_text` (EN `"Text"`, DE `"Text"`, FR `"Texte"`) to `i18n/{en,de,fr}.json`.
- [ ] **Verify:** web component tests green; `pnpm check`. Commit.

### Slice 5 — Web: timeline request wiring + page integration

**Goal:** setting a text filter actually drives the timeline result set end-to-end. Depends on Slice 2 (SDK types) + Slice 3.

- [ ] **Test (red):** `lib/utils/__tests__/photos-filter-options.spec.ts` — non-empty fields map onto timeline options (`originalFileName`/`description`/`ocr`); whitespace-only/unset omitted; remove-text-filter clears them. Mirror in `space-filter-options.spec.ts` + `space-search.spec.ts`.
- [ ] **Impl:** in `photos-filter-options.ts` / `space-filter-options.ts` (the **timeline** option builders), set `base.originalFileName`/`base.description`/`base.ocr` from the trimmed `FilterState` fields (alongside `city`/`make`); add the three to the remove-filter handling. (No change to `request-options.ts` / `types.ts` — `getApiRequestOptions` spreads them. `space-search.ts` is **intentionally not touched** — it builds the smart-search **facets** DTO, which is the out-of-scope facet-narrowing path and lacks `description`/`originalFileName` fields.) Green.
- [ ] **Test (red) + verify:** `photos-page.spec.ts` + `spaces-page.spec.ts` — `getTimeBuckets`/`getTimeBucket` called with `description`/`originalFileName`/`ocr` when the URL params are present; absent otherwise. Green; `pnpm check`. Commit.

### Slice 6 — Web: ⌘K → timeline handoff

**Goal:** Filename/Description/OCR modes in the palette navigate to the filtered timeline (Enter, top-row click, and a count-less "See all results" button). Depends on Slice 3.

- [ ] **Test (red):** `global-search-manager.svelte.spec.ts` — `activateSearch` in `metadata`/`description`/`ocr` mode `goto`s the searchable page with `?filename=`/`?description=`/`?ocr=` and no `?q=`; `smart` mode keeps `?q=` (no regression); `navigateToFieldResults` merges into `searchablePageFiltersProvider` filters (existing person/date preserved); `/photos` fallback when off a searchable page; empty query no-op.
- [ ] **Impl:** in `global-search-manager.svelte.ts`, branch `activateSearch` on `this.mode` (field modes → new `navigateToFieldResults(text, mode)`); implement `navigateToFieldResults` (build `FilterState` from current filters + the one field → `buildSearchablePageUrl` → `goto`). Green. (No edits to the three Enter/click sites — they all route through `activateSearch`.)
- [ ] **Test (red):** `global-search/__tests__/global-search-section.spec.ts` — with `seeAllAlways` + `onSeeAll`, button renders for `status: 'ok'` even when `total === items.length`, using `seeAllLabel`; without `seeAllAlways`, count-gated behavior unchanged; never for `empty`/`loading`.
- [ ] **Impl:** `global-search-section.svelte` — add `seeAllAlways?`/`seeAllLabel?` props + render branch. `global-search.svelte` — on the photos section (palette `:827` + dropdown `:1234`) pass `onSeeAll`/`seeAllAlways` in field modes only, `seeAllLabel={$t('cmdk_see_all_results')}`.
- [ ] **i18n:** add `cmdk_see_all_results` (EN `"See all results"`, DE `"Alle Ergebnisse anzeigen"`, FR `"Voir tous les résultats"`) to `i18n/{en,de,fr}.json`.
- [ ] **Test + verify:** `global-search.spec.ts` — field mode shows "See all results →" with ≥1 result and triggers the navigation; smart shows none. Green; `pnpm check`. Commit.

### Slice 7 — E2E + final gates

**Goal:** prove the feature end-to-end and pass all gates.

- [ ] **E2E — deferred (documented).** The fork's Playwright `ui` project (`e2e/src/ui/specs`, the only home for a filter-panel/timeline UI test) runs its webServer via `docker compose up --build` (`playwright.config.ts:72`) and uses a sophisticated mock-network/timeline-generator harness gated on `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`. It is **not runnable in this worktree** (no Docker stack), so a new spec can't be authored+verified here without high risk of a broken, undebuggable CI failure. The behaviour is fully covered by the layers below (server DTO/SQL/service + web state/URL/component/util/page-integration + cmdk manager/integration). A Playwright `ui` spec (set a Description filter on `/photos` → assert the seeded matches + `?description=` persistence; ⌘K Filename → "See all results" → filtered timeline) is a clean follow-up for someone with the e2e stack.
- [x] **Final gates (runnable):** server `pnpm lint` ✓ clean; web `pnpm lint`; `cd server && pnpm test` ✓ (4706); full web unit suite; `tsc` ✓ clean (my files); OpenAPI regenerated + committed in Slice 2 (no further DTO change → in sync); no `*.sql` diff (the `@GenerateSql` example params don't set the new fields, so `asset.repository.sql` is unchanged). Medium tests + `mise //:sql` (needs DB) + `build-mobile` + mobile static analysis run in **CI**.

## Done criteria

- A user can filter `/photos` (and shared-space) timelines by description, filename, and/or OCR, combined with any other filter, with results paginating and the filter persisted in the URL.
- The ⌘K Filename/Description/OCR modes offer "See all results →" and Enter that land on the filtered timeline.
- All unit/component/integration/e2e tests green; lint + typecheck clean; OpenAPI + SQL in sync; no upstream files rewritten beyond additive changes.

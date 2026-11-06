# Aspect ratio filter

Status: spec and mockup approved by the requester on 2026-11-06. Written against `upstream/main` at `ae178054c` (Immich base 3.3.5). `3983e4381`
changes none of the filter, DTO, schema, revert or web filter panel files cited here.
Mockup: `specs/mockups/2026-11-06-aspect-ratio-filter.html`, approved.

Source labels used below: a file path with a line is read from the code at that commit. "M1" and "M2" are the measurement
runs defined under Performance. Every M1 and M2 number in this spec is measured with integer codes, not with the final
helper expression (see Performance). "Open" marks anything not verified.

## Summary

The web filter panel gains one new section, Aspect ratio, with five classes: Landscape, Square, Portrait, Panorama and
Tall panorama. Selecting classes narrows every panel path: OR inside the section, AND with every other section.

The class is pre-computed and stored by PostgreSQL in one full expression index on `asset` over `width` and `height`.
There is no new table and no new column. One dependency-free helper expression is the single source for the index and
for every query. The filter suggestions request gains one probe statement that reports which classes exist in the
current set. Mobile and stock clients do not change.

## Problem

Users with large mixed archives cannot narrow the library by picture shape: portrait for social media or photo books,
panoramas for prints, square scans, vertical or horizontal phone videos. No UI workaround exists today.

Evidence:

- Fork discussion #287, 2 votes. Upstream requests immich-19478 (open, 44 votes) and immich-9098 (open, 25 votes).
  Upstream PRs immich-28726 and immich-28739 were closed for staleness on 2026-10-14, not rejected.
- The maintainer rejected classifying on the fly (Discord, 2026-11-05: "you'll need to pre-compute and store this
  info"), and approved the full expression index on one condition (Discord, 2026-11-06: "Yeah if it's benchmarked at
  that size, looks good"). The upstream reviewer on immich-28739 asked for a stored, indexed value too.
- Filter loading is already slow (#960, #1108, #1125, #1234). The existing media type statement alone takes 1,123 to
  1,187 ms for a space member (M2, measured with integer codes), so the budget for new work is tight.

## Goals and non-goals

Goals:

1. Every web surface with the filter panel shows the section between Albums and Text whenever the scope holds at least
   two classes.
2. Selecting classes narrows results: OR within the section, AND with every other section.
3. The condition is applied identically on every panel path: timeline buckets, bucket assets, bucket covers, map
   markers, filter suggestions and second-level suggestion lists, smart search, smart facets, and metadata search used by
   "add all results", for Gallery clients and for stock clients (the `upstreamTakenRange` branch).
4. Every other section's option list narrows by the selected classes. The section's own row availability narrows by all
   other active filters and excludes its own selection.
5. With no class selected, `GET /search/suggestions/filters` and `POST /search/smart/facets` regress by at most
   max(5 percent, 20 ms), including a filtered set where classes are absent. Exactly one statement is added. Every class
   selection is at least as fast as the unfiltered timeline. Selections of square, panorama and tall panorama use the
   class index.
6. Stock Immich apps, older Gallery apps and the Gallery mobile app behave exactly as before.

Non-goals: mobile (a later slice through `POST /search/options`, with a server feature flag then); counts per class;
exact ratio or resolution filters; 360 projection detection; admin thresholds; typed-search tokens, palette commands and
an asset viewer "filter by aspect ratio" action; statistics, random and large-assets search; changing the behaviour of
other filters or of "add all results".

## Current state with paths

- `asset.width` and `asset.height` are nullable integers (`server/src/schema/tables/asset.table.ts:191-195`).
- They describe the displayed shape. Metadata extraction swaps them for sideways orientations
  (`server/src/services/metadata.service.ts:398-400`), videos map their rotation to an orientation in `getVideoTags`
  (`metadata.service.ts`, from line 1223), and an edit writes its output dimensions
  (`server/src/services/media.service.ts:207-208`, with `getOutputDimensions` at `:430`) which later metadata runs keep
  (`metadata.service.ts:414-415`).
- The shared filter vocabulary is `AssetFilter`, `assetFilterKeys` and `assetFilterConditions` in
  `server/src/utils/asset-filter.ts:25-47` and `:52-84`, a fork file added by #1158.
  `searchAssetBuilderWithLocalTaken` (`:106-119`) has two branches: the stock branch returns upstream's builder without
  `withAssetFilter`, the Gallery branch passes only the taken range. Both need the new condition.
- `withAssetFilter` already runs on the timeline (`server/src/gallery/utils/time-bucket-filter.ts:280`), suggestions
  (`server/src/gallery/repositories/filter-suggestion.repository.ts:679`), smart facets
  (`server/src/gallery/repositories/smart-facet.repository.ts:985`) and map markers
  (`server/src/repositories/shared-space.repository.ts:2245`).
- Requests reach those paths by spread, so no upstream service line is needed: `searchMetadata`
  (`server/src/services/search.service.ts:174`, `:180`), `resolveSmartSearch` (`:626-633`), `getSearchSuggestions`
  (`:352-353`), `getFilterSuggestions` (`:398`) and `buildTimeBucketOptions`
  (`server/src/services/timeline.service.ts:47`, `:62`). The map is the exception: it copies fields one by one
  (`server/src/services/shared-space.service.ts:1724-1760`).
- `getFilterSuggestions` runs its facets in one `Promise.all` (`filter-suggestion.repository.ts:510-526`). The media
  type statement is at `:870-880`. Smart facets run inside one transaction over the temp table
  `smart_search_facet_candidates` (`smart-facet.repository.ts:337-353`, `:954-963`), and `SmartFacetExclude` and
  `smartFacetFilterExcludes` are at `:30-50`.
- Precedents: the dependency-free SQL module `server/src/gallery/utils/cleanup-sql.ts`, the expression `@Index` at
  `asset.table.ts:102-106`, the migration with override rows `1799500000000-AddCleanupTables.ts`, the plan test in
  `server/test/medium/specs/repositories/cleanup.repository.spec.ts:113`, and `sql.lit` in `cleanup.repository.ts:51`.
- Web: `ALL_FILTER_SECTIONS` (`web/src/lib/components/filter-panel/filter-panel.ts:47`) is the single section source;
  adding a value makes it appear on every surface (`web/src/lib/utils/__tests__/filter-section-parity.spec.ts`).
  `PRE_LEDGER_FILTER_SECTIONS` (`filter-panel.ts:71`) is frozen, so a new section is revealed to existing users.
  Availability lives in `filter-availability.ts`, from the rules in
  `specs/2026-08-04-interdependent-filter-sections-910-design.md`.
- `getPersonsBySpaceId` (`shared-space.repository.ts:2368`) and `getAccessibleTags`
  (`filter-suggestion.repository.ts:431`) apply only the taken range. Neither is a filter panel path: the first serves the
  space people grid, and no production surface sets a `tags` provider. They stay unchanged.

## Options considered

All numbers are M2, measured with integer codes, as change against the unfiltered timeline for the member Photos timeline /
largest Space timeline.

| Option | Result | Decision |
| --- | --- | --- |
| Full expression index on `asset` | Square and panoramas 4.0 to 6.7 ms; Landscape -33 / -39 percent; Portrait -81 / -83 percent; probes 5.1 to 7.7 ms; 4.2 MB, built in 386 ms | **Chosen**, accepted by the maintainer |
| Fork table `asset_aspect` kept by triggers | Rare classes 8 to 17 ms, but Landscape +114 / +200 percent, availability 1,127 to 1,828 ms, backfill 2.3 s | Rejected: every filtered query and the availability check pay a join |
| Stored generated column on `asset` | Not measured on real data | Rejected: a fork column on an upstream table breaks fork rule 1 |
| Class computed per query, no index | Rare classes only halve (-43 to -53 percent); every class scans the whole scope; probes 221 to 227 ms when a class is absent | Rejected |
| Partial index on rare classes | Rare classes 4 to 8 ms, Landscape unchanged, Portrait -36 percent, no index for the probes | Rejected |
| Store the ratio as a real number | Not measured | Rejected: needs range predicates and a CASE per row for availability, and classes are the only consumer. If upstream adds `asset.aspectRatio`, the helper can switch to it |
| Availability merged into the media type DISTINCT | Adds 166 to 282 ms | Rejected: the probes are far cheaper |

Also rejected: three or four classes, an orientation plus panorama toggle, admin thresholds, the `DEPRECATED_FLAT_FIELD`
tag, a client version check or web feature flag on the request side, two web PRs, the field name `format`.

## Design

### Classes

L is the longer side and S the shorter side, cast to bigint on the operand. Width or height NULL, zero or negative means
no class. Otherwise an asset has exactly one class. A test over all pairs 1 to 2000 plus edge values proves this for the final
expression (see Testing).

| Order | API value | en | de | Rule |
| --- | --- | --- | --- | --- |
| 1 | `landscape` | Landscape | Quer | width > height, not square, L < 2S |
| 2 | `square` | Square | Quadratisch | 50 L <= 51 S |
| 3 | `portrait` | Portrait | Hoch | height > width, not square, L < 2S |
| 4 | `panorama-wide` | Panorama | Panorama | width > height, L >= 2S |
| 5 | `panorama-tall` | Tall panorama | Panorama hoch | height > width, L >= 2S |

Panorama means shape: 360 degree images (2:1) are Panorama, phone screenshots from 9:18 to 9:21 are Tall panorama. The
2.0 boundary equals the Library Cleanup screenshot rule (`specs/2026-09-23-library-cleanup-design.md`, `isScreenshot`).
Thresholds are fixed before the first release, because changing them means rebuilding the index.

Known limitations, both inherited from the stored dimensions:

- Assets without dimensions have no class. They disappear while a class is selected and are never counted as a class.
  There is no fallback. The number of such assets on a real migrated library is open.
- `getVideoTags` maps video rotations of -90, 0, 90 and 180 only (`metadata.service.ts`, from line 1223). A video whose
  stream reports 270 gets no orientation, so its width and height are not swapped and it lands in the wrong class. This
  is upstream behaviour and this feature does not change it.

### Data model

No new table and no new column. The stored class is the index `asset_aspectClass_idx`, a full expression index on `asset`
with no WHERE clause. PostgreSQL maintains it on every write path (upload, metadata extraction, edits, a stock Immich
server on a Gallery database) with no trigger and no backfill job. A write loses its HOT update only when it changes
`width` or `height`. The index also gives the planner statistics for the class: in M1 (measured with integer codes) the class
without an index made Landscape 34 percent slower than unfiltered, with the full index 12 percent faster.

New dependency-free module `server/src/gallery/utils/aspect-class-sql.ts`, on the pattern of `cleanup-sql.ts`:

```sql
(CASE
  WHEN "width" IS NULL OR "height" IS NULL THEN NULL
  WHEN "width" <= 0 OR "height" <= 0 THEN NULL
  WHEN 50 * GREATEST("width"::bigint, "height"::bigint)
    <= 51 * LEAST("width"::bigint, "height"::bigint) THEN 'square'
  WHEN GREATEST("width"::bigint, "height"::bigint)
    >= 2 * LEAST("width"::bigint, "height"::bigint)
    THEN CASE WHEN "width" > "height" THEN 'panorama-wide' ELSE 'panorama-tall' END
  WHEN "width" > "height" THEN 'landscape'
  ELSE 'portrait'
END)
```

The expression carries its own outer parentheses. It follows the Cleanup precedent (`cleanup.repository.ts:74-75`): the
constant is unqualified and `asset.table.ts` imports it for the `@Index`, and the queries use the `"asset"`-qualified form
derived from the same constant, so they are safe in joined queries. The module exports the expression, the derived
qualified form and the five values in table order.

`AssetAspectClass` and `AssetAspectClassSchema = z.enum(values).meta({ id: 'AssetAspectClass' })` go in
`server/src/gallery/enum.ts`, built from the helper's values.

### Migration

File `server/src/schema/migrations-gallery/1800100000000-AddAssetAspectClassIndex.ts`. `1799900000000` and
`1800000000000` are taken (`AddAssetDataSaverVideoTable`, `AddAssetFaceVideoFrameTable`); the newest upstream migration is
`1792213725597`.

- `up()`: plain `CREATE INDEX` (precedent `1799500000000-AddCleanupTables.ts`), the `index_asset_aspectClass_idx` row in
  `migration_overrides`, then `ANALYZE "asset"`.
- `down()`: `DROP INDEX` and the override delete. The class is derived from upstream columns, so there is no data to move
  back (fork rule 3).
- Registered in `migrations-gallery/ORDER`.
- `scripts/revert-to-immich.sql`: `DROP INDEX IF EXISTS` next to line 811 (step 4), the override name next to line 938
  (step 6), the migration name next to line 1233 (step 8).

`ANALYZE` is needed because expression statistics exist only after an analyze, and on a large, quiet library autovacuum
may not run one soon. Both measurement runs analyzed after building the index, so the migration matches what was measured.
Upstream has the precedent (`server/src/schema/migrations/1792213725597-AddAssetFaceAssetState.ts:49`). Its duration at
634,000 assets is on the measurement list under Performance.

### API

Additive only. Optional request field `aspectClasses: AssetAspectClass[]` in:

| Schema | File | Endpoints |
| --- | --- | --- |
| `GalleryTimeBucketQueryExtension` | `server/src/gallery/dtos/time-bucket.dto.ts:16` | timeline buckets, bucket, bucket covers |
| `GallerySearchSuggestionExtension` | `server/src/gallery/dtos/search.dto.ts:58` | `GET /search/suggestions` |
| `FilterSuggestionsRequestBaseSchema` | `gallery/dtos/search.dto.ts:208` | `GET /search/suggestions/filters` |
| `FilteredMapMarkerSchema` | `server/src/dtos/gallery-map.dto.ts:26` | filtered map markers |
| `GalleryMetadataSearchExtension` | `gallery/dtos/search.dto.ts:94` | `POST /search/metadata` |
| `GallerySmartSearchExtension` | `gallery/dtos/search.dto.ts:109` | `POST /search/smart` |
| `SmartSearchFacetsSchema` | `server/src/dtos/search.dto.ts:440` | `POST /search/smart/facets` |

It is not in `GallerySearchFilterExtension`, so statistics, random and large-assets search do not get it, and not in the
`POST /search/options` schema.

Validation follows `tagIds`: GET requests use the existing array preprocess (`gallery/dtos/search.dto.ts:65-66`), an
unknown value and an empty string return 400, and an empty array means no filter. The field is not tagged
`DEPRECATED_FLAT_FIELD`. Metadata or smart search sent with a V3 `filter` and `aspectClasses` returns 400, next to the
`spaceId` rejection in `structuredSearchViewerRequest` (`server/src/utils/viewer-scope.ts:282`, with `aspectClasses` added
to `StructuredSearchRequest` at `:268`), because a silent fallthrough would answer with a wider set than was asked for.

Optional response field `aspectClasses?: AssetAspectClass[]` on `FilterSuggestionsResponseSchema`
(`gallery/dtos/search.dto.ts:172`) and `SmartSearchFacetsResponseSchema` (`:187`): the classes present, own selection
excluded. It stays optional, which is what makes it safe for the mobile OpenAPI patching and for fork rule 6.

### Authorization

No new authorization decision. The filter only narrows sets each surface already authorizes, through the existing
checks: `checkAccess` and `resolveViewerScope` in the services, and the viewer-scoped queries behind them. It widens
nothing, so fork rule 7's role matrix and an opt-in do not apply. The availability probes run over the same
`buildFilteredAssetIds` set as every other facet, so they cannot report a class from outside the viewer's scope. The tests
below prove this.

### Server

- `aspectClasses` joins `AssetFilter` and `assetFilterKeys`. `assetFilterConditions` emits it as
  `<expression> IN (...)`, with the validated values through `sql.lit`, so the index is used regardless of plan caching.
- `searchAssetBuilderWithLocalTaken` forwards it in both branches.
- Typing uses fork-side types only: `FilterSuggestionFilterOptions`, `SmartFacetExclude` (`'aspect'`) and
  `smartFacetFilterExcludes` (`aspect: ['aspectClasses']`), `StructuredSearchRequest`, and an intersection type for the
  options of `getFilteredMapMarkers` and of `searchAssetBuilderWithLocalTaken`. No new field on upstream option types.
- Map: one copy line in `shared-space.service.ts`, inside the block at `:1724-1760`.
- Availability, one new entry in the `Promise.all` of `getFilterSuggestions`, called with
  `without(options, 'aspectClasses')`:

  ```sql
  SELECT EXISTS (<buildFilteredAssetIds query> AND <class expr> = 'landscape'),
         ...,
         EXISTS (<buildFilteredAssetIds query> AND <class expr> = 'panorama-tall')
  ```

  Each probe adds the class predicate inside the filtered-id query, which is the form M2 measured. It stops at the first
  match and can use the index. The form `asset WHERE id IN (<subquery>) AND <class expr> = ...`, which the #910 probes
  use, is not allowed here: it can force the whole subquery before stopping. The EXPLAIN plan test covers this. The new
  statement joins the `sortQueries` list of the `@GenerateSql` decorator, and `mise sql` regenerates the query file. The
  media type statement stays unchanged. **The probes never ship without the index**: without it they take 221 to 227 ms
  when a class is absent (measured with integer codes).
- Smart facets: the class list comes from `buildSmartFacetFilteredAssetIds(trx, options, 'aspect')` inside the existing
  transaction, either as one DISTINCT or as probes. The PR measures both and keeps the cheaper. It must not read the temp
  table directly, because the other filters are applied outside it, and goal 4 needs them. The candidate query
  (`smart-facet.repository.ts:918`) calls `searchAssetBuilderLegacy`, which ignores `aspectClasses`, so the selection never
  bakes into the temp table and self-exclusion works with no change to its `without(...)` list.
- Stop condition: if EXPLAIN on a real VectorChord database shows smart search leaving the vector index because of the
  class predicate, implementation stops and reports.

The filter never ships without the stored class, so all of this and the index are one server PR. That PR carries the A/B
numbers the maintainer asked for.

### Web

A second PR, after the mockup is approved.

- New section `aspect` in `ALL_FILTER_SECTIONS` between `albums` and `text`, with a component in
  `web/src/lib/components/filter-panel/`. No exclusion in `filter-section-parity.spec.ts`: the server honours the filter
  on every surface.
- Rows follow `albums-filter.svelte`: first row "All" (existing key `all`), outlined while nothing is selected, never
  greyed, click clears the selection. Then the five classes in table order, each with a shape icon, as multi-select
  toggles with `aria-pressed` in a labelled `role="group"`. Selecting a class deselects All, deselecting the last class
  reselects it.
- The section is revealed and expanded automatically for existing users, and can be hidden through the cog.
- `getActiveFilterCount` counts the section once however many classes are selected, as it does for tags.
- All rows stay visible. A class absent from the current set is greyed and not clickable. A selected class that is absent
  is shown selected and dimmed (the active style with `opacity-50`, as `isOrphaned` in `media-type-filter.svelte:30-36`), in
  the orphan style of people, places, cameras and tags, and stays clickable. The rule in
  section 2.4 of the #910 spec covers rating stars and media buttons, whose meaning comes from position or which e2e
  suites click directly. These rows are labelled values, so it does not apply, and its guard test stays unchanged.
- Section availability is a new case in `filter-availability.ts`, on the #910 model:

  | Baseline classes | Current classes | Own selection | Verdict |
  | --- | --- | --- | --- |
  | fewer than two | fewer than two | none | `unavailable`, hidden |
  | two or more | fewer than two | none | `empty`, greyed with (0) |
  | not known | fewer than two | none | `empty`, greyed with (0), never hidden on missing information |
  | any | two or more | any | `available` |
  | any | any | present | `available`, never hidden or greyed (#910 section 4.4 rule 1) |

  A response without `aspectClasses` counts as empty (fork rule 6). In query mode the first unfiltered response is the
  baseline; only a filtered deep link has none, and then the section is never hidden (#910 section 4.5).
- Count gate: aspect is not excluded, so a selected class greys other sections that become empty, for example Portrait
  plus no tags gives Tags (0).
- Active filters bar: one chip per selected class, through the existing `labelKey` and `labelValues` pattern
  (`active-filters-bar.svelte:148-151`). Removing a chip removes that class.
- URL: `aspect=landscape,square`. Decoding keeps only the five values and removes duplicates, encoding uses table order.
- Hand-written places that must carry the field, each with one assertion in its existing spec:
  `FilterSection`, `FilterState`, `createFilterState`, `clearFilters`, `getActiveFilterCount`, `FilterContext` and
  `buildFilterContext`, `FilterSuggestionsResponse` (all in `filter-panel.ts`); `hasActiveFilter`, `sectionTitles`
  (`filter-panel.svelte:383`) and the refetch effect (from `:117`); `isSectionEmpty`; the `searchKey` of
  `smart-search-results.svelte`; `buildSmartSearchParams` and `QUERY_MODE_FILTER_HANDLING` (`space-search.ts`);
  `buildPhotosTimelineOptions`, also used by Recently added; `buildSpaceTimelineOptions`; `applyCommonFilterFields`
  (album detail and pickers); `applyCommonMapFilters` and the `buildMapTimelineOptions` default; the suggestion requests
  (`buildMapFilterConfig`, `toSuggestionRequest`, `buildRecentlyAddedSuggestionRequest`); the four response mappers and
  `emptyFilterSuggestions`; `filterStateToSearchTerms`; `handleRemoveFilter`; `encodeFilterParams`, `decodeFilterParams`,
  `FILTER_URL_PARAMS` and `DecodedFilterState`.
- Residual risk: a tab left open across a server downgrade sends a field the server ignores.

### Mobile

Out of scope. One deferred row goes into the "Web → mobile after" parity table of
`specs/2026-10-23-mobile-search-redesign-design.md`: "Aspect ratio | deferred (later slice through `POST /search/options`,
with a server feature flag)".

### Admin settings

None. Thresholds are fixed.

### i18n

Keys go in `i18n/gallery/en.json` and the nine locales in one commit, sorted.

| Key | en | de |
| --- | --- | --- |
| `filter_aspect_ratio` | Aspect ratio | Seitenverhältnis |
| `filter_aspect_landscape` | Landscape | Quer |
| `filter_aspect_square` | Square | Quadratisch |
| `filter_aspect_portrait` | Portrait | Hoch |
| `filter_aspect_panorama_wide` | Panorama | Panorama |
| `filter_aspect_panorama_tall` | Tall panorama | Panorama hoch |
| `filter_chip_aspect_ratio` | Aspect ratio: {value} | Seitenverhältnis: {value} |

The chip key follows the existing `filter_chip_*` pattern. Each locale reuses its `crop_aspect_ratio_square` wording for
Square (de Quadratisch, fr Carré, it Quadrato, nl Vierkant, pl Kwadrat, es Cuadrado, ru Квадрат, zh_Hans and zh_Hant 方形).
"All" reuses the existing `all` key.

## Compatibility matrix

| Pairing | Behaviour |
| --- | --- |
| Older Gallery app, new server | Never sends the field, ignores the optional response field. No change |
| New web, older server | Does not occur in normal operation, because the server serves the web app. A stale tab sends a field the server ignores. A response without `aspectClasses` hides the section (fails closed) |
| Gallery mobile, any version | Optional response field, no request field. No change |
| Stock Immich app, Gallery server | Never sends the field. The stock branch of the search builder only matters to a client that does. No change |
| Stock Immich server, Gallery database | The index stays correct, because PostgreSQL maintains it on stock writes too. Stock queries ignore it. Its override row shows as the documented drift warning. The revert drops both |

## Upstream impact

| Upstream file | Change | Lines |
| --- | --- | --- |
| `server/src/schema/tables/asset.table.ts` | one import, one `@Index` | +2 |
| `server/src/dtos/search.dto.ts` | one field in the facets `.extend`, written as `aspectClasses: GallerySmartSearchExtension.aspectClasses`, so no new import | +1 |
| `docs/docs/features/sharing.md` | the sentence at line 15 names the new filter. It is a sentence, not a list | 1 changed |

Generated files (OpenAPI spec, SDK, `server/src/queries/*.sql`) are regenerated, not merged. `i18n/*.json` stay untouched.
All other server and web files in this spec are fork files. The upstream diff grows by the lines above and by nothing
else.

Open: `refs/upstream/v3.3.5` does not exist in this clone, so the baseline `git diff --stat` per file is not measured yet.
The server PR reports it.

Rebase risk: `asset.table.ts` is a recurring conflict point (`specs/upstream-reports/2026-10-22-upstream-sync-v3.3.5.md`
line 39, MEDIUM), and one more decorator adds little to that. If upstream rebuilds `width` or `height`, the index must be
recreated, and the upstream preflight should be checked for that at each rebase.

## Switch-back

Nothing to move back: the class lives only in the index and derives from upstream columns. `down()` and
`revert-to-immich.sql` remove the index, its override row and the migration name. `revert-to-immich.spec.ts` guards the
index drop (`:147`) and the step 8 name (`:130`), and the Revert-to-Immich validation workflow proves the round trip with
stock Immich.

## Performance

The numbers come from runs on the requester's production library.

**Validity.** M1 and M2 computed the class as integer codes 1 to 5 (`pg_temp.cls()` in `aspect-bench-v2.sql`), not as the
text values of the final helper. Every number below is therefore "measured with integer codes". They justify the design,
but they do not yet meet the maintainer's benchmark condition: the server PR re-measures with the final helper expression,
and only those numbers count.

| Field | Run M1 (owner view) | Run M2 (space member view) |
| --- | --- | --- |
| Environment | PostgreSQL 14.19, same major as `docker/docker-compose.yml:59` (14, VectorChord 0.4.3); shared_buffers 2 GB, work_mem 32 MB, jit off, random_page_cost 1.1 | same |
| Data | 634,041 assets, one owner | same; 11 users, 5 spaces (3 fed by one linked library each, one of them also by an album; 2 by albums); the member reaches 633,685 assets through 3 timeline spaces; largest space 368,115 |
| Query shape | simplified timeline bucket counts and media type DISTINCT | exact SQL compiled from the real repositories at `946fc31`: `getTimeBuckets` for the member's Photos timeline and the Space timeline, and the media type statement for both. Assumed: no partners, nothing hidden |
| Method | each variant in its own transaction ending in ROLLBACK; one warm-up, three interleaved runs, median; all output columns evaluated; plan checked for index use | same |
| Script, date | `aspect-bench.sql`, 2026-11-05 | `aspect-bench-v2.sql`, 2026-11-05 |

Results (M2, all measured with integer codes):

- Unfiltered timeline: 730 to 975 ms.
- Square and both panoramas: 4.0 to 6.7 ms. Landscape: 612 / 488 ms (-33 / -39 percent). Portrait: 172 / 125 ms (-81 / -83
  percent). Every plan for a selected class used the index.
- Probe statement: 5.1 ms (Photos) and 6.8 ms (Space) without other filters, 7.1 to 7.7 ms with a video filter where
  classes are absent.
- Index: 4.2 MB (4,312 kB) at 634,000 assets, built in 386 ms.
- Class counts: 1,894 tall panoramas, 1,319 panoramas, 2,141 squares.

Still to measure, for the server PR, with the final helper expression:

| Item | Status |
| --- | --- |
| Every M2 number above, again with the text values of the final helper | Required before the numbers count as the maintainer's benchmark condition |
| Smart facets, DISTINCT over the temp set against probes | Open |
| Map markers | Open |
| Metadata search | Open |
| Member with partners, hidden spaces or hidden albums (subtraction arm) | Open |
| Smart search with the class predicate on a real VectorChord database | Open, stop condition above |
| Write cost on upload and metadata extraction | Synthetic only, within noise |
| Assets without dimensions on a real migrated library | Open |
| Duration of `ANALYZE "asset"` at 634,000 assets | Open |

The harness (`aspect-sql-capture.spec.ts`, `aspect-bench-v2.sql`) is never committed. It is adapted to the final
expression and extended to these paths, the requester runs it, and the output goes into the PR. The numbers must come
from PostgreSQL 14, at least 600,000 assets, a space member who owns none of the assets, the exact server SQL, and every
variant inside a transaction that ends in ROLLBACK.

## Security and privacy

The filter narrows only. The class derives from dimensions a client can already read on any asset it may see. The
availability response reveals which classes exist in the viewer's own filtered set, and nothing beyond it. API values are
validated against the enum before they reach `sql.lit`, so no user text reaches the query. No personal data is stored.

## Testing

- `server/test/medium/specs/repositories/asset-filter-parity.spec.ts`: exact expected ids per class, OR and AND cases on
  every path in goal 3. It does not cover the stock branch today, so it gains runs under both search branches.
- New `server/test/medium/specs/gallery/aspect-ratio-filter.medium.spec.ts`: self-exclusion, narrowing, NULL and boundary
  rows, and that availability for a non-member never reveals classes of assets outside its scope.
- EXPLAIN plan medium test after `cleanup.repository.spec.ts:113`: square and both panorama selections and the probe
  statement use `asset_aspectClass_idx`, and the probes keep the class predicate inside the filtered-id query.
- `schema-drift.spec.ts` is the parity guard between the helper and the index. It needs no separate parity test.
- `rbac-oracle.medium.spec.ts`: the forced snapshot change adds only `aspectClasses: []` to each facets block, because the
  oracle assets have no dimensions. No visibility changes. The PR explains this.
- Class boundaries: a test over all pairs 1 to 2000 plus edge values runs the final expression and checks that each pair
  gets exactly the class of the table above. The expression is SQL, so it runs in PostgreSQL through `generate_series`, in
  the gallery medium spec.
- Unit tests: DTO validation (unknown value, empty string, empty array), the V3 mix rejection, and the `Promise.all` entry.
- The gallery medium spec also checks that the smart facets class list honours the other active filters and ignores its own
  selection.
- Web: `filter-availability` truth table above, the section component, URL round trip, chips, and one assertion per
  hand-written place. The #910 guard test stays unchanged.
- e2e: a sized-image helper in a fork file, and `aspect` in the section lists of the five suites that assert sections
  (`e2e/src/specs/web/*-filter*.e2e-spec.ts`, `e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts`).
- The search contract fixtures in `mobile/test/fixtures/search_contract/` that answer `GET /search/suggestions/filters`
  gain the optional response field.
- Fork rule 8: new tests go in fork test files, and upstream-owned tests stay unchanged, such as
  `server/src/services/search.service.spec.ts`. Fork-added tests inside shared files may be extended: the exact assertions
  in `server/test/medium/specs/repositories/search.repository.spec.ts` test the fork methods `getSmartSearchFacets` and
  `getFilterSuggestions` (added in #456) and gain `aspectClasses: []`.

## Documentation

- `docs/docs/features/dynamic-filter-suggestions.md`: table row, the row greying rationale, statement counts, a web-only
  note.
- `docs/docs/features/map-filtering.md`: the new filter.
- `docs/docs/features/sharing.md`: line 15.
- The limitations (assets without dimensions, the 270 degree video rotation) go in the user-facing text.

## Open questions

Decided: the maintainer accepted the full expression index as the stored class, on condition of the benchmark at this
size (Discord, 2026-11-06).

For the maintainer, each with the default this spec applies. Any of them can be overridden in spec or PR review:

1. Build in the fork now; a UX discussion on the Immich Discord stays optional.
2. Five classes.
3. Panorama threshold 2.0, square tolerance 2 percent.
4. Per-row greying for aspect rows, next to the #910 decision for rating and media.
5. The budget in goal 5 (measured: 5 to 8 ms added per filter panel load).

Feature freezes (`CONTRIBUTING.md`) do not apply: the filter only narrows and changes neither the sharing, ownership nor
external library model.

Open for the implementation phase: the implementer's environment has no Docker. `mise sql` needs a running database, and
medium tests need one too, so how the regenerated query files are produced is not settled. Medium tests run in CI.

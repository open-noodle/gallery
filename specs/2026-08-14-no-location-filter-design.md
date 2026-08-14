# Filtering for photos that have no location (#868)

Discussion [#868](https://github.com/open-noodle/gallery/discussions/868) asks for a "none" /
"unknown" entry alongside the countries in the location filter, so a user can find the photos that
carry no location at all.

The location filter today can only ever _narrow to a place_: `location-filter.svelte` lists the
countries the server suggests, expands each into cities, and displays an incoming `state` it cannot
browse. There is no way to express the absence of a place, so the photos that most need finding —
the ones that will never appear on the map and never under a country — are the only ones the filter
cannot reach.

## The data model this has to respect

`asset_exif.city` / `state` / `country` are **only ever written by reverse geocoding**, and reverse
geocoding is only ever driven by coordinates:

- `metadata.service.ts:295-321` — extraction geocodes `latitude`/`longitude`, defaulting to
  `{ country: null, state: null, city: null }` when there are no coordinates.
- `asset.service.ts:331-340` (bulk) and `asset.service.ts:819` (single) — a manual location edit
  re-geocodes from the new coordinates.

No code path sets a place name without coordinates. Two consequences drive the whole design:

1. **`latitude IS NULL` ⇒ `city IS NULL`.** The two "missing location" states nest. Defined naively
   as `latitude IS NULL` and `city IS NULL`, a "no place name" entry would return a strict superset
   of a "no GPS" entry — two rows in one list where selecting the lower one silently includes
   everything the upper one matched.
2. **`asset_exif` rows are not guaranteed.** The row is created by `upsertExif`
   (`asset.repository.ts:496`) during metadata extraction. An asset that has been uploaded but not
   yet extracted has _no_ `asset_exif` row at all, and is by definition without a location.

## Decisions

### Two entries, defined as a partition

The filter offers two mutually exclusive entries rather than one:

| Entry             | Predicate                                  | What it means                                                                                  |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **No GPS**        | no `asset_exif` row, or `latitude IS NULL` | never geotagged — the literal ask in #868                                                      |
| **No place name** | `latitude IS NOT NULL AND city IS NULL`    | has coordinates the geocoder could not name: ocean, remote area, or a geocode that has not run |

They are deliberately **disjoint**, which makes their union exactly `city IS NULL` — the predicate
the server already supports. That identity is worth asserting in a test, because it is what proves
the pair is a partition of "missing location" rather than two overlapping approximations of it.

Chosen over the two alternatives:

- _One entry (`latitude IS NULL`)_ — the smallest change, but leaves the geocoding-gap case
  permanently unreachable. That case is the one that silently costs a user map pins.
- _"No GPS" plus `city IS NULL`_ — reuses an existing predicate, but ships the superset problem
  described above straight into the UI.

### `noGps` is a `NOT EXISTS`, not a join predicate

Every existing exif filter in both builders sits inside a shared `innerJoin('asset_exif', …)` block
(`asset.repository.ts:292`, `database.ts:906-916`). Putting `noGps` there would be wrong: an
inner join drops assets that have no `asset_exif` row, which are precisely the assets that most
obviously have no GPS.

`noGps` is therefore expressed outside that block as a correlated `NOT EXISTS`, mirroring the
`tagIds === null` ("assets with no tags") predicate the codebase already has at `database.ts:890-893`:

```ts
.$if(options.locationPresence === 'noGps', (qb) =>
  qb.where((eb) =>
    eb.not(
      eb.exists(
        eb
          .selectFrom('asset_exif')
          .whereRef('asset_exif.assetId', '=', 'asset.id')
          .where('asset_exif.latitude', 'is not', null),
      ),
    ),
  ),
)
```

`noPlaceName` requires `latitude IS NOT NULL`, so a missing row cannot match it and the shared inner
join is correct there. It goes inside the existing block.

### The wire parameter is `locationPresence`, not `locationState`

An enum rather than two booleans, because the two sets are disjoint: `withoutGps=true` +
`withoutPlace=true` is an impossible state that would always return nothing, and an enum makes it
unrepresentable.

Named `locationPresence` rather than the obvious `locationState` because **`state` already means
province throughout this codebase** (`SearchExifOptions.state`, `FilterState.state`,
`SearchLocationFilter.state`, and the `location-filter.svelte` prop `selectedState`). A field called
`locationState` sitting next to a field called `state` invites exactly the confusion the fork has
already paid for once — see the `selectedState` comment at `location-filter.svelte:14-29`, written
after a state narrowing went invisible and unremovable in the panel.

```ts
locationPresence: z.enum(['noGps', 'noPlaceName']).optional();
```

### It is a member of the location group, not a new dimension

City, state and country are already **one filter with one chip**: `getActiveFilterCount` counts them
once (`filter-panel.ts:147`), `handleRemoveFilter`'s `location` case clears all three
(`filter-remove.ts:30`), `active-filters-bar.svelte:112` folds them into one label, and every
country/city click replaces the whole group (`location-filter.svelte:26-29`). Mobile mirrors this
exactly: one `LocationChipId`, and `setLocation(null)` resets to a fresh `SearchLocationFilter()`
(`photos_filter.provider.dart:60-61`).

`locationPresence` joins that group. It is never combined with a city, state or country; selecting
it clears them, and selecting any of them clears it. This is what keeps the change additive — no new
chip, no new section, no new count.

Because the group is one filter, `locationPresence` must also join the **self-exclusion** lists that
stop a suggestion list from collapsing to its own selection: `without(options, 'country', 'state',
'city')` at `search.repository.ts:1193` (`getCountries`) and `:1406` (`getFilteredCountries`), and
the `exclude !== 'location'` branch at `search.repository.ts:692`.

### Sending both is rejected, not silently resolved

The DTO refines `locationPresence` to be incompatible with `city` / `state` / `country`, returning 400. The panel can never produce that combination, so the only source is a hand-edited or stale URL,
and there is no honest way to satisfy both — the combination is definitionally empty.

Web defends one step earlier: `parseFiltersFromUrl` (`filter-url.ts:169-171`) drops `city`, `state`
and `country` when `locationPresence` is present, so a hand-edited URL renders a working filter
rather than a 400. `locationPresence` wins because it is the narrower, unambiguous statement, and
because it matches the group-replacement semantics the panel already has.

### The entries are gated on server-reported flags

`FilterSuggestionsResponseDto` gains `hasUnlocated` and `hasUnnamedPlaces` next to the
`hasUnnamedPeople` flag it already carries (`search.dto.ts:264`), which the panel already uses to
decide whether a pseudo-entry is worth offering (`filter-panel.svelte:781`). An entry that would
match nothing is not shown — the principle established by #910 / PR #935.

The flags are computed **with the location group excluded**, like the country list itself. Without
that, selecting "No place name" would recompute `hasUnnamedPlaces` inside the already-filtered set,
the flag would stay true but `hasUnlocated` would go false, and the sibling entry would vanish
mid-selection.

### The map suppresses both entries

`map.repository.ts:187` joins map markers on `asset_exif.latitude IS NOT NULL`, so "No GPS" can only
ever return an empty map. "No place name" would work there, but is out of scope for this change.

`buildMapFilterConfig` therefore passes both gating flags as `false`. This is **not** a section
omission — the map keeps all ten sections and `filter-section-parity.spec.ts` is unaffected
(`ALL_FILTER_SECTIONS`, `filter-panel.ts:46-57`).

### No new index

Neither `asset_exif.latitude` nor `asset_exif.city` has a btree index; the only relevant index is
the GiST index on `ll_to_earth_public(latitude, longitude)` (`asset-exif.table.ts:16-20`), which
cannot serve an `IS NULL` test. Both predicates ride the `asset_exif` primary key
(`assetId`) and are AND-ed after the query's owner/visibility gates have already narrowed the set.

Ship without an index and measure. A partial index on a low-selectivity predicate — and "has no GPS"
is often half a library — is unlikely to pay for itself. Revisit with `EXPLAIN ANALYZE` against a
large library if the filter is slow, as a fork migration in `migrations-gallery/`.

## Changes by layer

### Server

| File                                | Change                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dtos/time-bucket.dto.ts`           | `locationPresence` on the timeline schema + refine rejecting it alongside `city`/`state`/`country`                                                                                                                                                                                                                       |
| `dtos/search.dto.ts`                | `locationPresence` on `BaseSearchSchema` (reaches metadata, smart, statistics, random, large-asset) + the same refine; `hasUnlocated` / `hasUnnamedPlaces` on `FilterSuggestionsResponseSchema`; `locationPresence` on `FilterSuggestionsRequestBaseSchema`                                                              |
| `repositories/asset.repository.ts`  | `locationPresence` on `TimeBucketOptions`; `noPlaceName` predicate inside the exif block of `withTimeBucketAssetFilters` (`:273`) **and added to that block's `$if` trigger at `:282-290`**; `noGps` `NOT EXISTS` outside it                                                                                             |
| `utils/database.ts`                 | Same two predicates in `searchAssetBuilderLegacy` (`:790`), beside the existing city/state/country clauses                                                                                                                                                                                                               |
| `repositories/search.repository.ts` | `locationPresence` on `SearchExifOptions` (`:101`) and `FilterSuggestionFilterOptions` (`:290`); the two flags computed in the filter-suggestions and smart-facet paths; `locationPresence` added to the location-group `without(...)` exclusions (`:1193`, `:1406`) and to the `exclude !== 'location'` branch (`:692`) |

`timeline.service.ts` needs no change — it passes timeline options through untouched.

The dormant V3 branch filter (`SearchFilterBranchSchema`, `comparisonPredicates` at
`database.ts:1225-1227`) is **explicitly out of scope**. It is not wired to any controller — see the
note at `database.ts:1269` — and its `StringFilterNullableSchema` already expresses
`{ city: { eq: null } }`, the union predicate. Adding a fork field to a dormant upstream path would
widen the rebase surface for no user-visible gain.

### Web

| File                                                                                                                 | Change                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filter-panel.ts`                                                                                                    | `locationPresence?: 'noGps' \| 'noPlaceName'` on `FilterState`; the two flags on `FilterSuggestionsResponse`; `getActiveFilterCount`'s location term extended (`:147`)                                                          |
| `location-filter.svelte`                                                                                             | Two radio rows above the country list, reusing the existing row markup; new `hasUnlocated` / `hasUnnamedPlaces` / `selectedLocationPresence` props; selection routes through the existing `onSelectionChange` group replacement |
| `filter-panel.svelte`                                                                                                | Threads the two flags from the suggestions response to the location section, as it already does for `hasUnnamedPeople` (`:168`, `:781`)                                                                                         |
| `filter-url.ts`                                                                                                      | Serialize/parse `locationPresence`; drop `city`/`state`/`country` when it is present                                                                                                                                            |
| `filter-remove.ts`                                                                                                   | The `location` case clears `locationPresence` too (`:30`)                                                                                                                                                                       |
| `active-filters-bar.svelte`                                                                                          | The location chip label renders the translated entry name (`:110-112`)                                                                                                                                                          |
| `filter-search-terms.ts`                                                                                             | Forward `locationPresence` to metadata search                                                                                                                                                                                   |
| `space-search.ts`                                                                                                    | Classify `locationPresence` in `QUERY_MODE_FILTER_HANDLING` as `'sent'` and forward it in `buildSmartSearchParams`                                                                                                              |
| `photos-filter-options.ts`, `album-filter-options.ts`, `recently-added-filter-options.ts`, `space-filter-options.ts` | Forward `locationPresence`                                                                                                                                                                                                      |
| `map-filter-config.ts`, `map-filter-options.ts`                                                                      | Force both flags `false`; never forward `locationPresence`                                                                                                                                                                      |

`QUERY_MODE_FILTER_HANDLING` is `satisfies Record<keyof FilterState, …>` (`space-search.ts:64`), so
adding the field to `FilterState` **fails `tsc` until it is classified**. That gate is deliberate —
it exists because `state`, `lensModel`, `ownerId`, `ocr` and `albumId` were each silently dropped
from smart search once.

### Mobile

| File                                                                                                                                                                           | Change                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models/search/search_filter.model.dart`                                                                                                                                       | `locationPresence` on `SearchLocationFilter` (`:9-49`) through `copyWith` / `toMap` / `fromMap` / `==` / `hashCode` / `toString`; **`SearchFilter.isEmpty` (`:305-307`) must test it** |
| `providers/photos_filter/active_chips.dart`                                                                                                                                    | The translated entry name joins `locParts` (`:111-122`), reusing `LocationChipId` and `ChipVisual.location` — no new chip id                                                           |
| `providers/photos_filter/filter_suggestions.provider.dart`                                                                                                                     | Forward `locationPresence`; expose the two flags                                                                                                                                       |
| `providers/photos_filter/time_buckets.provider.dart`                                                                                                                           | Forward `locationPresence` (`:18-19`)                                                                                                                                                  |
| `infrastructure/repositories/search_api.repository.dart`                                                                                                                       | Forward `locationPresence` (`:39-41`, `:72-78`)                                                                                                                                        |
| `presentation/widgets/filter_sheet/strips/places_strip.widget.dart`, `.../deep/places_cascade_section.widget.dart`, `presentation/pages/photos_filter/places_picker.page.dart` | Offer both entries when the flags allow, setting `SearchLocationFilter(locationPresence: …)`                                                                                           |

Existing call sites already construct a **fresh** `SearchLocationFilter(...)` on every selection
(`places_strip.widget.dart:119-121`, `places_cascade_section.widget.dart:124`, `:153`, `:174-175`),
which is what gives the group-replacement semantics for free. Keep that; see the `copyWith` trap
below.

### i18n

Two keys, following the existing `filter_has_no_album` / `filter_has_album` pattern
(`i18n/en.json:1754-1755`):

- `filter_location_no_gps`
- `filter_location_no_place_name`

Added to **all ten** files in one commit — `en` plus `de` · `fr` · `it` · `nl` · `pl` · `es` · `ru` ·
`zh_Hans` · `zh_Hant` — inserted in alphabetical position, then `npx prettier --write i18n/*.json`.
German, Italian and Spanish address the user informally; French and Russian use the formal register.

## BDD scenarios

### Server — predicates (medium tests, real DB)

The fixture below is shared by the first group. All five assets belong to the same owner and are
`visibility = timeline`, `deletedAt IS NULL`.

| Asset | `asset_exif` row | `latitude` | `city`                                                  |
| ----- | ---------------- | ---------- | ------------------------------------------------------- |
| A1    | none             | —          | —                                                       |
| A2    | yes              | `NULL`     | `NULL`                                                  |
| A3    | yes              | `48.85`    | `NULL`                                                  |
| A4    | yes              | `48.85`    | `Paris`                                                 |
| A5    | yes              | `NULL`     | `Berlin` (impossible via the app; guards the predicate) |

- **Given** the fixture, **when** the timeline is queried with `locationPresence = noGps`,
  **then** exactly `A1`, `A2`, `A5` are returned.
- **Given** the fixture, **when** queried with `locationPresence = noPlaceName`,
  **then** exactly `A3` is returned.
- **Given** the fixture, **when** both queries are run, **then** their result sets are disjoint.
- **Given** the fixture, **when** both queries are run, **then** their union equals the result of
  `city IS NULL` — the partition identity.
- **Given** an asset with no `asset_exif` row, **when** queried with `noGps`, **then** it is
  returned. _(Fails if the predicate is written as a join rather than `NOT EXISTS`.)_
- **Given** an asset with coordinates in an unnamed area, **when** queried with `noPlaceName`,
  **then** it is returned even though `country` is also `NULL`.

### Server — the two builders agree

- **Given** the fixture, **when** the same `locationPresence` is applied through
  `withTimeBucketAssetFilters` and through `searchAssetBuilderLegacy`, **then** both return the same
  asset ids. _(The two builders "must agree" — `database.ts:168`.)_
- **Given** `locationPresence = noPlaceName` and no other exif filter, **when** `getTimeBuckets`
  runs, **then** the result is narrowed. _(Fails if `locationPresence` was not added to the
  `$if(!!options.bbox || !!options.city || …)` join trigger at `asset.repository.ts:282-290`: the
  predicate never executes and the filter silently returns everything.)_
- **Given** `locationPresence` is set, **when** `getTimeBuckets` and `getTimeBucket` both run,
  **then** the bucket counts equal the number of assets returned.

### Server — scope and gating are not bypassed

- **Given** a trashed asset with no GPS, **when** queried with `noGps` and default visibility,
  **then** it is not returned.
- **Given** an archived asset with no GPS, **when** queried with `noGps` and
  `visibility = timeline`, **then** it is not returned.
- **Given** another user's asset with no GPS and no share, **when** the viewer queries with `noGps`,
  **then** it is not returned.
- **Given** an asset without GPS shared to the viewer through a timeline-enabled space, **when** the
  viewer queries with `noGps` and `withSharedSpaces`, **then** it is returned.

### Server — DTO validation

- **Given** a request with `locationPresence = noGps` and `country = 'France'`, **when** the DTO
  parses, **then** it is rejected with 400.
- **Given** the same with `city`, and again with `state`, **then** each is rejected with 400.
- **Given** `locationPresence` alone, **then** the DTO parses.
- **Given** `locationPresence = 'nogps'` or any value outside the enum, **then** it is rejected.

### Server — suggestion flags

- **Given** at least one accessible asset with no GPS, **when** filter suggestions are fetched,
  **then** `hasUnlocated` is `true`.
- **Given** no accessible asset with no GPS, **then** `hasUnlocated` is `false`.
- **Given** at least one accessible asset with coordinates and no city, **then** `hasUnnamedPlaces`
  is `true`.
- **Given** `locationPresence = noGps` is already applied, **when** suggestions are fetched, **then**
  `hasUnnamedPlaces` is still computed over the location-group-excluded set and stays `true` if such
  assets exist. _(The sibling entry must not vanish once one is selected.)_
- **Given** `locationPresence = noGps` is applied, **then** the returned `countries` list is not
  empty merely because of that selection — `locationPresence` is excluded from the country list's
  own filter, exactly like `country`/`state`/`city`.
- **Given** an asset with no GPS that the viewer cannot access, **then** it does not set
  `hasUnlocated` for that viewer.

### Web — the location section

- **Given** `hasUnlocated` and `hasUnnamedPlaces` are true, **when** the location section renders,
  **then** both rows appear above the country list.
- **Given** both flags are false, **then** neither row appears.
- **Given** `hasUnlocated` is false but `locationPresence = noGps` is selected, **then** the row
  still renders and is removable. _(Same orphan protection as `orphanedCountry` and `selectedState`;
  an active filter must never be reachable only through the chip.)_
- **Given** a country and city are selected, **when** "No GPS" is clicked, **then** `city`,
  `state` and `country` are all cleared and `locationPresence` is `noGps`.
- **Given** "No GPS" is selected, **when** a country is clicked, **then** `locationPresence` is
  cleared.
- **Given** "No GPS" is selected, **when** it is clicked again, **then** the location filter is
  empty.
- **Given** "No GPS" is selected, **when** "No place name" is clicked, **then** only
  `noPlaceName` remains — never both.

### Web — count, chip, URL

- **Given** only `locationPresence` is set, **then** `getActiveFilterCount` returns 1 for location.
- **Given** `locationPresence` and (impossibly) a country are both set in state, **then** location
  still counts once.
- **Given** `locationPresence` is set, **then** the active-filters bar shows one location chip
  labelled with the translated entry name.
- **Given** that chip, **when** it is removed, **then** `locationPresence`, `city`, `state` and
  `country` are all cleared.
- **Given** `locationPresence` is set, **when** the filter is serialized to URL and parsed back,
  **then** the value round-trips.
- **Given** a hand-edited URL carrying both `locationPresence=noGps` and `country=France`, **when**
  it is parsed, **then** `locationPresence` survives and `country` is dropped.
- **Given** an invalid `locationPresence` value in a URL, **then** it is ignored rather than applied.

### Web — per-surface forwarding

- **Given** `locationPresence` is set, **then** the photos, album, recently-added and space option
  builders each include it in their request.
- **Given** `locationPresence` is set on the **map** surface, **then** it is not forwarded and both
  gating flags are false, so neither row renders.
- **Given** query mode (smart search), **then** `locationPresence` reaches `SmartSearchDto`
  (classified `'sent'`).
- **Given** browse mode, **then** `locationPresence` reaches the metadata-search terms.
- `filter-section-parity.spec.ts` still passes unchanged — no section was added or dropped.

### Mobile

- **Given** a `SearchFilter` whose only set dimension is `location.locationPresence`, **then**
  `isEmpty` is `false`. _(Fails loudly here rather than silently in production: `isEmpty` routes
  `buildPhotosTimelineQuery` to the **unfiltered** main timeline service —
  `timeline_query.provider.dart:45-48`, and `buildPhotosTimelineRouteService` likewise at `:31`.)_
- **Given** a `SearchLocationFilter` with `locationPresence`, **then** `toMap` → `fromMap`
  round-trips it, and two filters differing only in it are unequal with different hash codes.
- **Given** a filter with a country selected, **when** an entry is chosen, **then** the whole group
  is replaced and the country is gone.
- **Given** an entry is chosen, **when** `setLocation(null)` is called, **then** it is cleared.
- **Given** `locationPresence` is set, **then** exactly one chip renders, with `LocationChipId` and
  `ChipVisual.location`, labelled with the translated entry name.
- **Given** that chip, **when** it is dismissed, **then** the location group is cleared.
- **Given** the flags are true, **then** the places strip, the deep cascade section and the places
  picker page each offer both entries; **given** the flags are false, none of them do.
- **Given** `locationPresence` is set, **then** `search_api.repository.dart` and
  `time_buckets.provider.dart` both forward it.

## Edge cases and traps

These are the failure modes this change can produce that a passing test suite would otherwise miss.

**The exif join trigger (server).** `withTimeBucketAssetFilters` gates every exif predicate behind
one `$if(!!options.bbox || !!options.city || …)` (`asset.repository.ts:282-290`). A `noPlaceName`
predicate added inside the block but not to that condition **never executes**, and the filter
returns the unfiltered timeline. There is a scenario above whose only job is to catch this.

**`SearchFilter.isEmpty` (mobile).** The mirror-image trap. A `locationPresence` not added to
`isEmpty` (`search_filter.model.dart:305-307`) makes the filter look empty, and both
`buildPhotosTimelineRouteService` (`:31`) and `buildPhotosTimelineQuery` (`:45`) return the main
library timeline — the chip renders, the results are unfiltered.

**`copyWith(null)` does not clear (mobile).** `SearchLocationFilter.copyWith` is hand-written with
`country ?? this.country` (`search_filter.model.dart:15-17`), so passing `null` **keeps** the old
value. Clearing must construct a fresh `SearchLocationFilter()`, which is what `setLocation(null)`
and every existing call site already do. Do not "simplify" a call site to `copyWith`.

**Inner join drops row-less assets (server).** Covered by the `NOT EXISTS` decision above; the
scenario for an asset with no `asset_exif` row is what keeps it honest.

**A selected entry whose flag went false.** Applying a filter changes the suggestion set. Without
the location-group exclusion on the flags, and without the orphan rendering rule, a selected entry
can disappear from the panel while still applied — unremovable except through the chip. This is the
bug `location-filter.svelte:14-29` and `orphaned-selections.spec.ts` already exist to prevent.

**`QUERY_MODE_FILTER_HANDLING` (web).** Adding to `FilterState` without classifying breaks `tsc`.
This is the good kind of trap — loud. Do not silence it by widening the type.

**`A5` (row with `city` but no `latitude`).** Unreachable through the app, since place names only
ever come from coordinates. It is in the fixture to pin the predicate's literal behaviour, so that a
future refactor to `city IS NULL`-based logic changes a test rather than changing behaviour quietly.

## TDD order

Each step is red before it is green. The layers are independent below the DTO, so steps 3–5 can
proceed in any order once step 2 lands.

1. **Predicate tests, red.** Write the medium-test fixture and the predicate/partition scenarios
   against `searchAssetBuilderLegacy`. They fail — `locationPresence` does not exist.
2. **DTO + predicates, green.** Add the enum and refine to the timeline and search DTOs, the two
   predicates to both builders (including the join trigger), and the option-type fields. Add the
   DTO-validation and builders-agree scenarios. Run `make open-api` once, at the end of this step,
   so the TS SDK and Dart client regenerate together.
3. **Suggestion flags.** Red on the flag scenarios, then compute them with the location group
   excluded and wire them onto the response DTO.
4. **Web.** Red on `filter-panel.ts` count, `filter-url.ts` round-trip, `filter-remove.ts` and the
   `location-filter.svelte` rendering scenarios; then implement, fixing the `tsc` failure from
   `QUERY_MODE_FILTER_HANDLING` as part of it. Map suppression last.
5. **Mobile.** Red on `search_filter_empty_test.dart` (the `isEmpty` scenario) and
   `search_filter_equality_test.dart` first — they are the cheapest and catch the worst trap — then
   the chip, provider and widget scenarios.
6. **i18n.** All ten locales, then `npx prettier --write i18n/*.json`.

## Verification

```bash
# server
cd server && pnpm test -- --run src/utils/database.spec.ts
cd server && pnpm test:medium
make lint-server && make check-server

# web
cd web && pnpm test -- --run src/lib/components/filter-panel
cd web && pnpm test -- --run src/lib/utils/__tests__
cd web && pnpm check:typescript && pnpm check:svelte

# mobile — read the Flutter pin from mobile/mise.toml, do not assume it
cd mobile && flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
flutter test test/providers/photos_filter test/models/search
dart analyze --fatal-infos

# generated clients
make open-api
```

`dart analyze` is not a substitute for `flutter test` — generated-code compile errors only surface
when a test actually compiles.

## Out of scope

- **The web `/search` route** and its typed-search tokens (`city:` / `country:` in
  `typed-search-parser.ts:118-119`). No `location:` token is added.
- **The map surface.** Both entries are suppressed there; how unlocated assets might be surfaced on
  a map is a separate question.
- **The V3 branch filter** (`SearchFilterBranchSchema`), which is dormant and unwired.
- **A new index** on `asset_exif.latitude` / `city` — deferred pending measurement.
- **Bulk-geotagging** the assets this filter finds. Finding them is #868; fixing them is not.

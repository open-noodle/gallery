# Slice 3 — LOW#7: filter-suggestion sources follow the `not-locked` default

**Finding:** LOW · `server/src/repositories/search.repository.ts` (~:1295, `getExifField`) and two
siblings (`buildFilteredAssetIds` ~:1323, `getAccessibleTags` ~:1100) hard-pin
`visibility = Timeline`, while search itself moved to the Slice-1/H1 `not-locked`/elevated default.
**Depends on:** Slice 1 (H1) — the `dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined
: 'not-locked')` resolution pattern this slice reuses.

## Problem

`searchAssetBuilder` (`database.ts:648-652`) resolves visibility as: concrete value → `= value`,
`'not-locked'` → `!= Locked`, `undefined` → no filter. Every search/facet endpoint threads this through.
The **suggestion-source** queries in `search.repository.ts` never got the same treatment — they still
hard-code `visibility = Timeline`:

- `getExifField` (~:1295) — backs `getCountries`, `getStates`, `getCameraMakes`, `getCameraModels`,
  `getCameraLensModels` (dispatched from `SearchService.getSuggestions`, called by
  `getSearchSuggestions`).
- `buildFilteredAssetIds` (~:1323) — backs `getFilteredCountries`, `getFilteredCameraMakes`,
  `getFilteredTags`, `getFilteredPeople`/`getFilteredIdentityPeople`, `getCities`, `getFilteredRatings`,
  `getFilteredMediaTypes` — all folded into `getFilterSuggestions` (called by
  `SearchService.getFilterSuggestions`).
- `getAccessibleTags` (~:1100) — backs `SearchService.getTagSuggestions`.

Because these three are pinned to `Timeline`, they omit values that exist only on Archived/Hidden
assets — assets a `not-locked` search **would** return. Example: a camera make that appears only on an
Archived photo never shows up as a filter suggestion, so the user can't even type it to find the photo.

**Not in scope:** `getSmartSearchFacets` (and its `getAssetsByCity`-unrelated helpers) already resolves
visibility correctly — `SearchService.searchSmartFacets` → `resolveSmartSearch` (search.service.ts:492-495)
computes the same `not-locked`/elevated value and threads it into `SmartSearchFacetsOptions.visibility`,
which flows through `searchAssetBuilder` in `buildSmartFacetCandidateQuery`. No change needed there.
`getAssetsByCity` (database.ts/search.repository.ts:970-1018, the "explore" map feature, not a filter
suggestion) also hard-pins Timeline but is a distinct feature with its own controller endpoint
(`GET /search/assets-by-city`) that this finding does not name and the audit did not flag — left
untouched to keep the slice minimal; flagging as a follow-up candidate, not fixing here.

## Root cause & call-chain

None of the three suggestion request DTOs (`SearchSuggestionRequestDto`, `TagSuggestionRequestDto`,
`FilterSuggestionsRequestDto`) expose a `visibility` field — unlike `MetadataSearchDto` etc., there is
no explicit-visibility override for suggestions. So the fix is strictly: resolve
`auth.session?.hasElevatedPermission ? undefined : 'not-locked'` in the three
`SearchService` suggestion methods and thread it to the repository, exactly mirroring the sibling
`dto.visibility ?? (...)` expression minus the `dto.visibility ??` half (there is no dto field to
merge with).

The suggestion queries never went through `searchAssetBuilder` (they're built from `asset_exif`/`tag`
joins, not `selectFrom('asset')` in the same shape), so the fix is a small local `applyVisibilityScope`
helper on `SearchRepository` mirroring `searchAssetBuilder`'s `$if` clause, not a `searchAssetBuilder`
reuse.

**Confirmed: this does not require any controller/DTO/OpenAPI change** — the resolved visibility value
is computed server-side from `auth.session`, never accepted from the request body, so the repository
option types gain an optional `visibility` field and the service passes it through. No client payload
changes.

## Minimal implementation

1. `server/src/repositories/search.repository.ts`:
   - Add `visibility?: AssetVisibility | 'not-locked';` to `SuggestionScopeOptions` (the shared base
     interface `ExifSuggestionScopeOptions`, `FilterSuggestionsOptions`, `GetCitiesOptions` all extend).
   - Add `'visibility'` to the `AccessibleTagScopeOptions` `Pick<...>` list.
   - **Deviation from the original one-helper plan:** a shared private
     `applyVisibilityScope<T extends SelectQueryBuilder<DB, any, any>>(qb: T, visibility)` method was
     tried first but broke Kysely's return-type inference at the `getAccessibleTags` call site — the
     `<T extends SelectQueryBuilder<DB, any, any>>` constraint's `any` row-type position collapsed the
     inferred result to `{ [x: string]: any }[]`, failing `tsc` (`getAccessibleTags`'s declared
     `Promise<Array<{ id: string; value: string }>>` return type). Reverted to inlining the identical
     `.$if(!!visibility, (qb) => visibility === 'not-locked' ? qb.where('asset.visibility', '!=',
Locked) : qb.where('asset.visibility', '=', visibility!))` clause at each of the three call sites
     (same duplication level as the `searchAssetBuilder` original) — `tsc --noEmit` is clean this way.
   - `getExifField`: replace `.where('visibility', '=', AssetVisibility.Timeline)` with the inline
     `$if` clause (using `'asset.visibility'`, qualified) right after the `asset` join, keyed off
     `options?.visibility`.
   - `buildFilteredAssetIds`: replace `.where('asset.visibility', '=', AssetVisibility.Timeline)` the
     same way, using `options.visibility`.
   - `getAccessibleTags`: replace `.where('asset.visibility', '=', AssetVisibility.Timeline)` the same
     way, using `options?.visibility`.
2. `server/src/services/search.service.ts`:
   - `ScopedPersonFilterOptions`: add `visibility?: AssetVisibility | 'not-locked';`.
   - `getSearchSuggestions`: compute `const visibility = auth.session?.hasElevatedPermission ?
undefined : 'not-locked';`, add it to the object passed into `resolveScopedPersonFilters`.
   - `getFilterSuggestions`: same pattern, into the object passed into `resolveScopedPersonFilters`
     before `this.searchRepository.getFilterSuggestions(userIds, resolvedDto)`.
   - `getTagSuggestions`: same pattern, added directly to the options object passed to
     `this.searchRepository.getAccessibleTags(userIds, { ...dto, timelineSpaceIds, visibility })` (this
     method doesn't call `resolveScopedPersonFilters` today — no personIds on that DTO).

No DTO/controller/OpenAPI change — confirmed above.

## Files

- `server/src/repositories/search.repository.ts` — the three pinned queries + shared helper + option
  type additions.
- `server/src/services/search.service.ts` — resolve + thread visibility in the three suggestion methods.
- `server/test/medium/specs/repositories/search.repository.spec.ts` — new RED-first tests (repo level).
- `docs/superpowers/plans/2026-07-02-rolling-rebase-audit-slice-03.md` — this plan.
- `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` — LOW#7 bullet → append
  `— FIXED (slice S3)`.

## Tests (medium/DB, RED-first)

Test path: **medium repo-level** (`pnpm test:medium`, testcontainers Docker) — calls
`SearchRepository` methods directly (mirrors the existing `getFilterSuggestions` test in this file),
so it exercises exactly the SQL that changed without needing to fake `auth.session` through the service
layer. This is the "repo-level" option the task explicitly allows.

New tests in `test/medium/specs/repositories/search.repository.spec.ts`:

1. **`getFilterSuggestions` — not-locked default (≥2 fields: countries + cameraMakes).**
   One user; a Timeline asset (`country: Germany, make: Sony`), an Archived asset
   (`country: Norway, make: ArchivedMake`), a Locked asset (`country: Spain, make: LockedMake`).
   `sut.getFilterSuggestions([user.id], { visibility: 'not-locked' })` → `countries` contains
   `Germany` and `Norway` but not `Spain`; `cameraMakes` contains `Sony` and `ArchivedMake` but not
   `LockedMake`.
   Expected RED: current code hard-pins `Timeline`, so `Norway`/`ArchivedMake` are missing (assertion
   on the archived value fails) regardless of the (currently nonexistent/no-op) `visibility` field.

2. **`getFilterSuggestions` — elevated (`visibility: undefined`) sees Locked too.**
   Same Locked asset as above; `sut.getFilterSuggestions([user.id], {})` → `countries` contains
   `Spain`, `cameraMakes` contains `LockedMake`.
   Expected RED: pre-fix, Locked is excluded unconditionally (hard-pinned Timeline).

3. **`getFilterSuggestions` — empty result set.**
   A user with zero assets; `sut.getFilterSuggestions([user.id], { visibility: 'not-locked' })` →
   returns the all-empty shape (`countries: [], cameraMakes: [], tags: [], people: [], ratings: [],
mediaTypes: [], hasUnnamedPeople: false`), no throw. (Passes before and after — regression guard,
   not RED.)

4. **`getCameraMakes` (the literal `getExifField`/~:1295 site) — not-locked default.**
   Timeline asset (`make: Sony`), Archived asset (`make: ArchivedMake`), Locked asset
   (`make: LockedMake`). `sut.getCameraMakes([user.id], { visibility: 'not-locked' })` →
   `['ArchivedMake', 'Sony']` (alphabetical), excludes `LockedMake`.
   Expected RED: pre-fix returns `['Sony']` only.

5. **`getAccessibleTags` (the third pinned site, ~:1100) — not-locked default.**
   Three assets/tags (`TimelineTag`, `ArchivedTag`, `LockedTag`) on Timeline/Archived/Locked assets.
   `sut.getAccessibleTags([user.id], { visibility: 'not-locked' })` → includes `TimelineTag` and
   `ArchivedTag`, excludes `LockedTag`.
   Expected RED: pre-fix excludes `ArchivedTag` too (hard-pinned Timeline).

Edge cases covered: elevated may see Locked values (test 2); empty result set → empty arrays, no error
(test 3); ≥2 suggestion fields exercised across tests 1/4/5 (country, camera make, tag); all three
originally-pinned call sites covered (tests 1/4 → `getExifField` + `buildFilteredAssetIds`, test 5 →
`getAccessibleTags`).

## GREEN

`cd server && pnpm test:medium -- --run src/repositories/search.repository.spec.ts`

Regression:

- `cd server && npx tsc --noEmit -p tsconfig.json` (grep `error TS` — none new).
- `cd server && pnpm test -- --run src/services/search.service.spec.ts` (unit suite still green; 3
  pre-existing unrelated failures in `exif/audio-video.spec.ts` — `Cannot find ffprobe`,
  environmental — ignored).
  - Two pre-existing `getTagSuggestions` unit tests (`should return accessible tags for personal
timeline`, `should include partner IDs in user search`) asserted `getAccessibleTags` was called
    with an exact empty options object `{}`. That's exactly what this slice changes (the resolved
    `visibility`/`timelineSpaceIds` are now always present), so both assertions were updated to expect
    `{ timelineSpaceIds: undefined, visibility: 'not-locked' }` — an intentional test update, not a
    regression.
  - One flaky, unrelated medium test observed once during verification:
    `asset.service.spec.ts > AssetService > delete > should delete a stacked primary asset (3 assets)`
    (nondeterministic tie-break on which remaining stack member becomes primary) — passed on rerun in
    isolation; unrelated to this slice (no stack/asset-service code touched).

## Commit

```
fix(server): align filter-suggestion visibility with search default (LOW #7)
```

Body: the dynamic filter-suggestion sources (`getExifField`, `buildFilteredAssetIds`,
`getAccessibleTags` in `search.repository.ts`) were still hard-pinned to `visibility = Timeline` after
Slice 1 moved search's own default to `not-locked`/elevated-`undefined`. Suggestions now resolve
visibility the same way search does, so a value that only exists on an Archived/Hidden asset shows up
as a suggestion again, while non-elevated callers still never see Locked-only values.

# Second-level filter options must narrow by the active filter set (#858)

- **Issue:** [#858](https://github.com/open-noodle/gallery/issues/858) — "Second level filter options (e.g. camera model) do not narrow down based on active filters, always show the full unfiltered list"
- **Reported on:** Gallery 5.2.1
- **Branch:** `fix/858-second-level-filter-narrowing`
- **Status:** ready for `/impl-loop`

---

## 1. Goal

When a user drills into a two-level filter section (Camera → make → model, Location → country → city), the
second-level list must contain only the values that actually occur in the **currently filtered** result set.

The reporter's exact scenario:

> Tag `2010 Norwegen_DMY` active (4,968 results) → open Camera → select `Canon` → the model list shows
> **every Canon model in the whole library**, not just the ones used on those 4,968 photos.

After this change, that list contains only the Canon models present among the tagged assets, and the same
holds for every other active filter dimension (people, rating, favourites, album membership, date range,
location, media type).

## 2. Root cause

There are two independent gaps that both have to close. Neither is a UI bug — the panel already re-fetches
the second level whenever the filter context changes (`camera-filter.svelte:24-40`,
`location-filter.svelte`); it is the request payload and the SQL behind it that drop the filters.

### 2.1 Server: `getExifField` ignores most of the filter set

`GET /search/suggestions` dispatches through `SearchService.getSuggestions`
(`server/src/services/search.service.ts:439-466`) into five repository methods. Four of them are built on the
private `getExifField` helper (`server/src/repositories/search.repository.ts:1307-1342`), which applies only:

- `applySuggestionScope(...)` — `albumId` / `spaceId` / `timelineSpaceIds` / `ownerId`
- `visibility`
- `asset.deletedAt is null`
- `<field> is not null` and `<field> != ''`
- `isNotInAlbum` / `isInAlbum`
- `takenAfter` / `takenBefore`

It **never references** `tagIds`, `personIds`, `identityIds`, `rating`, `isFavorite`, `mediaType`,
`country`, `city`, or `forceEmptyResult` — and `GetCameraModelsOptions` / `GetCameraMakesOptions` /
`GetCameraLensModelsOptions` / `GetStatesOptions` do not even declare those keys, so the values the service
forwards are silently dropped.

`getCities` is the odd one out: [#436](https://github.com/open-noodle/gallery/pull/436) (`cdf95bb3d1b`)
moved it onto `buildFilteredAssetIds` (`search.repository.ts:1344-1416`), which applies the **whole**
`FilterSuggestionFilterOptions` set. That fix was never generalised to the camera / country / state
suggestions, which is why the reporter sees the bug on Camera but not on Location.

The generated SQL makes the divergence visible — `server/src/queries/search.repository.sql`:

```sql
-- SearchRepository.getCities
select distinct "city" from "asset_exif"
where "assetId" in (select "asset"."id" from "asset" where ...)   -- ← faceted subquery
...

-- SearchRepository.getCameraModels
select distinct on ("model") "model" from "asset_exif"
  inner join "asset" on "asset"."id" = "asset_exif"."assetId"
where "deletedAt" is null and "model" is not null and "model" != $1
  and "asset"."ownerId" = any ($2::uuid[])                        -- ← no facet predicates at all
```

A second consequence: `SearchService.getSearchSuggestions` calls `resolveScopedPersonFilters`, which sets
`forceEmptyResult: true` when a scoped person token is inaccessible (`search.service.ts:583-613`).
`getExifField` ignores that flag, so those requests return the **full** value list instead of an empty one.
`buildFilteredAssetIds` honours it.

The smart-search facets path (`getSmartSearchFacets`, `search.repository.ts:551-776`) is already fully
faceted and is **not** affected — which is why the bug only shows in browse mode, not while a smart-search
query is active.

### 2.2 Web: `FilterContext` does not carry the location / camera / media dimensions

`buildFilterContext` (`web/src/lib/components/filter-panel/filter-panel.ts:245-297`) emits only
`personIds`, `tagIds`, `rating`, `isFavorite`, `isNotInAlbum`, `isInAlbum`, `takenAfter`, `takenBefore`.

So even with §2.1 fixed, the camera-model request would still not narrow by an active **country/city** or
**media type** filter, and the city request would not narrow by an active **make/model** or **media type**
filter.

`SearchSuggestionRequestDto` is also missing two of those fields: it has `country`, `make`, `model` but no
`city` and no `mediaType` (`server/src/dtos/search.dto.ts:170-198`). `FilterSuggestionsRequestDto` has all of
them (`search.dto.ts:269-292`) — the two request schemas have drifted.

### 2.3 What is already correct (do not touch)

- Every panel surface already spreads the context into the request: `map-filter-config.ts:62-75`,
  `album-filter-config.ts:69-86`, `recently-added-filter-config.ts:82-99`,
  `routes/(user)/photos/[[assetId=id]]/+page.svelte:270-283`,
  `routes/(user)/spaces/[spaceId]/…/+page.svelte:276-290`. No call-site edits are needed for new context
  fields.
- `camera-filter.svelte` / `location-filter.svelte` already re-run their fetch effect when `context`
  changes, and already guard the cascade auto-clear behind `result.length > 0`.
- The nine `buildFilterContext(filters)` consumers in `web/src/lib/utils/*-filter-options.ts` and
  `space-search.ts` read **only** `context.takenAfter` / `context.takenBefore` explicitly — none of them
  spread the context — so widening `FilterContext` cannot leak into timeline/search request payloads.

## 3. Architecture

### 3.1 One invariant

> Every `/search/suggestions` type returns the distinct values of its own field over
> `buildFilteredAssetIds(userIds, without(options, <own field>))` — the same asset-id subquery
> `getFilterSuggestions` and `getSmartSearchFacets` already use.

"Own field" is excluded so the section does not self-narrow to the single value the user already picked
(a selected model must not collapse the model list to one row). Every _other_ param stays applied, including
the drill-down parent (`make` for models, `country` for cities/states).

`getExifField` is deleted at the end of Slice 2. Leaving it in place is what let this bug survive #436.

### 3.2 Field-by-field exclusion table

| Method                 | `buildFilteredAssetIds` receives    | Applied on the outer `asset_exif` select |
| ---------------------- | ----------------------------------- | ---------------------------------------- |
| `getCities` (existing) | `without(options, 'city')`          | `state`, `city is not null/''`           |
| `getCameraModels`      | `without(options, 'model')`         | `lensModel`, `model is not null/''`      |
| `getCameraMakes`       | `without(options, 'make')`          | `lensModel`, `make is not null/''`       |
| `getCameraLensModels`  | `options` (unchanged)               | `lensModel is not null/''`               |
| `getCountries`         | `without(options,'country','city')` | `country is not null/''`                 |
| `getStates`            | `without(options, 'city')`          | `state is not null/''`                   |

Notes:

- `lensModel` and `state` are not members of `FilterSuggestionFilterOptions`, so they can only be applied on
  the outer select — exactly how `getCities` already applies `state`.
- `getCountries` excludes `city` as well, mirroring `getFilterSuggestions`' own
  `getFilteredCountries(userIds, without(options, 'country', 'city'))` (`search.repository.ts:1178`).
  Keeping `city` applied would collapse the country list to the one country containing that city, making the
  country selector unusable. `getStates` excludes `city` for the same reason.
- `getCameraMakes` / `getCameraLensModels` today apply their sibling camera params (`model`, `lensModel`) on
  the outer query. After the change `model` is applied _inside_ `buildFilteredAssetIds`, so the redundant
  outer `$if(!!options.model, …)` is removed. Behaviour is unchanged.
- `rating` is a **minimum** (`>=`) inside `buildFilteredAssetIds`, matching every other faceted path.

### 3.3 Web context widening

`FilterContext` gains `country`, `city`, `make`, `model`, `mediaType`. `buildFilterContext` emits each only
when set and not in `exclude`; `mediaType` maps `'image' | 'video'` → `AssetTypeEnum.Image | .Video` and is
omitted for `'all'`.

The `mediaType` guard must be `state.mediaType && state.mediaType !== 'all'`, not just `!== 'all'`.
`filter-panel.svelte`'s temporal re-fetch effect builds a **partial** state —
`buildFilterContext({ dateAfter, dateBefore, selectedYear, selectedMonth } as FilterState)` — where
`mediaType` is `undefined`. A bare `!== 'all'` is true for `undefined` and would inject a spurious
`mediaType: Video` into every temporal re-fetch. (Found while implementing Slice 4: it turned nine
previously-green `contextual-refetch` tests red.)

The two dependent contexts already exclude the right things and need no edit:

```ts
let locationFilterContext = $derived(buildFilterContext(filters, ['country', 'city']));
let cameraFilterContext = $derived(buildFilterContext(filters, ['make', 'model']));
```

`locationFilterContext` now carries `make` / `model` / `mediaType`; `cameraFilterContext` now carries
`country` / `city` / `mediaType`. The explicit first argument (`country` for cities, `make` for models) is
never clobbered, because the context excludes exactly those keys.

**One deliberate carve-out.** `filter-panel.svelte:89`'s `filterContext` is not a request payload — it is the
truthiness gate for the per-section `count` prop, and `count === 0` **disables and collapses** a section
(`filter-section.svelte:21-36`). Widening it would start greying out empty sections in states where they are
enabled today (e.g. "only a camera make selected"). That is out of scope for #858, so line 89 becomes:

```ts
// The count gate answers "has a *cross-section* filter narrowed the panel?" — it drives the
// empty-section disable in filter-section.svelte, not a request. The location/camera/media
// dimensions added for #858 are section-local, so they stay out of it (see spec §3.3).
let filterContext = $derived(buildFilterContext(filters, ['country', 'city', 'make', 'model', 'mediaType']));
```

A regression test locks this in so a later refactor cannot silently change the disable behaviour.

### 3.4 Files touched (whole change)

**Server**

- `server/src/repositories/search.repository.ts` — widen `GetCameraModelsOptions`, `GetCameraMakesOptions`,
  `GetCameraLensModelsOptions`, `GetStatesOptions`; reroute five methods; delete `getExifField`.
- `server/src/dtos/search.dto.ts` — `SearchSuggestionRequestBaseSchema` += `city`, `mediaType`.
- `server/src/queries/search.repository.sql` — regenerated.

**Generated clients**

- `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`,
  `mobile/openapi/**` — regenerated. (`open-api/typescript-sdk/` is a stale pre-move leftover — not
  regenerated, not imported, out of scope.)

**Web**

- `web/src/lib/components/filter-panel/filter-panel.ts` — `FilterContext` + `buildFilterContext`.
- `web/src/lib/components/filter-panel/filter-panel.svelte` — line 89 carve-out + comment.

**Tests**

- `server/test/medium/specs/repositories/search.repository.spec.ts`
- `server/src/services/search.service.spec.ts`
- `server/src/controllers/search.controller.spec.ts`
- `server/src/dtos/search.dto.spec.ts`
- `e2e/src/specs/server/api/filter-suggestions.e2e-spec.ts`
- `web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts`
- `web/src/lib/components/filter-panel/__tests__/contextual-refetch.spec.ts`

### 3.5 Testing strategy

TDD throughout: every behaviour gets a red test first, with the expected failure message named in the plan.

- **Medium tests** (`server/test/medium/…`, real Postgres via testcontainers) are the primary layer — they
  exercise the actual SQL, which is where the bug lives. Unit tests with mocked repositories cannot catch a
  dropped `where` clause.
- **Service unit tests** assert the DTO→repository forwarding contract.
- **Controller + DTO unit tests** cover the new query params.
- **e2e API tests** encode the reporter's scenario end-to-end against the real stack.
- **Web unit tests** cover the pure `buildFilterContext` and the panel's provider call arguments.

Prerequisites for running the server suites in a fresh worktree: build `@immich/sdk`, the plugin SDK and
plugin-core first, or both the unit and medium suites die at collection. Medium tests need Docker.

**Exact commands** (`make lint-server` / `make check-server` / `make format-server` / `make sql` /
`make open-api` from `CLAUDE.md` no longer exist — the Makefile targets were removed or never existed):

| Purpose               | Command                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| Server unit, one file | `cd server && pnpm exec vitest run --config test/vitest.config.mjs <path>`        |
| Server medium         | `cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs <path>` |
| Server typecheck      | `cd server && pnpm check`                                                         |
| Server lint / format  | `cd server && pnpm lint` / `pnpm format`                                          |
| Web unit              | `cd web && pnpm exec vitest run <path>`                                           |
| Web gates             | `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint`               |
| SQL docs              | `mise sql` (**requires a running DB** — see §7)                                   |
| OpenAPI clients       | `mise open-api` (needs Java for the Dart client)                                  |

Do not use `pnpm test -- --run <path>`: in this repo the extra `--` makes vitest drop the path filter and run
the whole suite.

---

## 4. Slice overview

| Slice | Title                                                        | Ships                                                        |
| ----- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1     | `getCameraModels` honours the full active-filter set         | The reported bug, end-to-end, for the browse-mode panel      |
| 2     | The remaining EXIF suggestion types + retire `getExifField`  | Countries / states / makes / lens models, no more divergence |
| 3     | `/search/suggestions` accepts `city` and `mediaType`         | Request-schema parity with `/search/suggestions/filters`     |
| 4     | `FilterContext` carries location / camera / media dimensions | Cross-dimension narrowing in the UI                          |

Each slice is independently shippable and leaves the tree green.

---

## Slice 1 — `getCameraModels` honours the full active-filter set

Closes the reported scenario. Everything else in this spec is generalisation.

### Changes

`server/src/repositories/search.repository.ts`:

```ts
export interface GetCameraModelsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {
  lensModel?: string;
}
```

```ts
@GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
async getCameraModels(userIds: string[], options: GetCameraModelsOptions): Promise<string[]> {
  const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'model'));
  const res = await this.db
    .selectFrom('asset_exif')
    .select('model')
    .distinct()
    .where('assetId', 'in', filteredIds)
    .where('model', 'is not', null)
    .where('model', '!=', '')
    .$if(!!options.lensModel, (qb) => qb.where('lensModel', '=', options.lensModel!))
    .orderBy('model')
    .execute();

  return res.map((row) => row.model!);
}
```

`make` is now applied inside `buildFilteredAssetIds`, so the previous outer `$if(!!options.make, …)` is
removed. `getExifField` stays for now — Slice 2 deletes it.

### TDD steps

1. Add the medium tests below → run → **red**. Expect the tag/person/rating/media/favourite tests to fail
   with the unfiltered value list, e.g.
   `AssertionError: expected [ 'Canon EOS 7D', 'Canon EOS R5' ] to equal [ 'Canon EOS R5' ]`.
2. Add the service unit test → **red** (`getCameraModels` called without `tagIds` in the object).
3. Add the e2e acceptance test → **red**.
4. Apply the implementation above → all green.
5. Regenerate `server/src/queries/search.repository.sql` and commit the diff.

### Medium tests (`server/test/medium/specs/repositories/search.repository.spec.ts`)

New `describe('getCameraModels (#858)')` block. Shared fixture per test: one user, four assets, all
`make: 'Canon'` unless stated.

| #    | Test                                                               | Assertion                                                                                |
| ---- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1.1  | narrows by `tagIds`                                                | tag on the R5 asset only → `['Canon EOS R5']`, not the 7D                                |
| 1.2  | narrows by `personIds`                                             | face on the R5 asset only → `['Canon EOS R5']`                                           |
| 1.3  | narrows by `rating` (minimum semantics)                            | R5 rated 5, 7D rated 3, `rating: 4` → `['Canon EOS R5']`                                 |
| 1.4  | narrows by `mediaType`                                             | 7D asset is `AssetType.Video`, `mediaType: AssetType.Image` → `['Canon EOS R5']`         |
| 1.5  | narrows by `isFavorite`                                            | only the R5 asset favourited → `['Canon EOS R5']`                                        |
| 1.6  | narrows by `country` / `city`                                      | R5 in Germany, 7D in France, `country: 'Germany'` → `['Canon EOS R5']`                   |
| 1.7  | narrows by `takenAfter` / `takenBefore`                            | preserves the pre-existing date behaviour                                                |
| 1.8  | narrows by `isNotInAlbum`                                          | 7D asset is in an album → `['Canon EOS R5']`                                             |
| 1.9  | still applies `make`                                               | a Nikon asset exists; `make: 'Canon'` → no Nikon model in the result                     |
| 1.10 | still applies `lensModel`                                          | two Canon assets with different lenses → only the matching model                         |
| 1.11 | does **not** self-narrow on `model`                                | `{ make: 'Canon', model: 'Canon EOS R5' }` → **both** Canon models still returned        |
| 1.12 | honours `forceEmptyResult`                                         | `{ forceEmptyResult: true }` → `[]`                                                      |
| 1.13 | honours `identityIds`                                              | face identity on the R5 asset only → `['Canon EOS R5']`                                  |
| 1.14 | visibility: `'not-locked'` includes archived, excludes locked-only | mirrors the existing `getCameraMakes (LOW #7)` test                                      |
| 1.15 | elevated caller (`visibility: undefined`) sees locked-only models  | locked asset's model present                                                             |
| 1.16 | scopes to `userIds` — another user's Canon model never appears     | second user with `Canon EOS 90D` → absent                                                |
| 1.17 | excludes trashed assets                                            | `deletedAt` set on the 7D asset → `['Canon EOS R5']`                                     |
| 1.18 | returns distinct values sorted ascending                           | two assets share `Canon EOS R5` → one entry; order is `['Canon EOS 7D', 'Canon EOS R5']` |
| 1.19 | returns `[]` for a filter set matching nothing, without throwing   | `tagIds: [<unused tag>]` → `[]`                                                          |

Fixture notes:

- `ctx.newUser`, `ctx.newAsset`, `ctx.newExif`, `ctx.newPerson`, `ctx.newAssetFace`, `ctx.newAlbum`,
  `ctx.newTagAsset` and `upsertTags(ctx.get(TagRepository), …)` are all already used in this file — follow the
  existing `getSmartSearchFacets` / `getFilterSuggestions` blocks.
- There is **no** `ctx.newFaceIdentity` helper. For 1.13, insert directly, copying
  `server/test/medium/specs/repositories/face-backfill-contributions.medium.spec.ts:36-44`:

  ```ts
  const identity = await ctx.database
    .insertInto('face_identity')
    .values({ type: 'person' })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('face_identity_face')
    .values({ identityId: identity.id, assetFaceId: assetFace.id, source: 'backfill' })
    .execute();
  ```

- 1.18's ordering assertion depends on `orderBy('model')`; `'Canon EOS 7D' < 'Canon EOS R5'` in the default
  collation, so the sort is observable.

### Service unit test (`server/src/services/search.service.spec.ts`)

Mirrors the existing `'should pass active filters to city suggestions'`:

```ts
it('should pass active filters to camera model suggestions (#858)', async () => {
  const personIds = [newUuid()];
  const tagIds = [newUuid()];
  mocks.search.getCameraModels.mockResolvedValue(['Canon EOS R5']);

  await sut.getSearchSuggestions(authStub.user1, {
    includeNull: false,
    type: SearchSuggestionType.CAMERA_MODEL,
    make: 'Canon',
    personIds,
    tagIds,
    rating: 4,
    isFavorite: true,
  });

  expect(mocks.search.getCameraModels).toHaveBeenCalledWith(
    [authStub.user1.user.id],
    expect.objectContaining({ make: 'Canon', personIds, tagIds, rating: 4, isFavorite: true }),
  );
});
```

### e2e acceptance (`e2e/src/specs/server/api/filter-suggestions.e2e-spec.ts`)

The existing fixture is already perfect: `assets[0]` = `/albums/nature/prairie_falcon.jpg` (make `Canon`,
model `Canon EOS R5`, tagged **nature**) and `assets[1]` = `/formats/webp/denali.webp` (make `Canon`, model
`Canon EOS 7D`, tagged **travel**). Add a sibling `describe('/search/suggestions (drill-down)')` in the same
file so it reuses `beforeAll`.

```ts
it('narrows camera models by an active tag filter (#858)', async () => {
  const { body: unfiltered } = await request(app)
    .get('/search/suggestions?type=camera-model&make=Canon&withSharedSpaces=true')
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .expect(200);

  expect(unfiltered).toEqual(expect.arrayContaining(['Canon EOS R5', 'Canon EOS 7D']));

  const { body: narrowed } = await request(app)
    .get(`/search/suggestions?type=camera-model&make=Canon&tagIds=${tagNatureId}&withSharedSpaces=true`)
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .expect(200);

  expect(narrowed).toEqual(['Canon EOS R5']);
});
```

Plus:

- `narrows camera models by an active rating filter` — `rating=5` → only the R5 model (`assets[0]` is rated 5,
  `assets[1]` rated 4).
- `keeps every camera model when only the make is selected` — no self-narrowing regression.

### Edge cases

| Case                                          | Expected                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| No filters at all                             | Same list as before the change (full make-scoped list)                          |
| `includeNull=true`                            | Unchanged — the service still appends `null` after the repository returns       |
| Selected model no longer in the narrowed list | `camera-filter.svelte:33-35` auto-clears the model (existing cascade behaviour) |
| Narrowed list is empty                        | `result.length > 0` guard means the selected model is **not** cleared           |
| Filter set that matches zero assets           | `[]`, no exception                                                              |
| `spaceId` / `albumId` scope                   | Preserved — `buildFilteredAssetIds` calls the same `applySuggestionScope`       |
| Inaccessible scoped person token              | `forceEmptyResult` now honoured → `[]` (was: full list)                         |

### Done gate

- `cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/search.service.spec.ts` green
- `cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/search.repository.spec.ts` green
- `server/src/queries/search.repository.sql` regenerated (`mise sql` with a running DB) and committed
- `cd server && pnpm lint && pnpm format` clean

---

## Slice 2 — The remaining EXIF suggestion types + retire `getExifField`

Generalises Slice 1 so the divergence that produced #858 cannot recur.

### Changes

`server/src/repositories/search.repository.ts`:

```ts
export interface GetCameraMakesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {
  lensModel?: string;
}
export interface GetCameraLensModelsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {
  lensModel?: string;
}
export interface GetStatesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {
  state?: string;
}
```

`getCountries` takes `FilterSuggestionsOptions`.

Reroute all four onto `buildFilteredAssetIds` per the §3.2 table, following the Slice 1 shape
(`selectFrom('asset_exif').select(field).distinct().where('assetId','in',filteredIds)` + not-null/not-empty +
outer `$if` for non-facet params + `orderBy(field)`).

Then **delete** `getExifField`. Keep `ExifSuggestionScopeOptions` — `applySuggestionScope` still uses it.

### TDD steps

1. Add the medium tests below → **red** (each returns the unfiltered list).
2. Reroute the four methods → green.
3. Delete `getExifField`; `cd server && pnpm check` proves no remaining reference.
4. Regenerate `server/src/queries/search.repository.sql`.

### Medium tests

| #    | Test                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 2.1  | `getCameraMakes` narrows by `tagIds`                                                                   |
| 2.2  | `getCameraMakes` narrows by `rating` and `isFavorite`                                                  |
| 2.3  | `getCameraMakes` does **not** self-narrow on `make`                                                    |
| 2.4  | `getCameraMakes` still narrows by the sibling `model`                                                  |
| 2.5  | `getCameraMakes` honours `forceEmptyResult` → `[]`                                                     |
| 2.6  | `getCountries` narrows by `tagIds`                                                                     |
| 2.7  | `getCountries` does **not** self-narrow on `country` **or** `city`                                     |
| 2.8  | `getStates` narrows by `tagIds`; still narrows by the parent `country`; does not self-narrow on `city` |
| 2.9  | `getCameraLensModels` narrows by `tagIds`; still narrows by `make` and `model`                         |
| 2.10 | All four keep the `visibility: 'not-locked'` semantics (archived in, locked-only out)                  |
| 2.11 | All four return sorted, distinct, non-empty-string values                                              |

The existing `describe('getCameraMakes (LOW #7)')` test must stay green **unchanged** — it is the regression
guard for the visibility semantics.

### Edge cases

| Case                                                            | Expected                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `getStates` with no `country`                                   | All states in the filtered set                                    |
| `getCountries` with a `city` selected                           | Full country list (city excluded), so the selector stays usable   |
| `getCameraLensModels` — `lensModel` is not a facet key          | Applied only on the outer select; nothing to exclude              |
| A caller passing an option the interface did not declare before | Now typed and applied — verify `cd server && pnpm check` is clean |

### Done gate

- `cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/search.repository.spec.ts` green
- `cd server && pnpm check` green (proves `getExifField` has no callers left)
- `grep -rn "getExifField" server/src` returns nothing
- SQL regenerated and committed

---

## Slice 3 — `/search/suggestions` accepts `city` and `mediaType`

Closes the request-schema drift between `SearchSuggestionRequestDto` and `FilterSuggestionsRequestDto`, so
Slice 4 can send the two remaining dimensions. The repository already applies both.

### Changes

`server/src/dtos/search.dto.ts`, inside `SearchSuggestionRequestBaseSchema` (`AssetTypeSchema` is already
imported on line 8):

```ts
city: z.string().optional().describe('Filter by city'),
mediaType: AssetTypeSchema.optional().describe('Filter by asset type'),
```

Then regenerate the clients:

```bash
cd server && pnpm build && pnpm sync:open-api
mise open-api        # TypeScript SDK + Dart client (Dart generation needs Java)
```

### TDD steps

1. `server/src/dtos/search.dto.spec.ts` — parse tests → **red** (`city` / `mediaType` stripped as unknown).
2. `server/src/controllers/search.controller.spec.ts` — accept/reject tests → **red**.
3. `server/src/services/search.service.spec.ts` — forwarding test → **red**.
4. Add the two schema fields → green.
5. Regenerate clients; commit the generated diff separately from the source change.

### Unit tests

`search.dto.spec.ts`:

- `SearchSuggestionRequestDto.schema.safeParse({ type: 'camera-model', city: 'Berlin' })` → `success`,
  `data.city === 'Berlin'`
- `… { type: 'camera-model', mediaType: 'IMAGE' }` → `success`, `data.mediaType === AssetType.Image`
- `… { type: 'camera-model', mediaType: 'NOT_A_TYPE' }` → `success === false`

`search.controller.spec.ts` (mirrors the existing `GET /search/suggestions` block):

- `?type=camera-model&city=Berlin&mediaType=IMAGE` → 200, service called with both
- `?type=camera-model&mediaType=bogus` → 400

`search.service.spec.ts`:

- forwards `city` and `mediaType` into `getCameraModels`

### Edge cases

| Case                                   | Expected                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| Neither param sent                     | Identical behaviour to before                                                |
| `mediaType=AUDIO` / `OTHER`            | Accepted by the schema (the enum has four members); simply matches no assets |
| `city` sent with `type=city`           | Self-excluded by `getCities`' existing `without(options, 'city')`            |
| Older clients (mobile on an old build) | Both params are optional — no behaviour change                               |

### Done gate

- `cd server && pnpm exec vitest run --config test/vitest.config.mjs src/dtos/search.dto.spec.ts src/controllers/search.controller.spec.ts src/services/search.service.spec.ts` green
- `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`, `mobile/openapi/**`
  regenerated and committed
- `cd server && pnpm check` green

---

## Slice 4 — `FilterContext` carries the location / camera / media dimensions

Makes the panel actually send the dimensions the server now honours.

### Changes

`web/src/lib/components/filter-panel/filter-panel.ts`:

```ts
import { AssetTypeEnum } from '@immich/sdk';

export type FilterContext = {
  takenAfter?: string;
  takenBefore?: string;
  personIds?: string[];
  tagIds?: string[];
  rating?: number;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
  country?: string;
  city?: string;
  make?: string;
  model?: string;
  mediaType?: AssetTypeEnum;
};
```

In `buildFilterContext`, after the `isInAlbum` block and before the date handling:

```ts
if (includes('country') && state.country) {
  context.country = state.country;
}
if (includes('city') && state.city) {
  context.city = state.city;
}
if (includes('make') && state.make) {
  context.make = state.make;
}
if (includes('model') && state.model) {
  context.model = state.model;
}
if (includes('mediaType') && state.mediaType !== 'all') {
  context.mediaType = state.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
}
```

`web/src/lib/components/filter-panel/filter-panel.svelte:89` — the §3.3 carve-out plus its comment.

No provider or route changes: every call site already spreads `...context`.

### TDD steps

1. `filter-state.spec.ts` — the pure tests below → **red**.
2. `contextual-refetch.spec.ts` — update the existing cross-dimension test → **red**.
3. Apply the `FilterContext` / `buildFilterContext` change → green.
4. Add the count-gate regression test → **red** (it will see the new keys) → apply the line-89 carve-out →
   green.

### Unit tests — `filter-state.spec.ts`

| #   | Test                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------- |
| 4.1 | emits `country` and `city` when set                                                                  |
| 4.2 | emits `make` and `model` when set                                                                    |
| 4.3 | emits `mediaType: AssetTypeEnum.Image` for `'image'` and `.Video` for `'video'`                      |
| 4.4 | omits `mediaType` for `'all'`                                                                        |
| 4.5 | `buildFilterContext(state, ['country','city'])` omits both but keeps `make` / `model` / `mediaType`  |
| 4.6 | `buildFilterContext(state, ['make','model'])` omits both but keeps `country` / `city` / `mediaType`  |
| 4.7 | returns `undefined` when the only "filter" is `mediaType: 'all'` and nothing else is set             |
| 4.8 | a state with **only** a country now yields a defined context (previously `undefined`)                |
| 4.9 | the existing `'should include active filters for dependent suggestions'` test still passes unchanged |

### Unit tests — `contextual-refetch.spec.ts`

The existing `'should pass custom from date context to dependent city and camera model providers'` (line 417)
currently asserts `{ takenAfter }` only after clicking country `Germany` **and** make `Canon`. Update it to
the corrected expectation and rename it:

```ts
expect(cities).toHaveBeenLastCalledWith('Germany', {
  takenAfter: '2024-01-01T00:00:00.000Z',
  make: 'Canon',
});
expect(cameraModels).toHaveBeenLastCalledWith('Canon', {
  takenAfter: '2024-01-01T00:00:00.000Z',
  country: 'Germany',
});
```

Add a new test: selecting a media type re-invokes both dependent providers with
`mediaType: AssetTypeEnum.Video`.

`cascade-fix.spec.ts` (`('Germany', undefined)` / `('Fujifilm', undefined)`) must stay green **unchanged** —
those states have no other active filters, so both contexts are still `undefined`. Confirm, do not edit.

### Regression test — count gate

New test in `filter-panel.spec.ts` (or `filter-sections.spec.ts`, whichever already renders a section with an
empty list): with **only** `filters.make` set and an empty People list, the People section is **not**
disabled and does not render `(0)`. This locks §3.3's carve-out.

### Edge cases

| Case                                                                       | Expected                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Country selected, then a make with no photos in that country               | Model list is `[]`; the `result.length > 0` guard leaves any selected model alone         |
| Model selected, then a country where that model has no photos              | Model list is non-empty but lacks the selection → cascade auto-clears the model (correct) |
| Make selected → city list re-fetches                                       | `locationFilterContext` now includes `make`, so the effect re-runs                        |
| Media type `'all'`                                                         | No `mediaType` key sent; identical to today                                               |
| A surface whose provider prepends `spaceId` / `withSharedSpaces`           | Unaffected — the context never carries those keys                                         |
| `photos/+page.svelte`'s `isFavorite === undefined ? withSharedSpaces` rule | Unaffected — keyed on `isFavorite` only                                                   |

### Done gate

- `cd web && pnpm exec vitest run src/lib/components/filter-panel` green
- `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint` clean
- `cd e2e && pnpm test:web photos-filter-panel` green (no cascade regression)

---

## 5. Cross-cutting

### Performance

`buildFilteredAssetIds` produces `asset_exif.assetId in (<subquery over asset>)`. This is the shape
`getCities`, `getFilterSuggestions` and `getSmartSearchFacets` have shipped with since #436, on the same
tables and indexes. No new index is required. If a large library regresses, the fix belongs in
`buildFilteredAssetIds` for all callers at once, not in a per-method special case.

### Decisions taken (open to override)

1. **Fix all five EXIF suggestion types, not just camera models.** The issue explicitly anticipates other
   two-level sections, and leaving `getExifField` alive is what let #436's fix fail to generalise.
2. **Exclude only the field being listed.** Every other param — including the drill-down parent — stays
   applied. `getCountries` / `getStates` additionally exclude `city`, mirroring `getFilterSuggestions`.
3. **The count/disable gate keeps today's behaviour** (§3.3). Greying out empty sections on a location- or
   camera-only filter is a separate UX change.
4. **Medium tests are the primary layer.** Mocked-repository unit tests cannot catch a missing `where`.
5. **`rating` stays a minimum (`>=`)**, consistent with every other faceted path.

### Non-goals

- **Mobile.** `mobile/lib/providers/photos_filter/camera_model_suggestions.provider.dart` and
  `city_suggestions.provider.dart` send only the parent value (`make` / `country`) plus
  `withSharedSpaces` — they carry no filter context at all, so mobile keeps the un-narrowed second level even
  after this change. The server fix is a prerequisite for closing that; plumbing the mobile filter state into
  those providers deserves its own issue.
- **Smart-search mode.** Already correct via `getSmartSearchFacets`; untouched.
- **The `state` suggestion type in the web UI.** Not surfaced by the filter panel; the repository fix lands
  anyway for API consumers.
- **Any change to the cascade auto-clear policy** in `camera-filter.svelte` / `location-filter.svelte`.
- **Adding counts next to each suggestion value** ("Canon EOS R5 (312)"). Frequently requested alongside this,
  but a separate feature.

---

## 6. Coverage matrix

| Edge case / behaviour                                  | Slice | Test                                                             |
| ------------------------------------------------------ | ----- | ---------------------------------------------------------------- |
| Camera models narrow by tag (the reported bug)         | 1     | medium 1.1 + e2e `narrows camera models by an active tag filter` |
| … by people / identities                               | 1     | medium 1.2, 1.13                                                 |
| … by rating (minimum)                                  | 1     | medium 1.3 + e2e rating test                                     |
| … by media type                                        | 1     | medium 1.4                                                       |
| … by favourites                                        | 1     | medium 1.5                                                       |
| … by location                                          | 1     | medium 1.6                                                       |
| … by date range                                        | 1     | medium 1.7                                                       |
| … by album membership                                  | 1     | medium 1.8                                                       |
| Drill-down parent `make` still applied                 | 1     | medium 1.9                                                       |
| No self-narrowing on `model`                           | 1     | medium 1.11 + e2e `keeps every camera model…`                    |
| `forceEmptyResult` honoured                            | 1     | medium 1.12                                                      |
| Visibility semantics preserved                         | 1, 2  | medium 1.14, 1.15, 2.10                                          |
| Owner / trash scoping preserved                        | 1     | medium 1.16, 1.17                                                |
| Distinct + sorted output                               | 1, 2  | medium 1.18, 2.11                                                |
| Empty result, no throw                                 | 1     | medium 1.19                                                      |
| DTO→repository forwarding                              | 1, 3  | `search.service.spec.ts`                                         |
| Makes / countries / states / lens models narrow        | 2     | medium 2.1–2.9                                                   |
| `getExifField` gone                                    | 2     | `cd server && pnpm check` + `grep`                               |
| `city` / `mediaType` accepted on `/search/suggestions` | 3     | `search.dto.spec.ts`, `search.controller.spec.ts`                |
| Invalid `mediaType` rejected                           | 3     | `search.controller.spec.ts`                                      |
| Context carries country/city/make/model/mediaType      | 4     | `filter-state.spec.ts` 4.1–4.6                                   |
| `mediaType: 'all'` omitted                             | 4     | `filter-state.spec.ts` 4.4, 4.7                                  |
| Providers receive the new dimensions                   | 4     | `contextual-refetch.spec.ts`                                     |
| No-other-filters contexts stay `undefined`             | 4     | `cascade-fix.spec.ts` (unchanged)                                |
| Count/disable gate unchanged                           | 4     | count-gate regression test                                       |

---

## 7. Process notes for `/impl-loop`

- Work in the existing worktree; branch `fix/858-second-level-filter-narrowing`.
- One commit per slice, `fix(search): …` / `fix(web): …`, no `Co-Authored-By` trailers.
- **Never run `mise sql` (`mise //:sql` from a subdirectory) without a running database** — it deletes every query file. Start
  the dev stack first, regenerate, then verify the diff only touches the methods this change edits.
- Server unit tests need `--config test/vitest.config.mjs`; a fresh worktree needs `@immich/sdk`, the plugin
  SDK and plugin-core built before either the unit or medium suites will collect.
- `pnpm test -- --run <path>` silently drops the path filter in this repo — pass the path without the extra
  `--`, or use `--config` + path together and confirm the file count in the output.
- Slice 3's generated-client diff is large; keep it in its own commit so the source change stays reviewable.
- Run `cd docs && pnpm format` after touching anything under `docs/` — CI Docs Build runs
  `prettier --check .`.

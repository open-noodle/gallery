# No-Location Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user filter their photos down to the ones with no location — either no GPS at all, or GPS the geocoder could not name — on every web filter-panel surface and on mobile.

**Architecture:** One new optional enum, `locationPresence: 'noGps' | 'noPlaceName'`, joins the existing location filter group (city/state/country) as a mutually exclusive alternative. `noGps` becomes a correlated `NOT EXISTS` against `asset_exif` (so assets with no exif row at all are matched); `noPlaceName` becomes `latitude IS NOT NULL AND city IS NULL` inside the existing exif join. Two server-computed boolean flags gate whether each entry is offered, exactly as `hasUnnamedPeople` already gates the unnamed-people entry.

**Tech Stack:** NestJS 11 + Kysely + Zod 4 (server), SvelteKit + Svelte 5 runes + Vitest (web), Flutter + Riverpod (mobile), OpenAPI-generated TS SDK and Dart client.

**Spec:** `docs/superpowers/specs/2026-08-14-no-location-filter-design.md`

## Global Constraints

- **Enum values are exactly** `'noGps'` and `'noPlaceName'`. The wire/state key is exactly `locationPresence` — never `locationState` (`state` already means province throughout this codebase).
- **Flag names are exactly** `hasNoGpsAssets` and `hasNoPlaceNameAssets`.
- **i18n keys are exactly** `filter_location_no_gps` and `filter_location_no_place_name`.
- **`locationPresence` is a member of the location group.** It is never combined with `city`, `state` or `country`; selecting it clears them and selecting any of them clears it. It never adds a second chip, a second section, or a second unit to the active-filter count.
- **Every user-facing string lands in all ten locale files in the same commit:** `en` plus `de` · `fr` · `it` · `nl` · `pl` · `es` · `ru` · `zh_Hans` · `zh_Hant`. Keys are alphabetically sorted, 2-space indent, unescaped Unicode; finish with `npx prettier --write i18n/*.json`.
- **Server imports use the `src/` alias.** No relative imports.
- **Do not commit branded output.** Leave upstream Immich names in source.
- **No `Co-Authored-By` or `Generated-with` trailers on commits.**
- **Mobile Flutter version is pinned in `mobile/mise.toml`.** Read the pin; do not assume it. Generated localization must be rebuilt before mobile tests: `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`.

---

### Task 1: Server — the two SQL predicates

The core of the change. Both query builders gain the predicates; nothing is exposed over HTTP yet.

**Files:**

- Modify: `server/src/repositories/search.repository.ts:101-111` (`SearchExifOptions`)
- Modify: `server/src/repositories/asset.repository.ts:143` (`TimeBucketOptions`), `:273-334` (`withTimeBucketAssetFilters`)
- Modify: `server/src/utils/database.ts:790-920` (`searchAssetBuilderLegacy`)
- Test: `server/test/medium/specs/repositories/search.repository.spec.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `type LocationPresence = 'noGps' | 'noPlaceName'`, exported from `src/repositories/search.repository.ts`. `SearchExifOptions.locationPresence?: LocationPresence` (flows into `AssetSearchOptions` → `AssetSearchBuilderOptions` → `searchAssetBuilderLegacy`). `TimeBucketOptions.locationPresence?: LocationPresence`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/medium/specs/repositories/search.repository.spec.ts`, inside the top-level `describe(SearchRepository.name, …)`:

```ts
describe('locationPresence', () => {
  // A1 no exif row · A2 exif/no lat/no city · A3 exif/lat/no city
  // A4 fully located · A5 city without lat (unreachable via the app; pins the predicate)
  const newLocationFixture = async (ctx: Awaited<ReturnType<typeof setup>>['ctx'], userId: string) => {
    const { asset: a1 } = await ctx.newAsset({ ownerId: userId });

    const { asset: a2 } = await ctx.newAsset({ ownerId: userId });
    await ctx.newExif({ assetId: a2.id, latitude: null, longitude: null, city: null, country: null });

    const { asset: a3 } = await ctx.newAsset({ ownerId: userId });
    await ctx.newExif({ assetId: a3.id, latitude: 48.85, longitude: 2.35, city: null, country: null });

    const { asset: a4 } = await ctx.newAsset({ ownerId: userId });
    await ctx.newExif({ assetId: a4.id, latitude: 48.85, longitude: 2.35, city: 'Paris', country: 'France' });

    const { asset: a5 } = await ctx.newAsset({ ownerId: userId });
    await ctx.newExif({ assetId: a5.id, latitude: null, longitude: null, city: 'Berlin', country: 'Germany' });

    return { a1, a2, a3, a4, a5 };
  };

  const search = async (
    sut: Awaited<ReturnType<typeof setup>>['sut'],
    userId: string,
    options: Record<string, unknown>,
  ) => {
    const { items } = await sut.searchMetadata({ page: 1, size: 100 }, { userIds: [userId], ...options });
    return items.map((item) => item.id).sort();
  };

  it('matches assets with no coordinates, including assets with no exif row at all', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { a1, a2, a5 } = await newLocationFixture(ctx, user.id);

    await expect(search(sut, user.id, { locationPresence: 'noGps' })).resolves.toEqual([a1.id, a2.id, a5.id].sort());
  });

  it('matches only assets that have coordinates but no place name', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { a3 } = await newLocationFixture(ctx, user.id);

    await expect(search(sut, user.id, { locationPresence: 'noPlaceName' })).resolves.toEqual([a3.id]);
  });

  it('returns disjoint sets whose union is everything that is not fully located', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { a1, a2, a3, a4, a5 } = await newLocationFixture(ctx, user.id);

    const noGps = await search(sut, user.id, { locationPresence: 'noGps' });
    const noPlaceName = await search(sut, user.id, { locationPresence: 'noPlaceName' });

    expect(noGps.filter((id) => noPlaceName.includes(id))).toEqual([]);
    expect([...noGps, ...noPlaceName].sort()).toEqual([a1.id, a2.id, a3.id, a5.id].sort());
    expect(noGps).not.toContain(a4.id);
    expect(noPlaceName).not.toContain(a4.id);
  });

  it('is NOT equivalent to the existing city-is-null filter', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { a2, a3 } = await newLocationFixture(ctx, user.id);

    // city:null joins asset_exif, so it drops the row-less A1, and A5 carries a place name.
    // This test exists so nobody "simplifies" the two predicates into the one that already existed.
    await expect(search(sut, user.id, { city: null })).resolves.toEqual([a2.id, a3.id].sort());
  });

  it('narrows rather than replaces other dimensions', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { a1 } = await newLocationFixture(ctx, user.id);
    const { tag } = await ctx.newTag({ userId: user.id, value: 'trip' });
    await ctx.newTagAsset({ assetId: a1.id, tagId: tag.id });

    await expect(search(sut, user.id, { locationPresence: 'noGps', tagIds: [tag.id] })).resolves.toEqual([a1.id]);
  });

  it('does not return another user’s assets', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    await newLocationFixture(ctx, stranger.id);

    await expect(search(sut, user.id, { locationPresence: 'noGps' })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test:medium -- --run src/../test/medium/specs/repositories/search.repository.spec.ts -t locationPresence`

Expected: FAIL. TypeScript rejects `locationPresence` as an unknown property of the search options.

> If `ctx.newTag` / `ctx.newTagAsset` do not exist with those names, read `server/test/medium.factory.ts` and use the actual factory methods; the assertion is what matters, not the fixture helper's name.

- [ ] **Step 3: Add the option types**

In `server/src/repositories/search.repository.ts`, above `SearchExifOptions` (line 101):

```ts
/** Which "missing location" state to filter for. The two values are disjoint. */
export type LocationPresence = 'noGps' | 'noPlaceName';
```

Then add one property inside `SearchExifOptions`:

```ts
  /**
   * Absence-of-location filter. Mutually exclusive with city/state/country — it is a member of the
   * same location group, never an extra narrowing on top of one.
   */
  locationPresence?: LocationPresence;
```

In `server/src/repositories/asset.repository.ts`, add the same property to `TimeBucketOptions` (interface at `:143`), importing the type:

```ts
import { LocationPresence } from 'src/repositories/search.repository';
```

- [ ] **Step 4: Add the predicates to `searchAssetBuilderLegacy`**

In `server/src/utils/database.ts`, immediately after the existing `options.country` clause (ends line 917):

```ts
      .$if(options.locationPresence === 'noPlaceName', (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where('asset_exif.latitude', 'is not', null)
          .where('asset_exif.city', 'is', null),
      )
      // Deliberately NOT a join: an asset whose metadata has not been extracted has no asset_exif
      // row at all, and is exactly the kind of asset "no GPS" must find. Mirrors the tagIds === null
      // predicate above.
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

- [ ] **Step 5: Add the predicates to `withTimeBucketAssetFilters`**

In `server/src/repositories/asset.repository.ts`, extend the exif-join trigger condition (`:282-290`) — **this line is load-bearing; without it the `noPlaceName` branch never executes and the filter silently returns everything**:

```ts
        !!options.lensModel ||
        !!options.description ||
        options.locationPresence === 'noPlaceName' ||
        options.rating !== undefined,
```

Inside the same block, after the `options.state` clause:

```ts
if (options.locationPresence === 'noPlaceName') {
  q = q.where('asset_exif.latitude', 'is not', null).where('asset_exif.city', 'is', null) as any;
}
```

And after the whole `$if(...)` join block closes (before `.$if(options.visibility === undefined, …)`):

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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts -t locationPresence`
Expected: PASS, six tests.

- [ ] **Step 7: Add the timeline-path test**

Append to the same `describe('locationPresence', …)`. `getTimeBuckets` is what the photos timeline actually calls, and it uses the _other_ builder:

```ts
it('narrows the timeline buckets, not just metadata search', async () => {
  const { ctx } = setup();
  const assets = ctx.get(AssetRepository);
  const { user } = await ctx.newUser();
  await newLocationFixture(ctx, user.id);

  const all = await assets.getTimeBuckets({ userIds: [user.id] });
  const noGps = await assets.getTimeBuckets({ userIds: [user.id], locationPresence: 'noGps' });

  const total = (buckets: { count: number }[]) => buckets.reduce((sum, b) => sum + b.count, 0);
  expect(total(all)).toBe(5);
  expect(total(noGps)).toBe(3);
});
```

- [ ] **Step 8: Add the scope and visibility tests**

The predicates are AND-ed into builders that already gate on owner, visibility and trash. These pin that they did not bypass any of it — a filter that leaks another user's photos is the worst outcome this change can produce.

```ts
it('respects visibility and trash gating', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset: trashed } = await ctx.newAsset({ ownerId: user.id, deletedAt: new Date() });
  const { asset: archived } = await ctx.newAsset({
    ownerId: user.id,
    visibility: AssetVisibility.Archive,
  });
  const { asset: visible } = await ctx.newAsset({ ownerId: user.id });

  const ids = await search(sut, user.id, {
    locationPresence: 'noGps',
    visibility: AssetVisibility.Timeline,
  });

  expect(ids).toEqual([visible.id]);
  expect(ids).not.toContain(trashed.id);
  expect(ids).not.toContain(archived.id);
});

it('returns an un-geotagged asset shared through a timeline-enabled space', async () => {
  // Mirror the shared-space setup the space tests in this file already use: create a space,
  // add the viewer as a member, put the owner's un-geotagged asset in it, then search as the
  // viewer with the space scope applied. Assert the asset IS returned — the correlated
  // NOT EXISTS must survive alongside the shared-space joins.
});
```

> Fill in the second test from the shared-space helpers this spec file already uses. If none exist here, move that one assertion to `server/test/medium/specs/services/timeline.service.spec.ts`, which does have space fixtures, rather than inventing a new harness.

- [ ] **Step 9: Run it, confirm green, then lint and typecheck**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts -t locationPresence`
Expected: PASS, nine tests.

Run: `make lint-server && make check-server`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add server/src/repositories/search.repository.ts server/src/repositories/asset.repository.ts server/src/utils/database.ts server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "feat(server): filter assets by absence of location"
```

---

### Task 2: Server — expose `locationPresence` over HTTP

**Files:**

- Modify: `server/src/dtos/time-bucket.dto.ts:20-131` (base schema + the three DTO schemas)
- Modify: `server/src/dtos/search.dto.ts:25-75` (`BaseSearchSchema`), `:92-116` (derived schemas)
- Test: `server/src/dtos/time-bucket.dto.spec.ts`, `server/src/dtos/search.dto.spec.ts`

**Interfaces:**

- Consumes: `LocationPresence` from Task 1.
- Produces: the query param `locationPresence` on the time-bucket, time-bucket-asset, time-bucket-cover and all search DTOs. Rejects the param alongside `city` / `state` / `country` with a validation error.

- [ ] **Step 1: Write the failing test**

Append to `server/src/dtos/time-bucket.dto.spec.ts`:

```ts
describe('locationPresence query param handling', () => {
  it.each(['noGps', 'noPlaceName'])('accepts locationPresence=%s', (locationPresence) => {
    const result = TimeBucketDto.schema.safeParse({ locationPresence });

    expect(result.success).toBe(true);
  });

  it('rejects a value outside the enum', () => {
    expect(TimeBucketDto.schema.safeParse({ locationPresence: 'nogps' }).success).toBe(false);
  });

  it.each(['city', 'state', 'country'])('rejects locationPresence alongside %s', (sibling) => {
    const result = TimeBucketDto.schema.safeParse({ locationPresence: 'noGps', [sibling]: 'Paris' });

    expect(result.success).toBe(false);
  });

  it('accepts city without locationPresence', () => {
    expect(TimeBucketDto.schema.safeParse({ city: 'Paris' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && pnpm test -- --run src/dtos/time-bucket.dto.spec.ts`
Expected: FAIL — the sibling-rejection cases pass parsing because no constraint exists yet.

- [ ] **Step 3: Add the field and the sibling constraint**

In `server/src/dtos/time-bucket.dto.ts`, add to `TimeBucketQueryBaseSchema` beside `state` (`:66`):

```ts
    locationPresence: z
      .enum(['noGps', 'noPlaceName'])
      .optional()
      .describe(
        'Filter for assets with no location: noGps (no coordinates) or noPlaceName (coordinates the geocoder could not name). Cannot be combined with city, state or country.',
      ),
```

Then wrap each of the three DTO-facing schemas (`:128-131`, `:194`). Import the helper:

```ts
import { IsNotSiblingOf } from 'src/validation';
```

```ts
const locationPresenceIsExclusive = <T extends z.ZodObject<z.ZodRawShape>>(schema: T) =>
  schema.pipe(IsNotSiblingOf(schema, 'locationPresence', ['city', 'state', 'country']));

const TimeBucketSchema = locationPresenceIsExclusive(TimeBucketQueryBaseSchema);
const TimeBucketAssetSchema = locationPresenceIsExclusive(
  TimeBucketQueryBaseSchema.extend({
    timeBucket: z.string().describe('Time bucket identifier in YYYY-MM-DD format').meta({ example: '2024-01-01' }),
  }),
).meta({ id: 'TimeBucketAssetDto' });
```

Apply the same wrapper to `TimeBucketCoverSchema` (`:194`), keeping its `.meta({ id: 'TimeBucketCoverDto' })` **after** the pipe.

> **Watch the OpenAPI ids.** `TimeBucketQueryBaseSchema` already carries `.meta({ id: 'TimeBucketDto' })`. Piping must not change the emitted schema names. After `make open-api` in Task 4, confirm `TimeBucketDto`, `TimeBucketAssetDto` and `TimeBucketCoverDto` still appear in `open-api/immich-openapi-specs.json` with the same names. If a name moved, re-apply `.meta({ id })` on the piped schema rather than the base.

- [ ] **Step 4: Do the same for the search DTOs**

In `server/src/dtos/search.dto.ts`, add the identical `locationPresence` field to `BaseSearchSchema` beside `country` (`:43`) — **unwrapped**, so all five derived schemas inherit it. Then pipe the constraint onto each controller-facing schema (`MetadataSearchSchema`, `SmartSearchSchema`, `StatisticsSearchSchema`, `RandomSearchSchema`, `LargeAssetSearchSchema`), following the two existing `.pipe(IsNotSiblingOf(…))` call sites at `:217-221` and `:315-319`.

Do **not** attach the constraint to `BaseSearchSchema` itself: it is `.extend()`ed five times (`:76`, `:82`, `:87`, `:92`, `:105`, `:109`) and must stay a plain object schema.

Add matching tests to `server/src/dtos/search.dto.spec.ts` covering `MetadataSearchDto` — the same four cases as Step 1.

- [ ] **Step 5: Run both DTO specs**

Run: `cd server && pnpm test -- --run src/dtos/time-bucket.dto.spec.ts src/dtos/search.dto.spec.ts`
Expected: PASS.

- [ ] **Step 6: Confirm the param reaches the query**

`timeline.service.ts` passes timeline options through untouched and `AssetSearchOptions` composes `SearchExifOptions`, so no service edit should be needed. Verify by typechecking:

Run: `make check-server && make lint-server`
Expected: clean. If `tsc` reports `locationPresence` missing on an options object, add the passthrough it names.

- [ ] **Step 7: Commit**

```bash
git add server/src/dtos/ server/src/repositories/
git commit -m "feat(server): accept locationPresence on the timeline and search endpoints"
```

---

### Task 3: Server — gate the entries on suggestion flags

**Files:**

- Modify: `server/src/dtos/search.dto.ts:256-266` (`FilterSuggestionsResponseSchema`), `:268-284` (`SmartSearchFacetsResponseSchema`), `:286-313` (`FilterSuggestionsRequestBaseSchema`)
- Modify: `server/src/repositories/search.repository.ts:290-318` (`FilterSuggestionFilterOptions`), `:692` (smart-facet exclude branch), `:1193` + `:1406` (location-group exclusions), `:610-640` + `:1402-1420` (the two assembly sites)
- Test: `server/test/medium/specs/repositories/search.repository.spec.ts`

**Interfaces:**

- Consumes: `LocationPresence` (Task 1), the `locationPresence` request field (Task 2).
- Produces: `hasNoGpsAssets: boolean` and `hasNoPlaceNameAssets: boolean` on **both** `FilterSuggestionsResponseDto` and `SmartSearchFacetsResponseDto`.

- [ ] **Step 1: Write the failing test**

```ts
it('reports which absence-of-location entries are worth offering', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  await newLocationFixture(ctx, user.id);

  const suggestions = await sut.getFilterSuggestions([user.id], {});

  expect(suggestions.hasNoGpsAssets).toBe(true);
  expect(suggestions.hasNoPlaceNameAssets).toBe(true);
});

it('reports both false for a fully located library', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newExif({ assetId: asset.id, latitude: 48.85, longitude: 2.35, city: 'Paris', country: 'France' });

  const suggestions = await sut.getFilterSuggestions([user.id], {});

  expect(suggestions.hasNoGpsAssets).toBe(false);
  expect(suggestions.hasNoPlaceNameAssets).toBe(false);
});

it('keeps the sibling entry offered once one is selected', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  await newLocationFixture(ctx, user.id);

  const suggestions = await sut.getFilterSuggestions([user.id], { locationPresence: 'noGps' });

  // Both flags are computed with the location group excluded, so selecting one entry must not
  // make the other vanish from the panel.
  expect(suggestions.hasNoPlaceNameAssets).toBe(true);
  expect(suggestions.countries).toContain('France');
});

it('reports the same flags through the smart-facets path', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { a1 } = await newLocationFixture(ctx, user.id);
  await addEmbedding(ctx.database, a1.id);

  const facets = await sut.getSmartSearchFacets({ userIds: [user.id], embedding: matchingEmbedding });

  expect(facets.hasNoGpsAssets).toBe(true);
});
```

> The smart-facets call shape must match the existing `getSmartSearchFacets` tests in this file — copy their options object rather than inventing one.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts -t locationPresence`
Expected: FAIL — `hasNoGpsAssets` is `undefined`.

- [ ] **Step 3: Add the response fields**

In `server/src/dtos/search.dto.ts`, add to **both** response schemas, beside their existing `hasUnnamedPeople`:

```ts
    hasNoGpsAssets: z.boolean().describe('Whether assets without coordinates exist in the filtered set'),
    hasNoPlaceNameAssets: z
      .boolean()
      .describe('Whether assets with coordinates but no place name exist in the filtered set'),
```

Add `locationPresence` to `FilterSuggestionsRequestBaseSchema` (same shape as Task 2 Step 3) and to `FilterSuggestionFilterOptions` (`search.repository.ts:290`).

- [ ] **Step 4: Compute the flags**

Add a private helper to `SearchRepository` that counts, within the caller's already-scoped asset ids, whether either state exists:

```ts
  private async getLocationPresenceFlags(userIds: string[], options: FilterSuggestionsOptions) {
    // The location group excludes itself, exactly like getCountries — otherwise selecting one entry
    // recomputes the other inside the already-narrowed set and the sibling entry disappears.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'country', 'state', 'city', 'locationPresence'));

    const row = await this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .where('asset.id', 'in', filteredIds)
      .select((eb) => [
        eb.fn
          .count<number>(sql`case when "asset_exif"."latitude" is null then 1 end`)
          .as('noGps'),
        eb.fn
          .count<number>(sql`case when "asset_exif"."latitude" is not null and "asset_exif"."city" is null then 1 end`)
          .as('noPlaceName'),
      ])
      .executeTakeFirst();

    return { hasNoGpsAssets: Number(row?.noGps ?? 0) > 0, hasNoPlaceNameAssets: Number(row?.noPlaceName ?? 0) > 0 };
  }
```

> Note the **left** join: an asset with no `asset_exif` row must count towards `hasNoGpsAssets`.

Call it from both assembly sites — the `Promise.all` at `:1402-1420` (filter suggestions) and the sequential block at `:610-640` (smart facets) — and spread the result into each returned object.

Add `'locationPresence'` to the location-group `without(...)` exclusions at `:1193` (`getCountries`) and `:1406` (`getFilteredCountries`), and honour it under the `exclude !== 'location'` branch at `:692`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts -t locationPresence`
Expected: PASS, all eleven tests.

- [ ] **Step 6: Lint and typecheck, then commit**

Run: `make lint-server && make check-server`

```bash
git add server/src/dtos/search.dto.ts server/src/repositories/search.repository.ts server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "feat(server): report whether absence-of-location filters would match anything"
```

---

### Task 4: Regenerate the API clients

**Files:**

- Modify (generated): `open-api/immich-openapi-specs.json`, `packages/sdk/src/**`, `mobile/openapi/**`

**Interfaces:**

- Consumes: Tasks 2 and 3.
- Produces: `locationPresence` on the generated TS SDK request types and the Dart `TimelineApi` / `SearchApi` methods; `hasNoGpsAssets` / `hasNoPlaceNameAssets` on the generated response types.

- [ ] **Step 1: Build the server and regenerate**

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api
```

- [ ] **Step 2: Verify the OpenAPI schema names did not move**

Run: `grep -c '"TimeBucketDto"\|"TimeBucketAssetDto"\|"TimeBucketCoverDto"' open-api/immich-openapi-specs.json`
Expected: all three present. If any disappeared, the `.pipe()` in Task 2 moved the `.meta({ id })` — fix it there and regenerate.

- [ ] **Step 3: Verify the new fields landed in both clients**

```bash
grep -rn "locationPresence" packages/sdk/src | head -5
grep -rn "locationPresence\|hasNoGpsAssets" mobile/openapi/lib | head -5
```

Expected: non-empty in both. The Dart client models nullable-optional params as `Optional<T>`; a plain optional enum comes through as a nullable field.

- [ ] **Step 4: Commit**

```bash
git add open-api packages/sdk mobile/openapi
git commit -m "chore: regenerate API clients for locationPresence"
```

---

### Task 5: i18n — the two strings in ten locales

Done before any UI so both platforms can reference real keys.

**Files:**

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/nl.json`, `i18n/pl.json`, `i18n/es.json`, `i18n/ru.json`, `i18n/zh_Hans.json`, `i18n/zh_Hant.json`

**Interfaces:**

- Produces: `filter_location_no_gps`, `filter_location_no_place_name`.

- [ ] **Step 1: Add both keys to `i18n/en.json`**

Insert alphabetically (between `filter_invalid_to_date` and `filter_manage_sections`):

```json
  "filter_location_no_gps": "No location",
  "filter_location_no_place_name": "Unnamed place",
```

- [ ] **Step 2: Add both keys to the nine translated locales**

Match each file's existing register and terminology — German, Italian and Spanish address the user informally; French and Russian use the formal form. Look up the file's existing wording for "location" and reuse it rather than inventing a synonym. Suggested values:

| Locale  | `filter_location_no_gps` | `filter_location_no_place_name` |
| ------- | ------------------------ | ------------------------------- |
| de      | Kein Ort                 | Unbenannter Ort                 |
| fr      | Aucun lieu               | Lieu sans nom                   |
| it      | Nessun luogo             | Luogo senza nome                |
| nl      | Geen locatie             | Naamloze locatie                |
| pl      | Brak lokalizacji         | Nienazwane miejsce              |
| es      | Sin ubicación            | Lugar sin nombre                |
| ru      | Без места                | Место без названия              |
| zh_Hans | 无位置                   | 未命名地点                      |
| zh_Hant | 無位置                   | 未命名地點                      |

- [ ] **Step 3: Format and verify**

```bash
npx prettier --write i18n/*.json
node -e "for (const l of ['en','de','fr','it','nl','pl','es','ru','zh_Hans','zh_Hant']) { const j = require('./i18n/'+l+'.json'); if (!j.filter_location_no_gps || !j.filter_location_no_place_name) throw new Error('missing in '+l); } console.log('all ten locales OK')"
```

Expected: `all ten locales OK`.

- [ ] **Step 4: Commit**

```bash
git add i18n
git commit -m "i18n: add absence-of-location filter labels"
```

---

### Task 6: Web — filter state, count, URL codec, removal

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.ts:78-101` (`FilterState`), `:79-89` (`FilterSuggestionsResponse`), `:140-160` (`getActiveFilterCount`)
- Modify: `web/src/lib/utils/filter-url.ts:30-45` (`FILTER_URL_PARAMS`), `:55-79` (`DecodedFilterState`), `:88-110` (encode), `:156-200` (decode)
- Modify: `web/src/lib/utils/filter-remove.ts:30`
- Modify: `web/src/lib/utils/space-search.ts:47-64` (`QUERY_MODE_FILTER_HANDLING`)
- Test: `web/src/lib/utils/__tests__/filter-url.spec.ts`, `web/src/lib/utils/__tests__/filter-remove.spec.ts`, `web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts`

**Interfaces:**

- Consumes: the SDK types from Task 4.
- Produces: `FilterState.locationPresence?: 'noGps' | 'noPlaceName'`; `FilterSuggestionsResponse.hasNoGpsAssets: boolean` and `.hasNoPlaceNameAssets: boolean`; URL param name `locationPresence`.

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/utils/__tests__/filter-url.spec.ts`:

```ts
it('round-trips locationPresence', () => {
  const decoded = decodeFilterParams(new URL(`https://g.test/photos?${encode({ locationPresence: 'noGps' })}`));

  expect(decoded.locationPresence).toBe('noGps');
});

it('drops city, state and country when locationPresence is present', () => {
  const url = new URL('https://g.test/photos?locationPresence=noGps&city=Paris&state=IDF&country=France');
  const decoded = decodeFilterParams(url);

  expect(decoded.locationPresence).toBe('noGps');
  expect(decoded.city).toBeUndefined();
  expect(decoded.state).toBeUndefined();
  expect(decoded.country).toBeUndefined();
});

it('ignores a locationPresence value outside the enum', () => {
  const decoded = decodeFilterParams(new URL('https://g.test/photos?locationPresence=nogps'));

  expect(decoded.locationPresence).toBeUndefined();
});
```

In `filter-state.spec.ts`:

```ts
it('counts locationPresence as the one location filter', () => {
  expect(getActiveFilterCount({ ...createFilterState(), locationPresence: 'noGps' })).toBe(1);
  expect(getActiveFilterCount({ ...createFilterState(), locationPresence: 'noGps', country: 'France' })).toBe(1);
});
```

In `filter-remove.spec.ts`:

```ts
it('clears locationPresence with the location group', () => {
  const next = handleRemoveFilter({ ...createFilterState(), locationPresence: 'noGps' }, 'location');

  expect(next.locationPresence).toBeUndefined();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/filter-url.spec.ts src/lib/utils/__tests__/filter-remove.spec.ts src/lib/components/filter-panel/__tests__/filter-state.spec.ts`
Expected: FAIL — `locationPresence` is not a property of `FilterState`.

- [ ] **Step 3: Extend `FilterState` and the count**

In `filter-panel.ts`, add to `FilterState` beside `state`:

```ts
  /** Absence-of-location filter. A member of the location group — never set alongside city/state/country. */
  locationPresence?: 'noGps' | 'noPlaceName';
```

Add to `FilterSuggestionsResponse`:

```ts
hasNoGpsAssets: boolean;
hasNoPlaceNameAssets: boolean;
```

Extend the location term of `getActiveFilterCount` (`:147`):

```ts
    (state.city || state.country || state.state || state.locationPresence ? 1 : 0) + // location counts once
```

- [ ] **Step 4: Extend the URL codec**

Add `'locationPresence'` to `FILTER_URL_PARAMS` and to the `Pick<FilterState, …>` union of `DecodedFilterState`. In `encodeFilterParams`, beside the other location keys:

```ts
setTrimmed('locationPresence', filters.locationPresence);
```

In `decodeFilterParams`, replacing the three plain location reads:

```ts
const locationPresence = get('locationPresence');
if (locationPresence === 'noGps' || locationPresence === 'noPlaceName') {
  result.locationPresence = locationPresence;
}
// The location group is one filter: a hand-edited URL carrying both must not produce a
// combination the server rejects. The narrower, unambiguous statement wins.
if (!result.locationPresence) {
  result.city = get('city');
  result.state = get('state');
  result.country = get('country');
}
```

- [ ] **Step 5: Extend removal and the smart-search classification**

In `filter-remove.ts:30`:

```ts
return { ...filters, city: undefined, state: undefined, country: undefined, locationPresence: undefined };
```

In `space-search.ts`, add to `QUERY_MODE_FILTER_HANDLING` (`tsc` fails until you do — the map is `satisfies Record<keyof FilterState, …>`):

```ts
  locationPresence: 'sent',
```

and forward it in `buildSmartSearchParams` and `buildSmartSearchFacetsParams`. Map both new flags in `mapSmartSearchFacetsToFilterSuggestions` (`:179-200`):

```ts
    hasNoGpsAssets: facets.hasNoGpsAssets,
    hasNoPlaceNameAssets: facets.hasNoPlaceNameAssets,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__ src/lib/components/filter-panel/__tests__/filter-state.spec.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `cd web && pnpm check:typescript`

```bash
git add web/src/lib
git commit -m "feat(web): carry locationPresence through filter state, URL and removal"
```

---

### Task 7: Web — the two rows in the location section

**Files:**

- Modify: `web/src/lib/components/filter-panel/location-filter.svelte:9-45` (props), `:353-420` (render)
- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte:60-75` (state), `:160-175` (suggestions), `:770-790` (location section)
- Modify: `web/src/lib/components/filter-panel/active-filters-bar.svelte:108-120`
- Test: `web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`, `.../orphaned-selections.spec.ts`, `.../active-filters-bar.spec.ts`

**Interfaces:**

- Consumes: `FilterState.locationPresence`, the two flags (Task 6).
- Produces: `location-filter.svelte` props `hasNoGpsAssets: boolean`, `hasNoPlaceNameAssets: boolean`, `selectedLocationPresence?: 'noGps' | 'noPlaceName'`, and a new callback `onLocationPresenceChange: (value?: 'noGps' | 'noPlaceName') => void`. Row test ids: `location-presence-noGps`, `location-presence-noPlaceName`.

- [ ] **Step 1: Write the failing tests**

In `filter-sections.spec.ts`:

```ts
it('offers both absence-of-location rows when the server says they would match', () => {
  const { getByTestId } = renderLocationFilter({ hasNoGpsAssets: true, hasNoPlaceNameAssets: true });

  expect(getByTestId('location-presence-noGps')).toBeInTheDocument();
  expect(getByTestId('location-presence-noPlaceName')).toBeInTheDocument();
});

it('hides a row the server says would match nothing', () => {
  const { queryByTestId } = renderLocationFilter({ hasNoGpsAssets: false, hasNoPlaceNameAssets: false });

  expect(queryByTestId('location-presence-noGps')).not.toBeInTheDocument();
  expect(queryByTestId('location-presence-noPlaceName')).not.toBeInTheDocument();
});

it('replaces the whole location group when a row is clicked', async () => {
  const onLocationPresenceChange = vi.fn();
  const onSelectionChange = vi.fn();
  const { getByTestId } = renderLocationFilter({
    hasNoGpsAssets: true,
    selectedCountry: 'France',
    selectedCity: 'Paris',
    onLocationPresenceChange,
    onSelectionChange,
  });

  await fireEvent.click(getByTestId('location-presence-noGps'));

  expect(onLocationPresenceChange).toHaveBeenCalledWith('noGps');
});
```

In `orphaned-selections.spec.ts`:

```ts
it('keeps a selected absence-of-location row visible after its flag goes false', () => {
  const { getByTestId } = renderLocationFilter({
    hasNoGpsAssets: false,
    selectedLocationPresence: 'noGps',
  });

  // An active filter must never be reachable only through the chip.
  expect(getByTestId('location-presence-noGps')).toBeInTheDocument();
});
```

> Reuse whatever render helper these spec files already define for `location-filter.svelte`; add the new props to it rather than writing a fresh harness.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-sections.spec.ts src/lib/components/filter-panel/__tests__/orphaned-selections.spec.ts`
Expected: FAIL — the test ids do not exist.

- [ ] **Step 3: Add the props and the rows**

Add to the `Props` interface in `location-filter.svelte`:

```ts
  /**
   * Whether the server found any asset in the current scope matching each absence-of-location
   * state. A row is offered only when its flag is true — OR when it is the active selection, so an
   * applied filter is never reachable only through the chip (same rule as `orphanedCountry`).
   */
  hasNoGpsAssets?: boolean;
  hasNoPlaceNameAssets?: boolean;
  selectedLocationPresence?: 'noGps' | 'noPlaceName';
  onLocationPresenceChange?: (value?: 'noGps' | 'noPlaceName') => void;
```

Add a snippet above the country list, reusing the radio-circle markup of `stateRow`:

```svelte
{#snippet presenceRow(value: 'noGps' | 'noPlaceName', label: string)}
  {@const isSelected = selectedLocationPresence === value}
  <button
    type="button"
    class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-subtle"
    onclick={() => onLocationPresenceChange?.(isSelected ? undefined : value)}
    aria-pressed={isSelected}
    data-testid="location-presence-{value}"
  >
    <div
      class="flex size-4 shrink-0 items-center justify-center rounded-full border-2 {isSelected
        ? 'border-immich-primary bg-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary'
        : 'border-gray-300 dark:border-gray-600'}"
    >
      {#if isSelected}
        <div class="size-1.5 rounded-full bg-white dark:bg-black"></div>
      {/if}
    </div>
    <span class="flex-1 truncate text-left">{label}</span>
  </button>
{/snippet}
```

Render both rows immediately after the search input, before `orphanedCountry`:

```svelte
{#if hasNoGpsAssets || selectedLocationPresence === 'noGps'}
  {@render presenceRow('noGps', $t('filter_location_no_gps'))}
{/if}
{#if hasNoPlaceNameAssets || selectedLocationPresence === 'noPlaceName'}
  {@render presenceRow('noPlaceName', $t('filter_location_no_place_name'))}
{/if}
```

The empty-state guard (`countries.length === 0 && !orphanedCountry && !selectedState`) must also admit a selected presence, or a lone selection renders the "No locations found" message instead of its own row.

- [ ] **Step 4: Wire the panel**

In `filter-panel.svelte`, mirror `hasUnnamedPeople`: declare `let hasNoGpsAssets = $state(false)` and `let hasNoPlaceNameAssets = $state(false)`, assign them where `hasUnnamedPeople = result.hasUnnamedPeople` is assigned (`:168`), and pass all three new props into `<LocationFilter />`. Wire `onLocationPresenceChange` to set `locationPresence` and clear `city`/`state`/`country` in one update; the existing country/city `onSelectionChange` handler must additionally clear `locationPresence`.

In `active-filters-bar.svelte:110-112`, extend the location chip label:

```ts
const presenceLabel =
  filters.locationPresence === 'noGps'
    ? $t('filter_location_no_gps')
    : filters.locationPresence === 'noPlaceName'
      ? $t('filter_location_no_place_name')
      : undefined;
const locationParts = [presenceLabel, filters.city, filters.state, filters.country].filter(Boolean);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `cd web && pnpm check:typescript && pnpm check:svelte`

```bash
git add web/src/lib/components/filter-panel
git commit -m "feat(web): offer no-location entries in the location filter"
```

---

### Task 8: Web — per-surface forwarding and map suppression

**Files:**

- Modify: `web/src/lib/utils/photos-filter-options.ts:44-60`, `album-filter-options.ts`, `recently-added-filter-options.ts`, `space-filter-options.ts`, `filter-search-terms.ts:21-38`, `space-search.ts:87-101`
- Modify: `web/src/lib/utils/map-filter-config.ts:17-58`, `map-filter-options.ts`
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte:31`
- Test: `web/src/lib/utils/__tests__/photos-filter-options.spec.ts`, `map-filter-options.spec.ts`, `filter-url.spec.ts`

**Interfaces:**

- Consumes: everything from Tasks 6 and 7.
- Produces: no new interfaces.

- [ ] **Step 1: Write the failing tests**

```ts
// photos-filter-options.spec.ts
it('forwards locationPresence to the timeline query', () => {
  const options = buildPhotosTimelineOptions({ ...createFilterState(), locationPresence: 'noGps' }, 'user-1');

  expect(options.locationPresence).toBe('noGps');
});

// map-filter-options.spec.ts — all four map builders must stay clean
it.each([
  ['buildMapMarkerOptions', () => buildMapMarkerOptions({ ...createFilterState(), locationPresence: 'noGps' })],
  ['buildMapTimeBucketOptions', () => buildMapTimeBucketOptions({ ...createFilterState(), locationPresence: 'noGps' })],
  ['buildMapTimelineOptions', () => buildMapTimelineOptions({ ...createFilterState(), locationPresence: 'noGps' })],
] as const)('never forwards locationPresence via %s', (_name, build) => {
  expect(build().locationPresence).toBeUndefined();
});
```

> `buildMapTimelineOptions` takes extra arguments — check its signature at `map-filter-options.ts:183` and pass whatever the neighbouring tests in this spec pass. `buildAlbumMapMarkerOptions` (`:144`) takes an `albumId` first; add it to the table the same way.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/photos-filter-options.spec.ts src/lib/utils/__tests__/map-filter-options.spec.ts`
Expected: the photos test FAILS; the map test may already pass (guard it anyway — it locks the behaviour in).

- [ ] **Step 3: Forward it on the four in-scope surfaces**

In each of `photos-filter-options.ts`, `album-filter-options.ts`, `recently-added-filter-options.ts` and `space-filter-options.ts`, beside the existing `if (filters.state)` block:

```ts
if (filters.locationPresence) {
  base.locationPresence = filters.locationPresence;
}
```

Do the same in `filter-search-terms.ts` (`terms.locationPresence`) and `space-search.ts`'s `buildSmartSearchParams` (`params.locationPresence`).

- [ ] **Step 4: Suppress it on the map**

In `map-filter-config.ts`, force both flags off in the value returned by `suggestionsProvider`:

```ts
      // The map plots markers from asset_exif.latitude IS NOT NULL (map.repository.ts:187), so a
      // "no GPS" filter can only ever produce an empty map. Never offer either entry here.
      hasNoGpsAssets: false,
      hasNoPlaceNameAssets: false,
```

Leave `map-filter-options.ts` without a `locationPresence` passthrough.

In the map route (`+page.svelte:31`, where `decodeFilterParams` is used), drop the value after decoding:

```ts
// A link copied from /photos can carry locationPresence. The map offers no row for it, so
// keeping it would leave an active filter that is invisible and unremovable.
const { locationPresence: _dropped, ...mapFilters } = decodeFilterParams(url);
```

Add the matching assertion to `filter-url.spec.ts` or the map spec, whichever owns route decoding.

- [ ] **Step 5: Run the full web suite**

Run: `cd web && pnpm test -- --run && pnpm check:typescript && pnpm check:svelte`
Expected: PASS, including `filter-section-parity.spec.ts` unchanged — no section was added or dropped.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): forward locationPresence per surface and suppress it on the map"
```

---

### Task 9: Mobile — the filter model

**Files:**

- Modify: `mobile/lib/models/search/search_filter.model.dart:9-49` (`SearchLocationFilter`), `:305-307` (`SearchFilter.isEmpty`)
- Test: `mobile/test/models/search/search_filter_empty_test.dart`, `search_filter_equality_test.dart`

**Interfaces:**

- Consumes: the Dart client from Task 4.
- Produces: `SearchLocationFilter.locationPresence` (`String?`, values `'noGps'` / `'noPlaceName'`), carried through `copyWith` / `toMap` / `fromMap` / `==` / `hashCode` / `toString`.

- [ ] **Step 1: Write the failing tests**

In `search_filter_empty_test.dart`, beside the existing `untagged display filter is not empty` test:

```dart
    test('locationPresence alone is not empty', () {
      final f = SearchFilter.empty().copyWith(location: SearchLocationFilter(locationPresence: 'noGps'));
      expect(f.isEmpty, false);
    });
```

In `search_filter_equality_test.dart`:

```dart
    test('filters differing only by locationPresence are unequal', () {
      final a = SearchFilter.empty().copyWith(location: SearchLocationFilter(locationPresence: 'noGps'));
      final b = SearchFilter.empty().copyWith(location: SearchLocationFilter(locationPresence: 'noPlaceName'));

      expect(a == b, false);
      expect(a.hashCode == b.hashCode, false);
    });

    test('locationPresence round-trips through toMap/fromMap', () {
      const original = SearchLocationFilter(locationPresence: 'noGps');

      expect(SearchLocationFilter.fromMap(original.toMap()).locationPresence, 'noGps');
    });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd mobile && flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
flutter test test/models/search
```

Expected: FAIL — `SearchLocationFilter` has no `locationPresence` parameter.

- [ ] **Step 3: Add the field**

In `search_filter.model.dart`, extend `SearchLocationFilter`: add the field, the constructor parameter, and carry it through `copyWith`, `toMap`, `fromMap`, `toString`, `==` and `hashCode` exactly as `country` / `state` / `city` are carried.

Extend `SearchFilter.isEmpty` (`:305-307`):

```dart
        location.country == null &&
        location.state == null &&
        location.city == null &&
        location.locationPresence == null &&
```

> **This line is load-bearing.** Without it a filter whose only dimension is `locationPresence` reports `isEmpty == true`, and both `buildPhotosTimelineRouteService` (`timeline_query.provider.dart:31`) and `buildPhotosTimelineQuery` (`:45`) route to the **unfiltered** main library timeline — the chip renders while the results ignore it.

> **Do not use `copyWith` to clear the group.** `SearchLocationFilter.copyWith` is hand-written with `country ?? this.country`, so passing `null` _keeps_ the old value. Clearing means constructing a fresh `SearchLocationFilter()`, which every existing call site already does.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && flutter test test/models/search`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/models/search/search_filter.model.dart mobile/test/models/search
git commit -m "feat(mobile): carry locationPresence on the search filter model"
```

---

### Task 10: Mobile — chip, providers and API forwarding

**Files:**

- Modify: `mobile/lib/providers/photos_filter/active_chips.dart:111-127`
- Modify: `mobile/lib/providers/photos_filter/filter_suggestions.provider.dart:15-25`, `time_buckets.provider.dart:15-25`
- Modify: `mobile/lib/infrastructure/repositories/search_api.repository.dart:35-80`
- Test: `mobile/test/providers/photos_filter/` (chips + providers)

**Interfaces:**

- Consumes: Task 9's model field.
- Produces: no new chip id — the existing `LocationChipId` and `ChipVisual.location` are reused.

- [ ] **Step 1: Write the failing test**

```dart
    test('renders exactly one location chip for locationPresence', () {
      final filter = SearchFilter.empty().copyWith(location: SearchLocationFilter(locationPresence: 'noGps'));

      final chips = activeChipsFromFilter(filter);

      final location = chips.where((c) => c.id == const LocationChipId()).toList();
      expect(location.length, 1);
      expect(location.single.visual, ChipVisual.location);
      expect(location.single.label, 'filter_location_no_gps'.tr());
    });
```

The builder is `activeChipsFromFilter(SearchFilter filter, {FilterSuggestionsResponseDto? suggestions})` (`active_chips.dart:44`).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && flutter test test/providers/photos_filter`
Expected: FAIL — no chip is produced.

- [ ] **Step 3: Include the label in the chip**

In `active_chips.dart`, before building `locParts`:

```dart
  final presenceLabel = switch (filter.location.locationPresence) {
    'noGps' => 'filter_location_no_gps'.tr(),
    'noPlaceName' => 'filter_location_no_place_name'.tr(),
    _ => null,
  };
  final locParts = [
    presenceLabel,
    filter.location.country,
    filter.location.state,
    filter.location.city,
  ].where((s) => s != null && s.isNotEmpty).cast<String>().toList();
```

- [ ] **Step 4: Forward it to the server**

In `time_buckets.provider.dart`, add `locationPresence: filter.location.locationPresence` to the `getTimeBuckets` call. In `filter_suggestions.provider.dart`, forward it and expose the two new flags from the response. In `search_api.repository.dart`, forward it at both call sites (`:39-41`, `:72-78`) following the surrounding `Optional` convention the generated client requires.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mobile && flutter test test/providers/photos_filter && dart analyze --fatal-infos`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/providers mobile/lib/infrastructure mobile/test/providers
git commit -m "feat(mobile): surface and forward the locationPresence filter"
```

---

### Task 11: Mobile — the three places surfaces

**Files:**

- Modify: `mobile/lib/presentation/widgets/filter_sheet/strips/places_strip.widget.dart:100-125`
- Modify: `mobile/lib/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart:110-180`
- Modify: `mobile/lib/presentation/pages/photos_filter/places_picker.page.dart:100-130`
- Test: `mobile/test/providers/photos_filter/places_picker_provider_test.dart` and the widget tests covering these surfaces

**Interfaces:**

- Consumes: Tasks 9 and 10.
- Produces: no new interfaces.

- [ ] **Step 1: Write the failing test**

Each of the three surfaces reads its country list from `photosFilterSuggestionsProvider`, so the harness overrides that provider and pumps the widget:

```dart
    Widget harness({required bool hasNoGps}) => ProviderScope(
          overrides: [
            photosFilterSuggestionsProvider.overrideWith(
              (ref, filter) => Future.value(
                FilterSuggestionsResponseDto(
                  countries: const ['France'],
                  hasNoGpsAssets: hasNoGps,
                  hasNoPlaceNameAssets: hasNoGps,
                  // remaining required fields: copy the fixture the neighbouring tests build
                ),
              ),
            ),
          ],
          child: const MaterialApp(home: Scaffold(body: PlacesStrip())),
        );

    testWidgets('offers the no-location entries when the server allows them', (tester) async {
      await tester.pumpWidget(harness(hasNoGps: true));
      await tester.pumpAndSettle();

      expect(find.widgetWithText(FilterChip, 'filter_location_no_gps'.tr()), findsOneWidget);
      expect(find.widgetWithText(FilterChip, 'filter_location_no_place_name'.tr()), findsOneWidget);
    });

    testWidgets('hides them when the server says they would match nothing', (tester) async {
      await tester.pumpWidget(harness(hasNoGps: false));
      await tester.pumpAndSettle();

      expect(find.widgetWithText(FilterChip, 'filter_location_no_gps'.tr()), findsNothing);
    });
```

> Mobile widget tests in this repo have produced false greens before — rows that never render because a provider threw, and a bare `find.text` matching the search box instead of a row. That is why the matcher is `find.widgetWithText(FilterChip, …)` and not `find.text(…)`. **Run the pair before implementing and confirm the first fails while the second passes**; if both pass, the widget is not rendering at all and the test is worthless.
>
> Use the exact widget type each surface renders — `FilterChip` in the strip, whatever row widget the cascade and picker use. Copy the `FilterSuggestionsResponseDto` fixture from the neighbouring tests rather than hand-listing its required fields.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && flutter test test/providers/photos_filter`
Expected: FAIL — entries not found.

- [ ] **Step 3: Add the entries to all three surfaces**

Each surface renders the two entries ahead of the country list, gated on the flags from `filter_suggestions.provider.dart` (or an already-selected value), and selects by constructing a fresh filter — never `copyWith`:

```dart
ref.read(photosFilterProvider.notifier).setLocation(
  isSelected ? null : SearchLocationFilter(locationPresence: 'noGps'),
);
```

- [ ] **Step 4: Run the tests and analyzer**

Run: `cd mobile && flutter test test/providers/photos_filter test/models/search && dart analyze --fatal-infos`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation mobile/test
git commit -m "feat(mobile): offer no-location entries in the places surfaces"
```

---

### Task 12: End-to-end coverage

**Files:**

- Create: `e2e/src/ui/specs/timeline/no-location-filter.e2e-spec.ts`

**Interfaces:**

- Consumes: the whole stack.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test';

test.describe('no-location filter', () => {
  test('narrows the timeline to un-geotagged assets and survives a reload', async ({ page }) => {
    // Seed: one asset with GPS, one without. Reuse the login + upload helpers the
    // neighbouring timeline specs use (see e2e/src/ui/specs/timeline/utils.ts).
    await page.goto('/photos');
    await page.getByTestId('filter-toggle-button').click();
    await page.getByTestId('location-presence-noGps').click();

    await expect(page.getByTestId('asset-grid').getByRole('link')).toHaveCount(1);
    await expect(page.getByTestId('active-filters-bar')).toContainText('No location');
    await expect(page).toHaveURL(/locationPresence=noGps/);

    await page.reload();
    await expect(page.getByTestId('asset-grid').getByRole('link')).toHaveCount(1);
  });

  test('restores every asset when the location chip is removed', async ({ page }) => {
    await page.goto('/photos?locationPresence=noGps');
    await expect(page.getByTestId('asset-grid').getByRole('link')).toHaveCount(1);

    await page
      .getByTestId('active-filters-bar')
      .getByRole('button', { name: /No location/ })
      .click();

    await expect(page.getByTestId('asset-grid').getByRole('link')).toHaveCount(2);
  });
});
```

> Replace the seeding comment and any test id that does not match with the real ones from `e2e/src/ui/specs/timeline/utils.ts` and the neighbouring specs — do not invent selectors. The three assertions (count, chip, URL) are what must survive.

- [ ] **Step 2: Run it**

Run: `make e2e-web-dev`
Expected: PASS. This needs a running dev stack on :2283.

- [ ] **Step 3: Full verification sweep**

```bash
cd server && pnpm test:medium && cd ..
make lint-server && make check-server
cd web && pnpm test -- --run && pnpm check:typescript && pnpm check:svelte && cd ..
cd mobile && flutter test test/providers/photos_filter test/models/search && dart analyze --fatal-infos && cd ..
npx prettier --check i18n/*.json
```

- [ ] **Step 4: Commit**

```bash
git add e2e/src/ui/specs/timeline/no-location-filter.e2e-spec.ts
git commit -m "test(e2e): cover the no-location filter end to end"
```

---

## Notes for the executor

- **`dart analyze` is not a substitute for `flutter test`.** Generated-code compile errors only surface when a test actually compiles.
- **`make sql` must never run without a running database** — it deletes all query files.
- **Do not add an index** on `asset_exif.latitude` or `city`. The spec defers that pending `EXPLAIN ANALYZE` on a real library; a partial index on a low-selectivity predicate is unlikely to pay for itself.
- **The V3 branch filter** (`SearchFilterBranchSchema`, `database.ts:1225-1227`) is deliberately untouched — it is dormant and unwired (`database.ts:1269`).
- **`getTimeBucketCovers` needs no separate work.** All three timeline consumers share `withTimeBucketAssetFilters` (`asset.repository.ts:1323`, `:1372`, `:1429`), so Task 1 reaches it.

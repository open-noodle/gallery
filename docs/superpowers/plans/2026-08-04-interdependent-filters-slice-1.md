# Slice 1 — Server favourites and album-membership facets (#910)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** `getFilterSuggestions` and `getSmartSearchFacets` return `hasFavorites`, `hasAssetsInAlbum` and
`hasAssetsNotInAlbum`, each computed with its own filter excluded, so the clients can tell a structurally
useless Favourites or Albums section from a transiently empty one.

**Architecture:** Three `limit 1` probes reusing the existing faceted asset-id subquery. The browse path
drops them into the existing `Promise.all`. The smart-search path needs the album-membership predicate
moved out of the candidate temp table first, so it can be excluded per facet the way favourites already is.

**Tech Stack:** NestJS, Kysely, Vitest, testcontainers (medium tests).

- **Spec:** `docs/superpowers/specs/2026-08-04-interdependent-filter-sections-910-design.md` §5
- **Branch:** `fix/910-interdependent-filter-sections`
- **Depends on:** nothing
- **Scope:** two server source files, three server test files, one generated SQL file. No web, no mobile.

## Global Constraints

- Server imports use the `src/` path alias. Relative imports are a lint error.
- Prettier: 120-char lines, single quotes, trailing commas, semicolons. `eslint --max-warnings 0`.
- **Do not insert a `--` before `--run`.** Per `feedback_local_verify_command_traps` §1, this pnpm
  passes the literal `--` through and vitest then **drops the path filter and runs the whole suite** —
  verified, not theoretical. The `-t` name filter is unreliable the same way. Every command in this
  plan is `pnpm test:medium --run <path>`; keep it that way, and sanity-check the reported file count
  against what you asked for before believing a red or a green.
- **`make sql`, `make lint-server` and `make format-server` do not work.** `make sql` is a removed
  stub that prints "use mise sql" and exits 1; the `lint-server` / `format-server` targets do not
  exist in the `Makefile` at all (CLAUDE.md is stale — `feedback_local_verify_command_traps` §2).
  Use `mise sql` and `cd server && pnpm lint` / `pnpm format`.
- `mise sql` **requires a running database**. Without one it deletes every file in
  `server/src/queries/`. Start the dev stack (`mise dev`) or a Postgres container first. Use the bare
  `mise sql`, never `mise run //:sql` — from a worktree the `//:` prefix targets the **main** checkout
  (`reference_mise_run_from_worktree_wrong_dir`).
- Medium tests need the dev prerequisites from `reference_fresh_worktree_medium_test_prereqs`:
  `mise run plugins` (sdk + plugin-sdk + plugin-core) before `pnpm test:medium`.
- Do not touch `server/src/schema/` — no migration is involved.

## File Structure

| File                                                              | Responsibility                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `server/src/repositories/search.repository.ts`                    | the three probes, both call sites, `SmartFacetExclude` |
| `server/src/dtos/search.dto.ts`                                   | the three booleans on both response schemas            |
| `server/test/medium/specs/repositories/search.repository.spec.ts` | behavioural coverage against a real database           |
| `server/src/services/search.service.spec.ts`                      | fixture updates only                                   |
| `server/src/controllers/search.controller.spec.ts`                | fixture updates only                                   |
| `server/src/queries/search.repository.sql`                        | generated — never hand-edited                          |

**Interfaces produced** (slices 2 and 4 consume these exact names):

```ts
// FilterSuggestionsResult and SmartSearchFacetsResult both gain:
hasFavorites: boolean;
hasAssetsInAlbum: boolean;
hasAssetsNotInAlbum: boolean;
```

---

## Task 1: Browse-path favourites facet

**Files:**

- Modify: `server/src/repositories/search.repository.ts:297-305` (`FilterSuggestionsResult`), `:1254-1273`
  (`getFilterSuggestions`)
- Test: `server/test/medium/specs/repositories/search.repository.spec.ts` — inside the existing
  `describe('getFilterSuggestions', …)` block that starts at `:474`

- [ ] **Step 1: Write the failing tests**

Add to `describe('getFilterSuggestions', …)`. The `ctx.newUser()` / `ctx.newAsset()` / `ctx.newExif()`
helpers and the `setup()` factory are already defined at the top of the file — do not redefine them.

```ts
describe('hasFavorites (#910)', () => {
  it('is false when the scope has no favourite', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user.id });

    const result = await sut.getFilterSuggestions([user.id], {});

    expect(result.hasFavorites).toBe(false);
  });

  it('is true when the scope has a favourite', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user.id, isFavorite: true });

    const result = await sut.getFilterSuggestions([user.id], {});

    expect(result.hasFavorites).toBe(true);
  });

  it('ignores its own isFavorite filter', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user.id, isFavorite: true });
    await ctx.newAsset({ ownerId: user.id });

    // Filtering to non-favourites must not make the facet claim there are none.
    const result = await sut.getFilterSuggestions([user.id], { isFavorite: false });

    expect(result.hasFavorites).toBe(true);
  });

  it('honours the other active dimensions', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: favourite } = await ctx.newAsset({ ownerId: user.id, isFavorite: true });
    await ctx.newExif({ assetId: favourite.id, make: 'Canon' });
    const { asset: plain } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: plain.id, make: 'Nikon' });

    // The only favourite is a Canon, so a Nikon filter must report no favourites.
    const result = await sut.getFilterSuggestions([user.id], { make: 'Nikon' });

    expect(result.hasFavorites).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts -t 'hasFavorites'
```

Expected: FAIL — `expected undefined to be false`. `hasFavorites` is not on the result yet.

- [ ] **Step 3: Add the field to the result type**

In `search.repository.ts`, extend `FilterSuggestionsResult` (`:297`):

```ts
export interface FilterSuggestionsResult {
  countries: string[];
  cameraMakes: string[];
  tags: Array<{ id: string; value: string }>;
  people: FilterSuggestionPerson[];
  ratings: number[];
  mediaTypes: string[];
  hasUnnamedPeople: boolean;
  hasFavorites: boolean;
  hasAssetsInAlbum: boolean;
  hasAssetsNotInAlbum: boolean;
}
```

Add all three now even though only `hasFavorites` is populated in this task — Task 2 fills the other two,
and splitting the interface edit across tasks makes the file churn twice for no benefit.

- [ ] **Step 4: Write the probe**

Add next to `getFilteredMediaTypes` (`search.repository.ts:1737`), at the end of the class:

```ts
  /**
   * #910: presence probes for the Favourites / Albums sections. `limit 1` rather than an aggregate so
   * Postgres stops at the first matching row — the answer is "does one exist", not "how many".
   */
  private async getFilteredHasFavorites(userIds: string[], options: FilterSuggestionsOptions): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', this.buildFilteredAssetIds(userIds, options))
      .where('asset.isFavorite', '=', true)
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }
```

- [ ] **Step 5: Wire it into the fan-out**

In `getFilterSuggestions` (`:1254`):

```ts
  async getFilterSuggestions(userIds: string[], options: FilterSuggestionsOptions): Promise<FilterSuggestionsResult> {
    const [countries, cameraMakes, tags, peopleResult, ratings, mediaTypes, hasFavorites] = await Promise.all([
      this.getFilteredCountries(userIds, without(options, 'country', 'city')),
      this.getFilteredCameraMakes(userIds, without(options, 'make', 'model')),
      this.getFilteredTags(userIds, without(options, 'tagIds')),
      this.getFilteredPeople(userIds, without(options, 'personIds', 'identityIds')),
      this.getFilteredRatings(userIds, without(options, 'rating')),
      this.getFilteredMediaTypes(userIds, without(options, 'mediaType')),
      this.getFilteredHasFavorites(userIds, without(options, 'isFavorite')),
    ]);

    return {
      countries,
      cameraMakes,
      tags,
      people: peopleResult.people,
      ratings,
      mediaTypes,
      hasUnnamedPeople: peopleResult.hasUnnamedPeople,
      hasFavorites,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
    };
  }
```

The two `false` placeholders are replaced in Task 2. They are safe in the meantime because no client reads
them until slice 4.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts -t 'hasFavorites'
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/search.repository.ts server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "feat(server): add hasFavorites filter-suggestion facet (#910)"
```

---

## Task 2: Browse-path album-membership facet

**Files:**

- Modify: `server/src/repositories/search.repository.ts` — new probe, `getFilterSuggestions` fan-out
- Test: `server/test/medium/specs/repositories/search.repository.spec.ts`

**Interfaces:**

- Consumes: `FilterSuggestionsResult.hasAssetsInAlbum` / `.hasAssetsNotInAlbum` from Task 1.
- Produces: `getFilteredAlbumMembership(userIds, options)` →
  `Promise<{ hasAssetsInAlbum: boolean; hasAssetsNotInAlbum: boolean }>`

- [ ] **Step 1: Write the failing tests**

`ctx.newAlbum` and `ctx.newAlbumAsset` are the medium-factory helpers used elsewhere in this file (see
the `albumId` test at `:494`); confirm their exact signatures there before writing, and match them.

```ts
describe('album membership (#910)', () => {
  it('reports not-in-album only when the scope has no albums', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user.id });

    const result = await sut.getFilterSuggestions([user.id], {});

    expect(result.hasAssetsInAlbum).toBe(false);
    expect(result.hasAssetsNotInAlbum).toBe(true);
  });

  it('reports in-album only when every asset is filed', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const result = await sut.getFilterSuggestions([user.id], {});

    expect(result.hasAssetsInAlbum).toBe(true);
    expect(result.hasAssetsNotInAlbum).toBe(false);
  });

  it('reports both when the scope is mixed', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: filed } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAsset({ ownerId: user.id });
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: filed.id });

    const result = await sut.getFilterSuggestions([user.id], {});

    expect(result.hasAssetsInAlbum).toBe(true);
    expect(result.hasAssetsNotInAlbum).toBe(true);
  });

  it('ignores its own isNotInAlbum filter', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: filed } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAsset({ ownerId: user.id });
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: filed.id });

    // Filtering to un-filed assets must not erase the evidence that filed ones exist.
    const result = await sut.getFilterSuggestions([user.id], { isNotInAlbum: true });

    expect(result.hasAssetsInAlbum).toBe(true);
    expect(result.hasAssetsNotInAlbum).toBe(true);
  });

  it('reports every asset filed when scoped to one album', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAsset({ ownerId: user.id });
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const result = await sut.getFilterSuggestions([user.id], { albumId: album.id });

    expect(result.hasAssetsInAlbum).toBe(true);
    expect(result.hasAssetsNotInAlbum).toBe(false);
  });

  it('honours the other active dimensions', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: filed } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: filed.id, make: 'Canon' });
    const { asset: unfiled } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: unfiled.id, make: 'Nikon' });
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: filed.id });

    const result = await sut.getFilterSuggestions([user.id], { make: 'Nikon' });

    expect(result.hasAssetsInAlbum).toBe(false);
    expect(result.hasAssetsNotInAlbum).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts -t 'album membership'
```

Expected: FAIL — every `hasAssetsInAlbum` assertion gets `false` from Task 1's placeholder, so the
"reports in-album", "mixed", "ignores its own", and "scoped to one album" cases fail.

- [ ] **Step 3: Write the probe**

```ts
  private async getFilteredAlbumMembership(
    userIds: string[],
    options: FilterSuggestionsOptions,
  ): Promise<{ hasAssetsInAlbum: boolean; hasAssetsNotInAlbum: boolean }> {
    const probe = (filed: boolean) =>
      this.db
        .selectFrom('asset')
        .select('asset.id')
        .where('asset.id', 'in', this.buildFilteredAssetIds(userIds, options))
        .where((eb) => {
          const inAlbum = eb.exists(
            eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'),
          );
          return filed ? inAlbum : eb.not(inAlbum);
        })
        .limit(1)
        .executeTakeFirst();

    const [filed, unfiled] = await Promise.all([probe(true), probe(false)]);
    return { hasAssetsInAlbum: !!filed, hasAssetsNotInAlbum: !!unfiled };
  }
```

- [ ] **Step 4: Wire it into the fan-out**

Replace the two `false` placeholders from Task 1:

```ts
const [countries, cameraMakes, tags, peopleResult, ratings, mediaTypes, hasFavorites, albumMembership] =
  await Promise.all([
    this.getFilteredCountries(userIds, without(options, 'country', 'city')),
    this.getFilteredCameraMakes(userIds, without(options, 'make', 'model')),
    this.getFilteredTags(userIds, without(options, 'tagIds')),
    this.getFilteredPeople(userIds, without(options, 'personIds', 'identityIds')),
    this.getFilteredRatings(userIds, without(options, 'rating')),
    this.getFilteredMediaTypes(userIds, without(options, 'mediaType')),
    this.getFilteredHasFavorites(userIds, without(options, 'isFavorite')),
    this.getFilteredAlbumMembership(userIds, without(options, 'isInAlbum', 'isNotInAlbum')),
  ]);

return {
  countries,
  cameraMakes,
  tags,
  people: peopleResult.people,
  ratings,
  mediaTypes,
  hasUnnamedPeople: peopleResult.hasUnnamedPeople,
  hasFavorites,
  ...albumMembership,
};
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts -t 'album membership'
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/search.repository.ts server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "feat(server): add album-membership filter-suggestion facets (#910)"
```

---

## Task 3: Make favourites excludable on the smart-search path

**Files:**

- Modify: `server/src/repositories/search.repository.ts:187-188` (`SmartFacetExclude`), `:666`
- Test: `server/test/medium/specs/repositories/search.repository.spec.ts` — `describe('getSmartSearchFacets', …)`

This is a bug fix in its own right: every other dimension in `buildSmartFacetFilteredAssetIds` is guarded
by `exclude !== …`; `isFavorite` alone is applied unconditionally.

- [ ] **Step 1: Write the failing test**

Follow the existing `getSmartSearchFacets` tests for embedding setup — they use `addEmbedding(db, assetId)`
and pass `embedding: matchingEmbedding` in the options. Copy the option shape from the test at `:52`.

```ts
it('computes hasFavorites ignoring its own isFavorite filter (#910)', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset: favourite } = await ctx.newAsset({ ownerId: user.id, isFavorite: true });
  await addEmbedding(defaultDatabase, favourite.id);
  const { asset: plain } = await ctx.newAsset({ ownerId: user.id });
  await addEmbedding(defaultDatabase, plain.id);

  const result = await sut.getSmartSearchFacets({
    userIds: [user.id],
    embedding: matchingEmbedding,
    isFavorite: false,
  });

  expect(result.hasFavorites).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts -t 'hasFavorites ignoring'
```

Expected: FAIL — `hasFavorites` is not on `SmartSearchFacetsResult` yet.

- [ ] **Step 3: Widen the exclude union**

```ts
type SmartFacetExclude =
  | 'time'
  | 'people'
  | 'location'
  | 'city'
  | 'camera'
  | 'cameraModel'
  | 'tags'
  | 'rating'
  | 'media'
  | 'favorites'
  | 'albums';
```

- [ ] **Step 4: Guard the favourites predicate**

`search.repository.ts:666` becomes:

```ts
      .$if(exclude !== 'favorites' && options.isFavorite !== undefined, (qb) =>
        qb.where('asset.isFavorite', '=', options.isFavorite!),
      )
```

- [ ] **Step 5: Add the field and the probe**

Extend `SmartSearchFacetsResult` (`:191-203`) with the same three booleans as
`FilterSuggestionsResult`, then add next to `getSmartFacetMediaTypes` (`:904`):

```ts
  private async getSmartFacetHasFavorites(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<boolean> {
    const row = await trx
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'favorites'))
      .where('asset.isFavorite', '=', true)
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }
```

Then in `getSmartSearchFacets` (`:562`), after `mediaTypes`:

```ts
const hasFavorites = await this.getSmartFacetHasFavorites(trx, options);
```

and add `hasFavorites` plus `hasAssetsInAlbum: false, hasAssetsNotInAlbum: false` to the returned object.
Task 4 replaces the placeholders.

Keep the sequential `await` style — this method deliberately does not use `Promise.all`, because every
query runs inside one transaction against the same temp table.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts -t 'getSmartSearchFacets'
```

Expected: PASS — the new test plus every pre-existing `getSmartSearchFacets` test.

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/search.repository.ts server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "fix(server): exclude isFavorite from its own smart-search facet (#910)"
```

---

## Task 4: Move album membership out of the candidate table

**Files:**

- Modify: `server/src/repositories/search.repository.ts:594-617` (`buildSmartFacetCandidateQuery`),
  `:639-709` (`buildSmartFacetFilteredAssetIds`), `:562` (`getSmartSearchFacets`)
- Test: `server/test/medium/specs/repositories/search.repository.spec.ts`

`isNotInAlbum` / `isInAlbum` are currently applied by `searchAssetBuilderLegacy` while building the
`smart_search_facet_candidates` temp table (`database.ts:954-959`), so no facet can exclude them. They move
out, exactly as `isFavorite` already is.

- [ ] **Step 1: Write the failing tests**

The second test is not optional. Deleting the album predicate outright would make the first test pass, so
the pair is what actually pins the behaviour.

```ts
it('computes album membership ignoring its own isNotInAlbum filter (#910)', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset: filed } = await ctx.newAsset({ ownerId: user.id });
  await addEmbedding(defaultDatabase, filed.id);
  const { asset: unfiled } = await ctx.newAsset({ ownerId: user.id });
  await addEmbedding(defaultDatabase, unfiled.id);
  const { album } = await ctx.newAlbum({ ownerId: user.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: filed.id });

  const result = await sut.getSmartSearchFacets({
    userIds: [user.id],
    embedding: matchingEmbedding,
    isNotInAlbum: true,
  });

  expect(result.hasAssetsInAlbum).toBe(true);
  expect(result.hasAssetsNotInAlbum).toBe(true);
});

it('still applies isNotInAlbum to the non-album facets (#910)', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset: filed } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newExif({ assetId: filed.id, make: 'Canon' });
  await addEmbedding(defaultDatabase, filed.id);
  const { asset: unfiled } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newExif({ assetId: unfiled.id, make: 'Nikon' });
  await addEmbedding(defaultDatabase, unfiled.id);
  const { album } = await ctx.newAlbum({ ownerId: user.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: filed.id });

  const result = await sut.getSmartSearchFacets({
    userIds: [user.id],
    embedding: matchingEmbedding,
    isNotInAlbum: true,
  });

  // Only the un-filed Nikon survives the filter, so Canon must be gone from the makes facet.
  expect(result.cameraMakes).toEqual(['Nikon']);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts -t 'isNotInAlbum'
```

Expected: FAIL — the first on `hasAssetsInAlbum` being the `false` placeholder from Task 3. The second
passes already; it is the guard that must stay green through this task.

- [ ] **Step 3: Take album membership out of the candidate query**

In `buildSmartFacetCandidateQuery` (`:597`), add the two keys to the `without(...)` list:

```ts
return searchAssetBuilderLegacy(kysely, {
  ...without(
    options,
    'city',
    'country',
    'make',
    'model',
    'rating',
    'type',
    'isFavorite',
    'isInAlbum',
    'isNotInAlbum',
    'takenAfter',
    'takenBefore',
    'personIds',
    'personMatchAny',
    'identityIds',
    'forceEmptyResult',
    'spacePersonIds',
    'tagIds',
    'tagMatchAny',
  ),
  ratingIsMinimum: true,
});
```

- [ ] **Step 4: Re-apply it per facet**

In `buildSmartFacetFilteredAssetIds`, directly after the favourites guard from Task 3:

```ts
      .$if(exclude !== 'albums' && !!options.isNotInAlbum, (qb) =>
        qb.where((eb) =>
          eb.not(eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
        ),
      )
      .$if(exclude !== 'albums' && !!options.isInAlbum, (qb) =>
        qb.where((eb) =>
          eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id')),
        ),
      )
```

`database.ts:954` guards these with `!options.albumIds?.length`; that guard is not needed here because
`getSmartSearchFacets` is never called with `albumIds` — verify with
`grep -n "getSmartSearchFacets" -A 15 server/src/services/search.service.ts` before implementing, and if
`albumIds` is ever passed, add the same guard.

- [ ] **Step 5: Add the probe and replace the placeholders**

```ts
  private async getSmartFacetAlbumMembership(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<{ hasAssetsInAlbum: boolean; hasAssetsNotInAlbum: boolean }> {
    const probe = (filed: boolean) =>
      trx
        .selectFrom('asset')
        .select('asset.id')
        .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'albums'))
        .where((eb) => {
          const inAlbum = eb.exists(
            eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'),
          );
          return filed ? inAlbum : eb.not(inAlbum);
        })
        .limit(1)
        .executeTakeFirst();

    const [filed, unfiled] = await Promise.all([probe(true), probe(false)]);
    return { hasAssetsInAlbum: !!filed, hasAssetsNotInAlbum: !!unfiled };
  }
```

In `getSmartSearchFacets`, replace the placeholders with
`const albumMembership = await this.getSmartFacetAlbumMembership(trx, options);` and spread it into the
return object.

- [ ] **Step 6: Run the full repository suite**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts
```

Expected: PASS. Pay attention to the pre-existing `getSmartSearchFacets` tests — moving a predicate out of
the candidate table changes which rows every other facet sees, so a regression here is the signal that the
move was done wrong.

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/search.repository.ts server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "feat(server): add album-membership smart-search facets (#910)"
```

---

## Task 5: Degenerate-input and scope coverage

**Files:**

- Test only: `server/test/medium/specs/repositories/search.repository.spec.ts`

Spec §4.6 and the last two rows of §8.1. No source change is expected in this task — if any test here
fails, stop and report rather than "fixing" it, because it means the client-side reasoning in the spec
is wrong.

- [ ] **Step 1: Write the `forceEmptyResult` test**

```ts
it('reports every #910 facet false under forceEmptyResult', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  await ctx.newAsset({ ownerId: user.id, isFavorite: true });

  const result = await sut.getFilterSuggestions([user.id], { forceEmptyResult: true });

  expect(result.hasFavorites).toBe(false);
  expect(result.hasAssetsInAlbum).toBe(false);
  expect(result.hasAssetsNotInAlbum).toBe(false);
});
```

- [ ] **Step 2: Write the `withSharedSpaces` scope test**

Spec §8.1's last row, and the one that pins §4.6's third degenerate input. The whole client-side
argument that a scope mismatch "can only grey, never wrongly hide" rests on the baseline seeing a
**wider** set than the favourites-filtered current — this is what proves the server side of that.

Copy the space fixture shape from the existing test at `:382` (`newSharedSpace` /
`newSharedSpaceMember` / `newSharedSpaceAsset`); `SharedSpaceRepository` is already in `setup()`'s
`real` list.

```ts
it('sees a shared-space favourite only with timelineSpaceIds (#910)', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: owner.id, isFavorite: true });

  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

  // The member owns nothing. Without the space in scope the favourite is invisible to them...
  const ownScope = await sut.getFilterSuggestions([member.id], {});
  expect(ownScope.hasFavorites).toBe(false);

  // ...and with it, it is. The two scopes disagree, which is exactly what §4.6 documents:
  // the photos page drops withSharedSpaces when isFavorite is set, so `current` is narrower
  // than `baseline`. Subset, so it can only grey — never wrongly hide.
  const spaceScope = await sut.getFilterSuggestions([member.id], { timelineSpaceIds: [space.id] });
  expect(spaceScope.hasFavorites).toBe(true);
});
```

- [ ] **Step 3: Write the smart-path verdict tests**

§8.1's "smart-search path, each of the above" row. Tasks 3 and 4 only covered the two _exclusion_
cases; the ordinary verdicts on the smart path are still unpinned, and they run through a completely
different query builder (`buildSmartFacetFilteredAssetIds` over the temp table, not
`buildFilteredAssetIds`). Mirror Task 1's and Task 2's cases with `addEmbedding` + `matchingEmbedding`:

```ts
it('reports no favourites and mixed album membership on the smart path (#910)', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset: filed } = await ctx.newAsset({ ownerId: user.id });
  await addEmbedding(defaultDatabase, filed.id);
  const { asset: unfiled } = await ctx.newAsset({ ownerId: user.id });
  await addEmbedding(defaultDatabase, unfiled.id);
  const { album } = await ctx.newAlbum({ ownerId: user.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: filed.id });

  const result = await sut.getSmartSearchFacets({ userIds: [user.id], embedding: matchingEmbedding });

  expect(result.hasFavorites).toBe(false);
  expect(result.hasAssetsInAlbum).toBe(true);
  expect(result.hasAssetsNotInAlbum).toBe(true);
});
```

Add the two single-sided album cases (everything filed → `hasAssetsNotInAlbum` false; nothing filed →
`hasAssetsInAlbum` false) the same way, plus one favourite present → `hasFavorites` true.

- [ ] **Step 4: Run and confirm they pass without source changes**

```bash
cd server && pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts
```

Expected: PASS. `buildFilteredAssetIds` already honours `forceEmptyResult` at `:1402`, so the probes
inherit it; the space scoping is `applySuggestionScope`'s existing behaviour; and Tasks 3–4 already
built the smart-path probes.

- [ ] **Step 5: Commit**

```bash
git add server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "test(server): lock degenerate-input and scope behaviour for the #910 facets"
```

---

## Task 6: DTOs, fixtures and generated SQL

**Files:**

- Modify: `server/src/dtos/search.dto.ts:248-276`
- Modify: `server/src/repositories/search.repository.ts:1245-1252` (`sortQueries`)
- Modify: `server/src/services/search.service.spec.ts`, `server/src/controllers/search.controller.spec.ts`
- Regenerate: `server/src/queries/search.repository.sql`

- [ ] **Step 1: Extend both response schemas**

```ts
const FilterSuggestionsResponseSchema = z
  .object({
    countries: z.array(z.string()).describe('Available countries'),
    cameraMakes: z.array(z.string()).describe('Available camera makes'),
    tags: z.array(FilterSuggestionsTagSchema).describe('Available tags'),
    people: z.array(FilterSuggestionsPersonSchema).describe('Available people (named, non-hidden, with thumbnails)'),
    ratings: z.array(z.number()).describe('Available ratings'),
    mediaTypes: z.array(z.string()).describe('Available media types'),
    hasUnnamedPeople: z.boolean().describe('Whether unnamed people exist in the filtered set'),
    hasFavorites: z.boolean().describe('Whether any favourite exists in the filtered set, ignoring isFavorite'),
    hasAssetsInAlbum: z.boolean().describe('Whether any filtered asset belongs to an album'),
    hasAssetsNotInAlbum: z.boolean().describe('Whether any filtered asset belongs to no album'),
  })
  .meta({ id: 'FilterSuggestionsResponseDto' });
```

Add the same three lines to `SmartSearchFacetsResponseSchema` (`:260`), after `hasUnnamedPeople`.

- [ ] **Step 2: Update the SQL-generation hints**

`sortQueries` at `:1245` lists the leading fragment of each generated query so `mise sql` orders them
deterministically. **This step is a loop, not a line:** run Step 4 first, read the new fragments out of
the generated file, come back here and add them, then run Step 4 again. Do not guess the strings.

The three probes add six queries total, not three — three per `@GenerateSql` call site. Each of
`getFilterSuggestions` and `getSmartSearchFacets` gains one favourites query plus two
album-membership probes (`getFilteredAlbumMembership` / `getSmartFacetAlbumMembership` each issue
two, one per `filed`/`unfiled` branch).

- [ ] **Step 3: Update unit-test fixtures**

**Do not work from a hand-written list — let `tsc` enumerate them.** An earlier draft of this plan
named four sites in `search.service.spec.ts`; there are eleven `hasUnnamedPeople` literals in that file
alone (`:30, 1220, 1868, 1882, 1886, 1915, 1968, 2068, 2101, 2126, 2151`) plus four in
`search.controller.spec.ts` (`:177, 476, 491, 545`). Only the ones typed as `FilterSuggestionsResult` /
`SmartSearchFacetsResult` need the fields, and the compiler knows which:

```bash
cd server && pnpm check 2>&1 | grep -E "hasFavorites|hasAssetsInAlbum|hasAssetsNotInAlbum"
```

Add `hasFavorites: false, hasAssetsInAlbum: false, hasAssetsNotInAlbum: false` to each site it names,
except where the surrounding test is about a populated library — there, match the neighbouring
`ratings` / `mediaTypes` values.

```bash
cd server && pnpm test --run src/services/search.service.spec.ts src/controllers/search.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Regenerate the SQL**

Start a database first — `mise dev` in another terminal, or any Postgres the server config points at.
**`mise sql` against no database deletes every file in `server/src/queries/`.** It also runs out of
`dist/`, so the server must be built first.

```bash
cd server && pnpm build
mise sql
git diff --stat server/src/queries/
```

Expected: `search.repository.sql` changed, nothing deleted. If the diff shows deletions,
`git checkout -- server/src/queries/` and start a database.

- [ ] **Step 5: Full server gate**

`make lint-server` and `make format-server` do not exist — they are not stubs, there is simply no such
target (`feedback_local_verify_command_traps` §2).

```bash
cd server && pnpm test --run && pnpm check && pnpm lint && pnpm format
```

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat(server): expose favourites and album-membership facets in the search DTOs (#910)"
```

---

## Done when

- `pnpm test:medium --run test/medium/specs/repositories/search.repository.spec.ts` is green, including
  every pre-existing test — and the reported file count is 1, not the whole suite (Global Constraints).
- `pnpm test --run`, `pnpm check`, `pnpm lint`, `pnpm format` are green from `server/`.
- `server/src/queries/search.repository.sql` contains the six new probe queries — three per
  `@GenerateSql` call site, since album membership issues two — and nothing was deleted.
- Every row of spec §8.1 has a test. The two easiest to skip are `withSharedSpaces` and the
  smart-path verdicts — both are Task 5.
- No web, mobile, or `open-api/` file is touched — those are slices 2 and 4.

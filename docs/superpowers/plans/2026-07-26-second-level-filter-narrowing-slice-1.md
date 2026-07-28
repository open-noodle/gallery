# Slice 1 — `getCameraModels` honours the full active-filter set (#858)

- **Spec:** `docs/superpowers/specs/2026-07-26-second-level-filter-narrowing-858-design.md` § "Slice 1"
- **Branch:** `fix/858-second-level-filter-narrowing`
- **Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/fix-858-filter-narrowing`
- **Scope:** server repository + its tests only. No web changes, no DTO changes, no other suggestion types.

## Outcome

`GET /search/suggestions?type=camera-model&make=Canon&tagIds=…` returns only the Canon models present on the
tagged assets, instead of every Canon model in the library. Same for every other filter dimension the DTO
already forwards.

## Out of scope (do NOT touch in this slice)

- `getCameraMakes`, `getCameraLensModels`, `getCountries`, `getStates` → Slice 2.
- Deleting `getExifField` → Slice 2. It must still compile and still be used by the other four methods.
- `SearchSuggestionRequestDto` (`city` / `mediaType` fields) → Slice 3.
- Anything under `web/` or `mobile/` → Slice 4 / non-goal.

---

## Step 0 — Preconditions

Already done in this worktree; verify only:

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/fix-858-filter-narrowing
ls node_modules >/dev/null && ls open-api/typescript-sdk/build >/dev/null && echo OK
docker info >/dev/null 2>&1 && echo "docker OK"   # medium tests need it
```

If `pnpm exec vitest` dies at collection with a module-resolution error, run `mise run plugins` from the repo
root and retry — the SDK / plugin-sdk / plugin-core builds are prerequisites.

---

## Step 1 (RED) — Medium repository tests

**File:** `server/test/medium/specs/repositories/search.repository.spec.ts`

Add a new top-level `describe('getCameraModels (#858)', …)` block **after** the existing
`describe('getCameraMakes (LOW #7)', …)` block (i.e. before `describe('getAccessibleTags (LOW #7)')`).

### Imports to add at the top of the file

The file already imports `AlbumUserRole, AssetType, AssetVisibility` from `src/enum`, `TagRepository`,
`upsertTags`, `newMediumService`, `getKyselyDB`. Nothing new is required except confirming `AssetType` is in
the `src/enum` import list (it is, line 2).

### Shared fixture helper

Put this helper immediately inside the new `describe`, above the tests:

```ts
/**
 * Two Canon bodies on one owner: an R5 image and a 7D image. Every #858 test narrows some
 * dimension so that only the R5 asset survives, then asserts the 7D model disappeared.
 */
const newCanonPair = async (ctx: Awaited<ReturnType<typeof setup>>['ctx'], userId: string) => {
  const { asset: r5 } = await ctx.newAsset({ ownerId: userId });
  await ctx.newExif({ assetId: r5.id, make: 'Canon', model: 'Canon EOS R5' });

  const { asset: sevenD } = await ctx.newAsset({ ownerId: userId });
  await ctx.newExif({ assetId: sevenD.id, make: 'Canon', model: 'Canon EOS 7D' });

  return { r5, sevenD };
};
```

Each test calls `const { ctx, sut } = setup();` then `const { user } = await ctx.newUser();` — matching the
existing blocks in this file. Do **not** hoist a shared `beforeEach` fixture: the existing suite creates
per-test users so tests stay independent.

### The 19 tests

Every test asserts against `sut.getCameraModels([user.id], <options>)`.

| #    | `it(...)` title                                                                  | Fixture delta                                                                                                                              | Options                                                               | Expect                                                 |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------ |
| 1.1  | `narrows models by an active tag filter`                                         | `upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nature'] })`, `ctx.newTagAsset({ tagIds: [nature.id], assetIds: [r5.id] })` | `{ make: 'Canon', tagIds: [nature.id] }`                              | `['Canon EOS R5']`                                     |
| 1.2  | `narrows models by an active person filter`                                      | `ctx.newPerson({ ownerId: user.id, name: 'Ada' })` + `ctx.newAssetFace({ assetId: r5.id, personId: person.id })`                           | `{ make: 'Canon', personIds: [person.id] }`                           | `['Canon EOS R5']`                                     |
| 1.3  | `narrows models by rating, treating rating as a minimum`                         | exif `rating: 5` on R5, `rating: 3` on 7D                                                                                                  | `{ make: 'Canon', rating: 4 }`                                        | `['Canon EOS R5']`                                     |
| 1.4  | `narrows models by media type`                                                   | 7D asset created with `type: AssetType.Video`                                                                                              | `{ make: 'Canon', mediaType: AssetType.Image }`                       | `['Canon EOS R5']`                                     |
| 1.5  | `narrows models by the favourite filter`                                         | R5 asset created with `isFavorite: true`                                                                                                   | `{ make: 'Canon', isFavorite: true }`                                 | `['Canon EOS R5']`                                     |
| 1.6  | `narrows models by an active location filter`                                    | exif `country: 'Germany'` on R5, `country: 'France'` on 7D                                                                                 | `{ make: 'Canon', country: 'Germany' }`                               | `['Canon EOS R5']`                                     |
| 1.7  | `narrows models by the active date range`                                        | `fileCreatedAt`/`localDateTime` `2024-01-15` (R5) and `2023-01-15` (7D)                                                                    | `{ make: 'Canon', takenAfter: new Date('2024-01-01T00:00:00.000Z') }` | `['Canon EOS R5']`                                     |
| 1.8  | `narrows models by the not-in-album filter`                                      | `ctx.newAlbum({ ownerId: user.id }, [sevenD.id])`                                                                                          | `{ make: 'Canon', isNotInAlbum: true }`                               | `['Canon EOS R5']`                                     |
| 1.9  | `still narrows by the parent make`                                               | extra asset, exif `make: 'Nikon', model: 'Nikon Z8'`                                                                                       | `{ make: 'Canon' }`                                                   | `['Canon EOS 7D', 'Canon EOS R5']` (no `Nikon Z8`)     |
| 1.10 | `still narrows by lens model`                                                    | exif adds `lensModel: 'RF 24-70'` (R5) / `'EF 50'` (7D)                                                                                    | `{ make: 'Canon', lensModel: 'RF 24-70' }`                            | `['Canon EOS R5']`                                     |
| 1.11 | `does not self-narrow when a model is already selected`                          | plain pair                                                                                                                                 | `{ make: 'Canon', model: 'Canon EOS R5' }`                            | `['Canon EOS 7D', 'Canon EOS R5']`                     |
| 1.12 | `returns nothing when forceEmptyResult is set`                                   | plain pair                                                                                                                                 | `{ make: 'Canon', forceEmptyResult: true }`                           | `[]`                                                   |
| 1.13 | `narrows models by an active face-identity filter`                               | see the identity snippet below                                                                                                             | `{ make: 'Canon', identityIds: [identity.id] }`                       | `['Canon EOS R5']`                                     |
| 1.14 | `includes archived-only models under not-locked and excludes locked-only models` | R5 `visibility: Archive`, 7D default, third asset `visibility: Locked` with model `Canon EOS 90D`                                          | `{ make: 'Canon', visibility: 'not-locked' }`                         | `['Canon EOS 7D', 'Canon EOS R5']`, no `Canon EOS 90D` |
| 1.15 | `lets an elevated caller (visibility undefined) see locked-only models`          | locked asset with model `Canon EOS 90D`                                                                                                    | `{ make: 'Canon' }`                                                   | contains `'Canon EOS 90D'`                             |
| 1.16 | `never returns another user's models`                                            | second user owns an asset with model `Canon EOS 90D`                                                                                       | `{ make: 'Canon' }` for `[user.id]`                                   | does **not** contain `'Canon EOS 90D'`                 |
| 1.17 | `excludes trashed assets`                                                        | 7D asset created with `deletedAt: new Date()`                                                                                              | `{ make: 'Canon' }`                                                   | `['Canon EOS R5']`                                     |
| 1.18 | `returns distinct values sorted ascending`                                       | third asset also `model: 'Canon EOS R5'`                                                                                                   | `{ make: 'Canon' }`                                                   | exactly `['Canon EOS 7D', 'Canon EOS R5']`             |
| 1.19 | `returns an empty list when the filter set matches nothing, without throwing`    | tag `unused` created but applied to no asset                                                                                               | `{ make: 'Canon', tagIds: [unused.id] }`                              | `[]`                                                   |

Identity snippet for 1.13 (there is no `ctx.newFaceIdentity` helper — copy
`server/test/medium/specs/repositories/face-backfill-contributions.medium.spec.ts:36-44`):

```ts
const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ada' });
const { assetFace } = await ctx.newAssetFace({ assetId: r5.id, personId: person.id });
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

Notes the implementer must respect:

- Use `toEqual` for exact lists (1.1–1.8, 1.10–1.12, 1.17–1.19) so a stray extra value fails the test.
  Use `not.toContain` / `toContain` only where the table says so (1.9, 1.15, 1.16).
- `'Canon EOS 7D' < 'Canon EOS R5'` in the default collation, so the ascending order in 1.9, 1.11, 1.14 and
  1.18 is real and observable.
- 1.14/1.15 mirror the existing `getCameraMakes (LOW #7)` test — keep the same shape and wording so the two
  read as siblings.
- `ctx.newAsset` takes `Partial<Insertable<AssetTable>>`, so `type`, `isFavorite`, `visibility`,
  `fileCreatedAt`, `localDateTime` and `deletedAt` are all settable directly.

### Run it — expect RED

```bash
cd server
pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/search.repository.spec.ts
```

**Expected red:** 1.1–1.8, 1.10, 1.12, 1.13, 1.17 and 1.19 fail. The characteristic failure is the unfiltered
list coming back, e.g.

```
AssertionError: expected [ 'Canon EOS 7D', 'Canon EOS R5' ] to deeply equal [ 'Canon EOS R5' ]
```

1.9, 1.11, 1.14, 1.15, 1.16, 1.18 are expected to pass already — they cover behaviour the current
implementation has and the change must preserve. Record which tests were red vs already-green in the TDD
evidence; do not "fix" an already-green test to make it red.

> If 1.17 passes before the change, that is fine — `getExifField` already filters `deletedAt`. Note it as
> pre-existing-green rather than forcing it red.

---

## Step 2 (RED) — Service unit test

**File:** `server/src/services/search.service.spec.ts`

Insert directly after the existing `it('should return search suggestions for camera model (including null)', …)`:

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

`newUuid` is already imported from `test/small.factory` (line 12); `SearchSuggestionType` from
`src/dtos/search.dto` (line 3); `authStub` from `test/fixtures/auth.stub` (line 9).

```bash
cd server
pnpm exec vitest run --config test/vitest.config.mjs src/services/search.service.spec.ts
```

**Expected:** this test **passes immediately**. The service already forwards the whole DTO — the drop happens
in the repository, which is mocked here. That is the point of the test: it pins the forwarding contract so a
later refactor cannot silently stop passing the filters. Record it as "green on add — contract pin, not a red
test" in the TDD evidence rather than contriving a failure.

---

## Step 3 (RED) — e2e acceptance

**File:** `e2e/src/specs/server/api/filter-suggestions.e2e-spec.ts`

The existing `describe('/search/suggestions/filters')` owns the `beforeAll` fixture. Add the new tests
**inside that same `describe`**, as a nested `describe('drill-down suggestions (#858)')` placed just before
the closing `});` of the outer describe — this reuses `admin`, `assets`, `tagNatureId` and `tagTravelId`
without duplicating the 60-second upload fixture.

```ts
describe('drill-down suggestions (#858)', () => {
  it('narrows camera models by an active tag filter', async () => {
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

  it('narrows camera models by an active rating filter', async () => {
    // assets[0] (Canon EOS R5) is rated 5; assets[1] (Canon EOS 7D) is rated 4.
    const { body } = await request(app)
      .get('/search/suggestions?type=camera-model&make=Canon&rating=5&withSharedSpaces=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body).toEqual(['Canon EOS R5']);
  });

  it('keeps every camera model when only the make is selected', async () => {
    const { body } = await request(app)
      .get('/search/suggestions?type=camera-model&make=Canon&withSharedSpaces=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body).toEqual(expect.arrayContaining(['Canon EOS R5', 'Canon EOS 7D']));
  });
});
```

**Expected red (before the fix):** the first two fail with both Canon models returned; the third passes.

**Fixture facts already established in this file** — do not re-derive them:

- `assets[0]` = `/albums/nature/prairie_falcon.jpg` → make `Canon`, model `Canon EOS R5`, rating 5, tag
  `nature`.
- `assets[1]` = `/formats/webp/denali.webp` → make `Canon`, model `Canon EOS 7D`, rating 4, tag `travel`.
- `Canon` / `Canon EOS 7D` are asserted verbatim in `e2e/src/specs/server/api/search.e2e-spec.ts:332,342`.

If the e2e stack is not running locally, do not block the slice on it — run the two server suites, note the
e2e as "written, deferred to CI", and let CI execute it. Do **not** weaken the assertions to make a local run
pass. Note that the e2e stack (`immich-e2e` project) is machine-wide shared; do not tear down a stack another
session may be using.

---

## Step 4 (GREEN) — Implementation

**File:** `server/src/repositories/search.repository.ts`

### 4a. Widen the options interface

Replace:

```ts
export interface GetCameraModelsOptions extends ExifSuggestionScopeOptions {
  make?: string;
  lensModel?: string;
}
```

with:

```ts
export interface GetCameraModelsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {
  lensModel?: string;
}
```

`make` and `model` now come from `FilterSuggestionFilterOptions`, which also brings `personIds`,
`identityIds`, `forceEmptyResult`, `country`, `city`, `tagIds`, `rating`, `mediaType`, `isFavorite`,
`isNotInAlbum`, `isInAlbum`.

### 4b. Reroute the method

Replace the body of `getCameraModels`:

```ts
@GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
async getCameraModels(userIds: string[], options: GetCameraModelsOptions): Promise<string[]> {
  // #858: every other active filter must narrow the model list, exactly like getCities. Only the
  // model itself is excluded — a selected model must not collapse its own list to one row.
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

Key points:

- The old outer `.$if(!!options.make, …)` is **removed** — `buildFilteredAssetIds` applies `make` now.
- `lensModel` stays on the outer select: it is not a member of `FilterSuggestionFilterOptions`.
- `without(options, 'model')` sets the key to `undefined`, so `buildFilteredAssetIds`' `!!options.model`
  guard is false — no self-narrowing.
- Passing `GetCameraModelsOptions` (extra `lensModel` key) where `FilterSuggestionsOptions` is expected is
  fine: excess-property checks only apply to fresh object literals. `getCities` already does exactly this
  with its extra `state`.
- `getExifField` must remain in the file and keep its other four callers — Slice 2 removes it.

### Run — expect GREEN

```bash
cd server
pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/search.repository.spec.ts
pnpm exec vitest run --config test/vitest.config.mjs src/services/search.service.spec.ts
pnpm check
```

All 19 new medium tests pass, the pre-existing `getFilterSuggestions` / `getSmartSearchFacets` /
`getCameraMakes (LOW #7)` / `getAccessibleTags (LOW #7)` blocks stay green, and `pnpm check` is clean.

---

## Step 5 — Regenerate the SQL docs

`getCameraModels` carries `@GenerateSql`, and CI has a `sql-schema-up-to-date` job that runs `mise //:sql`
and fails on a diff.

**`mise sql` deletes every file in `server/src/queries/` and rewrites them from a live database. Never run it
without a database up.**

```bash
# from the repo root, with the dev DB running
mise run dev            # or an already-running stack — see the caution below
mise sql
git diff --stat server/src/queries/
```

Caution: `mise dev` is a machine-wide singleton — another session's dev stack shares the same database and
containers. If a dev stack is already running, use it rather than starting a second one. After regenerating,
`git diff server/src/queries/search.repository.sql` must show **only** the `SearchRepository.getCameraModels`
block changing (from the `distinct on ("model") … inner join "asset"` shape to a
`select distinct "model" … where "assetId" in (select "asset"."id" …)` shape). If any other query block
changed, the DB was in a different state — revert and investigate before committing.

If no database is available, stop and report it rather than hand-editing the file: a hand-written approximation
that does not match the generator's output will fail CI just the same.

---

## Step 6 — Validate and commit

```bash
cd server && pnpm lint && pnpm format && pnpm check
cd ../e2e && pnpm exec eslint src/specs/server/api/filter-suggestions.e2e-spec.ts --max-warnings 0
```

Commit everything in one commit:

```
fix(search): narrow camera-model suggestions by the active filter set (#858)

Camera-model suggestions were built on getExifField, which applies only owner/album/space
scope, visibility, trash, album membership and the date range — it never read tagIds,
personIds, identityIds, rating, isFavorite, mediaType, country/city or forceEmptyResult.
Selecting a make therefore listed every model in the library regardless of the other
active filters.

Route getCameraModels through buildFilteredAssetIds (the faceted subquery getCities has
used since #436), excluding only `model` so a selected model does not collapse its own
list.
```

No `Co-Authored-By` or `Generated with` trailers.

---

## Definition of done

- [ ] 19 new medium tests in `search.repository.spec.ts`, all green; red/green evidence recorded per test
- [ ] Service forwarding test added and green
- [ ] 3 e2e tests added (executed locally if the stack is up, otherwise deferred to CI with a note)
- [ ] `getCameraModels` rerouted; `getExifField` still present with its four other callers
- [ ] `server/src/queries/search.repository.sql` regenerated, diff limited to the `getCameraModels` block
- [ ] `cd server && pnpm check && pnpm lint && pnpm format` clean
- [ ] One commit, message as above
- [ ] Branch pushed with `git push -u origin fix/858-second-level-filter-narrowing`

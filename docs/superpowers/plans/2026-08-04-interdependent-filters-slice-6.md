# Slice 6 — e2e seed data and coverage (#910)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** The Playwright suites stop assuming every filter section is always rendered, and gain direct
coverage for the new hide behaviour.

**Architecture:** Seed data changes, not test-logic changes. Suites that click a control inside a section
must seed enough variety for that section to be available; the feature itself is not weakened to suit them.

**Tech Stack:** Playwright, Vitest (e2e runner), the fork's `utils` seeding helpers.

- **Spec:** `docs/superpowers/specs/2026-08-04-interdependent-filter-sections-910-design.md` §8.4
- **Branch:** `fix/910-interdependent-filter-sections`
- **Depends on:** Slice 5. Nothing is gated before it, so these tests cannot fail first without it.
- **Scope:** `e2e/src/specs/web/`. No app source.

## Global Constraints

- Per `feedback_e2e_stack_port_2285_vs_dev_2283`, `make e2e` serves on **2285**; a `make dev` stack is 2283.
  Run the web suites with `make e2e-web-dev` against a running dev stack, or the full `make e2e` stack.
- Per `reference_e2e_web_playwright_2283_empty_body`, `make e2e-web-dev` on port 2283 can serve zero-byte
  bodies. If every test fails on an empty page, that is the environment, not the change.
- Per `feedback_no_flake_allowance`, never mark a failure as flaky and retry. Diagnose it.
- Per `feedback_e2e_waitforqueuefinish_false_done`, `waitForQueueFinish` returns "done" while the queue is
  merely momentarily empty. Rating and EXIF assertions must poll rather than trust it.

- **Five suites are affected, not two.** An earlier draft of this plan named only the photos and spaces
  suites and mis-stated their failures as one assertion each. The real list, from
  `grep -rln "filter-section-\|media-type-\|rating-star-\|section-toggle-" e2e/src`, is in Task 0.

## File Structure

| File                                                       | Responsibility                                          |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts`        | seed variety incl. a face for People; new hide coverage |
| `e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts`        | seed variety incl. a space-scoped person for People     |
| `e2e/src/specs/web/recently-added-filters.e2e-spec.ts`     | seed variety incl. a face for People                    |
| `e2e/src/specs/web/map-filter-panel.e2e-spec.ts`           | seeds **nothing** today — needs a fixture               |
| `e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts` | one unconditional wait becomes conditional              |

### The seeding recipes

Verified against `e2e/test-assets` and `e2e/src/utils.ts`. Every section, People included, can be seeded.

| Section   | Seed                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| media     | `utils.createAsset(token, { assetData: { filename: 'x.mp4' } })` — random bytes, typed from the extension (`recently-added-filters.e2e-spec.ts:102-110`)                                                                                          |
| rating    | `updateAsset({ id, updateAssetDto: { rating: 5 } }, { headers: asBearerAuth(token) })`                                                                                                                                                            |
| favorites | `updateAsset({ id, updateAssetDto: { isFavorite: true } }, …)`                                                                                                                                                                                    |
| albums    | an album containing **some but not all** seeded assets — both booleans must be true                                                                                                                                                               |
| location  | upload `${testAssetDir}/metadata/gps-position/thompson-springs.jpg`, then `await utils.waitForQueueFinish(token, 'metadataExtraction')`                                                                                                           |
| camera    | upload `${testAssetDir}/metadata/rating/mongolels.jpg` (EXIF `Make: Canon`). **`thompson-springs.jpg` has GPS but no `Make`** — confirmed with exiftool, so it does not cover Camera                                                              |
| tags      | `const [tag] = await utils.upsertTags(token, ['e2e-tag']); await utils.tagAssets(token, tag.id, [assetId]);`                                                                                                                                      |
| people    | global scope: `const person = await utils.createPerson(token, { name }); await utils.createFace({ assetId, personId: person.id });`. Space scope: `utils.createSpacePerson(spaceId, name, ownerId, assetId)` — see "People is seedable too" below |

`waitForQueueFinish` reports "done" while the queue is merely momentarily empty
(`feedback_e2e_waitforqueuefinish_false_done`), so assert EXIF-derived sections with `expect.poll` or a
Playwright web-first assertion rather than treating the drain as a barrier.

### People is seedable too

A People facet needs a **face**, but face detection does not: `utils.createFace({ assetId, personId })`
(`e2e/src/utils.ts:490`) inserts `asset_face`, `face_identity` and `face_identity_face` directly by SQL —
no ML involved. `utils.createPerson(token, { name })` + `createFace` satisfies every predicate
`getFilteredPeople`'s global-scope query checks (`search.repository.ts:1646`: non-empty name, not
hidden, a face on an asset in the filtered scope) and its identity-scoped variant
(`search.repository.ts:1664`, which needs `person.identityId` plus a `face_identity_face` row —
`createFace` writes both). It is already used this way by five web-project specs, including
`global-search.e2e-spec.ts` and `cross-owner-people-merge.e2e-spec.ts`.

For a space's own People facet, use `utils.createSpacePerson(spaceId, name, ownerId, assetId)`
(`e2e/src/utils.ts:573`) instead — it builds the whole `shared_space_person` chain in one transaction
and satisfies `buildFilteredSpacePeopleQuery` (`search.repository.ts:1625`) exactly. It is already used
by `spaces-albums.e2e-spec.ts:567`.

So `people` follows the same rule as every other section: seed it, then assert it renders. There is no
carve-out — every suite that lists "all sections" should include `people`, seeded like the rest.

One environment-specific gotcha either seed needs: `asset_face.sourceType` defaults to
`'machine-learning'` in the schema. On a stack that runs facial recognition (anything other than the
e2e project's own ML-less docker-compose — e.g. a `make dev` stack), `person.service.ts`'s
`handleDetectFaces` re-scans every newly uploaded asset, finds 0 real faces in these fixtures, and
deletes every existing face it still sees tagged `machine-learning` as a stale detection — silently
wiping a manually-seeded face. Both `createFace` and `createSpacePerson` insert their face row with
`sourceType: 'manual'` for exactly this reason; do not drop it.

---

## Task 0: Establish the real failure list before changing anything

**Files:** none — this is a measurement step.

- [ ] **Step 1: Run every affected suite and record what fails**

```bash
make e2e-web-dev
```

Expected: FAIL, broadly. The predicted list, so you can tell a surprise from an expectation:

| Suite                                | Predicted failures                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `photos-filter-panel.e2e-spec.ts`    | `:63` asserts 7 sections; only `timeline` + `rating` survive → **5 fail**. Then `:78` `media-type-image` |
| `spaces-filter-panel.e2e-spec.ts`    | `:82` asserts 7 sections; only `timeline` survives → **6 fail**. Then ~25 rating/media clicks            |
| `recently-added-filters.e2e-spec.ts` | `:130` asserts **all ten**; people/location/camera/tags/favorites/albums → **6 fail**                    |
| `map-filter-panel.e2e-spec.ts`       | `beforeAll` seeds **zero assets**, so `:41` favorites and `:46` location fail                            |

`permission-matrix.e2e-spec.ts` is in the `rebase-smoke` project, not `web` — run it separately with
`make e2e-rebase-smoke` if you want the confirmation; Task 4 fixes it either way.

**Write the actual list down before continuing.** If a suite fails in a way this table does not predict,
stop: it means slice 5 gates something it should not, and that is a bug in slice 5, not a seed gap.

---

## Task 1: Photos suite

**Files:** `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts` — `beforeAll` at `:9-29`, assertions at `:63`.

- [ ] **Step 1: Seed the missing variety**

The suite creates three images and rates one. Add a video, a GPS asset, a Canon asset, a tag, a
favourite and a partial album membership per the recipe table. Keep `asset1`'s rating.

```ts
// #910: each of these keeps one filter section available. Without them the section is correctly
// hidden and the assertions below have nothing to act on. See slice 6's recipe table.
const video = await utils.createAsset(admin.accessToken, {
  fileCreatedAt: '2023-06-01T10:00:00.000Z',
  fileModifiedAt: '2023-06-01T10:00:00.000Z',
  assetData: { filename: 'example-video.mp4' },
});
await utils.createAsset(admin.accessToken, {
  assetData: { bytes: readFileSync(`${testAssetDir}/metadata/gps-position/thompson-springs.jpg`), filename: 'gps.jpg' },
});
await utils.createAsset(admin.accessToken, {
  assetData: { bytes: readFileSync(`${testAssetDir}/metadata/rating/mongolels.jpg`), filename: 'canon.jpg' },
});
await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');

const [tag] = await utils.upsertTags(admin.accessToken, ['e2e-filter-tag']);
await utils.tagAssets(admin.accessToken, tag.id, [asset1.id]);
await updateAsset(
  { id: asset1.id, updateAssetDto: { isFavorite: true } },
  { headers: asBearerAuth(admin.accessToken) },
);

// Albums needs BOTH sides — some filed, some not.
const album = await utils.createAlbum(admin.accessToken, { albumName: '#910 album', assetIds: [video.id] });

// People: createFace inserts asset_face + face_identity + face_identity_face directly, no ML needed.
const person = await utils.createPerson(admin.accessToken, { name: '#910 Person' });
await utils.createFace({ assetId: asset1.id, personId: person.id });
```

`readFileSync` and `testAssetDir` need importing (`node:fs` and `src/utils`); `utils.createAlbum`'s exact
signature is in `e2e/src/utils.ts` — read it rather than copying the line above verbatim.

- [ ] **Step 2: Assert every section at `:63`, People included**

```ts
test('should show every filter section its library can populate', async ({ context, page }) => {
  await gotoPhotos(context, page);
  await expect(page.locator('[data-testid="discovery-panel"]')).toBeVisible();

  for (const section of [
    'timeline',
    'people',
    'location',
    'camera',
    'tags',
    'rating',
    'media',
    'favorites',
    'albums',
    'text',
  ]) {
    await expect(page.locator(`[data-testid="filter-section-${section}"]`)).toBeVisible();
  }
});
```

The list is `ALL_FILTER_SECTIONS` in full (`filter-panel.ts:46`) — every section the seed above
populates, including `people` now that it is seeded like everything else.

- [ ] **Step 3: Re-run and confirm every predicted failure is gone**

```bash
make e2e-web-dev
```

- [ ] **Step 4: Commit**

```bash
git add e2e/src/specs/web/photos-filter-panel.e2e-spec.ts
git commit -m "test(e2e): seed the variety each filter section needs (#910)"
```

---

## Task 2: Spaces suite

**Files:** `e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts` — `createPopulatedSpace` at `:52-76`,
assertions at `:82-97`.

`createPopulatedSpace` seeds four plain images and nothing else, and the suite clicks `rating-star-N` /
`media-type-*` around 25 times, so this is the largest fix.

- [ ] **Step 1: Extend `createPopulatedSpace`**

Apply the same recipe set as Task 1, inside the helper so every caller benefits, and add the new assets
to `utils.addSpaceAssets` alongside the existing four. **The space, not the library, is the scope** — an
asset that is not in the space does not populate the space's facets. For People, use
`utils.createSpacePerson(space.id, name, ownerId, assetId)` (not `createFace`) — People is space-scoped
here, and `createSpacePerson` builds the `shared_space_person` chain the space's own facet query reads.

- [ ] **Step 2: Assert every section at `:91`, People included**

Same shape as Task 1 Step 2: add `people` to the visible-sections list, in `ALL_FILTER_SECTIONS` order.

Three existing People tests in this file build their own bespoke space rather than reusing
`createPopulatedSpace` ("should show only people present in the space (not global list)", "should
update timeline when selecting a person", "should show photos containing either selected person (OR
logic)"). Give each its own `utils.createSpacePerson` call too — they are the only web-suite coverage
of space-scoped people versus the global list, and a seed exists for every one of them.

- [ ] **Step 3: Re-run, then commit**

```bash
git add e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts
git commit -m "test(e2e): seed varied space assets so every filter section renders (#910)"
```

---

## Task 3: Recently Added and Map suites

**Files:** `recently-added-filters.e2e-spec.ts:130`, `map-filter-panel.e2e-spec.ts:9-12`.

- [ ] **Step 1: Recently Added**

Its `beforeAll` already seeds images, videos and ratings, so media and rating are fine. Add location,
camera, tags, favourites, a partial album, and a face (`createPerson` + `createFace`, on an
already-seeded asset so `TOTAL` stays exact) for People, then assert all ten sections at `:130`.

- [ ] **Step 2: Map**

`map-filter-panel.e2e-spec.ts` seeds **nothing at all**, which is why its favorites (`:41`) and location
(`:46`) tests fail: on an empty library every gated section is unavailable. Its `beforeAll` needs at
minimum the GPS asset (for `filter-section-location`) and a favourite (for `favorites-filter`).

This suite is also the cheapest place to prove the feature end to end, because it starts empty. Consider
keeping one test that asserts the empty-library panel renders only `timeline` and `text` — but only if
it can run before the seeding `beforeAll`, i.e. in its own `test.describe`.

- [ ] **Step 3: Re-run, then commit**

```bash
git add e2e/src/specs/web/recently-added-filters.e2e-spec.ts e2e/src/specs/web/map-filter-panel.e2e-spec.ts
git commit -m "test(e2e): seed the recently-added and map filter suites (#910)"
```

---

## Task 4: The rebase-smoke camera wait

**Files:** `e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts:220`.

Test 9 waits unconditionally for `filter-section-camera`, while its own assertion at `:237` is guarded by
`if (fullAsset.exifInfo?.make)` — the suite already assumes `make` may be absent. When it is, the section
is now correctly hidden and the wait times out. The wait must take the same guard as the assertion.

- [ ] **Step 1: Make the wait conditional**

```ts
// #910: an asset with no EXIF make gives an empty camera facet, so the section is not rendered.
// The assertion below is already guarded on `make`; the wait has to be too.
if (fullAsset.exifInfo?.make) {
  await page.locator('[data-testid="filter-section-camera"]').waitFor({ timeout: 10_000 });
}
```

Leave the location and tags waits alone: `test.skip` above already guarantees a country, and the suite
seeds the tag itself.

- [ ] **Step 2: Run the rebase-smoke project, then commit**

```bash
make e2e-rebase-smoke
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): guard the camera-section wait on EXIF make (#910)"
```

---

## Task 5: Direct coverage for the hide behaviour

**Files:** `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts`

Tasks 1–4 prove the feature does not break existing flows. This proves it works.

- [ ] **Step 1: Write the tests**

These need a library **without** the seeded variety, so they get their own `test.describe` with its own
`beforeAll` and a `utils.resetDatabase()`. Placing them in the existing describe would fight its fixture.

```ts
test.describe('Photos FilterPanel — unavailable sections (#910)', () => {
  let admin: LoginResponseDto;
  let assetId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Images only, nothing rated, nothing favourited, no albums, no tags, no EXIF.
    const asset = await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2023-08-15T10:00:00.000Z',
      fileModifiedAt: '2023-08-15T10:00:00.000Z',
    });
    assetId = asset.id;
  });

  test('hides the sections that cannot filter anything', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('[data-testid="discovery-panel"]');

    // The positive assertion first: the panel rendered, so the negatives below mean something.
    await expect(page.locator('[data-testid="filter-section-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-section-text"]')).toBeVisible();

    for (const section of ['media', 'rating', 'favorites', 'albums', 'people', 'location', 'camera', 'tags']) {
      await expect(page.locator(`[data-testid="filter-section-${section}"]`)).toHaveCount(0);
      await expect(page.locator(`[data-testid="section-toggle-${section}"]`)).toHaveCount(0);
    }
  });

  test('shows the favorites section once something is favourited', async ({ context, page }) => {
    await updateAsset(
      { id: assetId, updateAssetDto: { isFavorite: true } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('[data-testid="filter-section-favorites"]')).toBeVisible();
  });

  test('shows the media section once a video exists', async ({ context, page }) => {
    await utils.createAsset(admin.accessToken, { assetData: { filename: 'late-video.mp4' } });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('[data-testid="filter-section-media"]')).toBeVisible();
  });
});
```

The `assetId` capture replaces the earlier draft's `utils.getAssets`, which does not exist under that
name — capture from `createAsset` instead of looking it up.

Note the ordering dependency: the second test favourites the asset and the third adds a video, so the
first must run before both. Playwright runs tests within a file in declaration order by default; if this
project enables `fullyParallel`, split them into separate describes with their own resets rather than
relying on it.

- [ ] **Step 2: Run them**

```bash
make e2e-web-dev
```

Expected: PASS. If "hides the sections" fails, slice 5's gating is not reaching the browser — check that
the page provider forwards the new facets (slice 4) before touching this test.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/photos-filter-panel.e2e-spec.ts
git commit -m "test(e2e): cover hiding and revealing unusable filter sections (#910)"
```

---

## Done when

- `make e2e-web-dev` is green for all four web filter suites, and `make e2e-rebase-smoke` for Test 9.
- Every failure recorded in Task 0 is accounted for, fixed by seeding. Nothing was made to pass by
  deleting or weakening an assertion — People included, via `utils.createFace` /
  `utils.createSpacePerson` (see "People is seedable too").

# Per-user favorites — Slice 4: Cross-scope favorites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Favorites compose with cross-user scopes (shared spaces, partners) on the timeline and map — the `BadRequestException` guard's favorite arm is removed, the map/space-resolution skips are removed, favorited stack children surface standalone (E31), and the web stops suppressing `withSharedSpaces`/`withPartners` when a favorite filter is active.

**Architecture:** Slice 1 already replaced every favorite read with the per-user `favoriteExistsFor(eb, authUserId)` overlay predicate and threaded `authUserId` through `TimeBucketOptions` / `AssetSearchBuilderOptions`, and the space-scope union (`timelineSpaceIds` arms in `withTimeBucketAssetFilters` / `searchAssetBuilder` / `map.repository`) already exists for non-favorite browsing. **The spec's §5.2 "second blocker" (owner-scoping) is therefore already replaced** — what remains is: (1) the guard arms in `timeline.service.ts` that reject `isFavorite × withPartners/withSharedSpaces`, (2) two `isFavorite !== true` space-resolution skips (`map.service.ts:26`, `shared-space.service.ts:1040`), (3) the stack-collapse predicate that hides favorited stack children (E31), and (4) ~11 web mirror sites. Tests must still assert **presence of non-owned favorites in payloads**, not merely "no longer a 400" (§10.9).

**Tech Stack:** NestJS 11 + Kysely (server), Vitest (unit/medium/e2e API), SvelteKit + Svelte 5 (web).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` — slice 4 (§9), edge rows E10, E11, E15, E16, E16b, E23, E29, E30, E31.
- **Only the favorite arm of each guard is removed.** The archive / trash / locked arms in `timeline.service.ts` stay exactly as they are — those are separate owner-private semantics. Same for the `visibility === undefined` rejection.
- **The `/favorites` named web route is deliberately UNCHANGED in this slice.** Reason: `withSharedSpaces` requires an explicit `visibility=timeline` (guard arm that stays), but `/favorites` today relies on `withDefaultVisibility` (`Timeline+Archive`, `utils/database.ts:106`) so it shows the caller's **archived** favorites. Adding `withSharedSpaces + visibility: Timeline` would silently drop archived favorites for **every** user, violating the spec edge case "`/favorites` route unchanged for a user with no spaces". Cross-scope favorites surface through the photos-page favorite filter, search, and the map. Widening `/favorites` itself needs a decision about the guard's archive arm → out of scope, flagged in the slice report.
- Server style: no relative imports (`src/` alias), prettier 120/single-quote, eslint zero warnings. `prettier --check` and eslint are **separate** gates — run both on every modified file.
- Web gate from `web/`: `pnpm check:typescript`, `pnpm check:svelte`, `pnpm lint` (no `--max-warnings`).
- E2E runs: `cd e2e && npx vitest --config vitest.config.mjs run <path>` (never `pnpm test -- --run <path>` — it silently drops the path filter). The e2e stack is a machine-wide singleton; rebuild it (`make e2e`) after server changes before trusting results.
- Do **not** run `make sql` without a running DB (it deletes all query files). This slice is designed so SQL snapshots do **not** change (see Task 3 note).
- Commit messages: `feat(favorites): … (#763)` / `test(favorites): … (#763)`; never add Co-Authored-By trailers.

## File Map

| File                                                                 | Change                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `server/src/services/timeline.service.ts:186-209`                    | Remove `requestedFavorite` from both guard blocks             |
| `server/src/services/timeline.service.spec.ts:283,508`               | Invert favorite-arm rejection tests                           |
| `server/src/services/map.service.ts:26`                              | Drop `&& options.isFavorite !== true`                         |
| `server/src/services/shared-space.service.ts:1040`                   | Drop `&& dto.isFavorite !== true`                             |
| `server/src/services/map.service.spec.ts:156`                        | Invert skip test                                              |
| `server/src/services/shared-space.service.spec.ts:11173`             | Invert skip test                                              |
| `server/src/repositories/asset.repository.ts:422-428`                | E31: skip stack collapse when `isFavorite === true`           |
| `e2e/src/specs/server/api/timeline.e2e-spec.ts`                      | New describes: cross-scope favorites + E31 stacks             |
| `e2e/src/specs/server/api/asset-favorite.e2e-spec.ts`                | New describe: lifecycle E10/E11/E29/E30 + trash edge          |
| `e2e/src/specs/server/api/gallery-map.e2e-spec.ts`                   | E23: cross-space favorite markers, both map endpoints         |
| `server/test/medium/specs/repositories/favorite-cross-scope.spec.ts` | New: §10.10 performance budget                                |
| `web/src/lib/utils/photos-filter-options.ts:17-22`                   | Unconditional `withPartners`/`withSharedSpaces`               |
| `web/src/lib/utils/album-filter-options.ts:54`                       | Unconditional `withPartners` in picker options                |
| `web/src/lib/utils/map-filter-options.ts:113-118`                    | Drop favorite gate on `withPartners`                          |
| `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`           | 8 mirror sites → unconditional                                |
| `web/src/lib/utils/photos-filter-options.spec.ts`                    | New spec                                                      |
| `web/src/lib/utils/space-filter-options.spec.ts`                     | Extend for album picker + map builders (or sibling new files) |

Passthrough sites that only test "is the favorite filter active" (`filter-panel.ts`, `filter-search-terms.ts`, `searchable-page-search.ts`, `global-search-manager.svelte.ts`, `album-filter-options.ts:26`, `map-filter-options.ts:25,113`, `photos-filter-options.ts:55`, `space-filter-options.ts:38`, `space-search.ts:84`) are **NOT mirrors — leave them**.

---

### Task 1: Timeline guard removal — E15, E16, E16b, compose, dedup, showInTimeline

**Files:**

- Modify: `server/src/services/timeline.service.ts:186-209`
- Modify: `server/src/services/timeline.service.spec.ts` (blocks at ~:283 and ~:508)
- Modify: `e2e/src/specs/server/api/timeline.e2e-spec.ts` (new describe after the `withSharedSpaces and withPartners` describe, ~line 360)

**Interfaces:**

- Consumes: `PUT /assets/favorites` (slice 2), `favoriteExistsFor` + `authUserId` threading (slice 1), `buildSpaceContext` fixture (`e2e/src/actors.ts` — `ctx.spaceOwner/spaceEditor/spaceViewer`, `ctx.ownerAssetId/editorAssetId/spaceAssetId/partnerAssetId`).
- Produces: guard-free `timeBucketChecks` — later tasks rely on `isFavorite` reaching the repository together with `timelineSpaceIds`/partner `userIds`.

- [ ] **Step 1: Write the failing e2e tests.** Append to `e2e/src/specs/server/api/timeline.e2e-spec.ts`, inside the top-level `/timeline` describe, after the `withSharedSpaces and withPartners` describe. The file's shared fixture: `ctx = await buildSpaceContext({ withPartner: true })`; `ctx.spaceViewer` owns **no** assets; `ctx.spaceAssetId` is owned by `spaceOwner` and in the space; `ctx.partnerAssetId` is owned by `partner` who shares with `spaceOwner` (timeline-enabled). Favorite rows added here don't perturb the file's other tests (nothing else filters by favorite).

```ts
describe('GET /timeline — cross-scope favorites (#763 slice 4)', () => {
  beforeAll(async () => {
    // spaceViewer favorites the space asset they can only READ (owned by spaceOwner);
    // spaceOwner favorites the partner's asset AND their own in-space asset.
    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(ctx.spaceViewer.token!))
      .send({ ids: [ctx.spaceAssetId], isFavorite: true });
    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(ctx.spaceOwner.token!))
      .send({ ids: [ctx.partnerAssetId!, ctx.spaceAssetId], isFavorite: true });
  });

  it('isFavorite=true + withSharedSpaces returns the NON-OWNED space favorite in the payload (E15)', async () => {
    const buckets = await request(app)
      .get('/timeline/buckets?visibility=timeline&withSharedSpaces=true&isFavorite=true')
      .set(asBearerAuth(ctx.spaceViewer.token!));
    expect(buckets.status).toBe(200);
    // spaceViewer owns nothing; their only favorite is the space asset → exactly 1.
    expect(total(buckets.body)).toBe(1);

    const timeBucket = (buckets.body as Array<{ timeBucket: string }>)[0].timeBucket;
    const bucket = await request(app)
      .get(
        `/timeline/bucket?visibility=timeline&withSharedSpaces=true&isFavorite=true&timeBucket=${encodeURIComponent(timeBucket)}`,
      )
      .set(asBearerAuth(ctx.spaceViewer.token!));
    expect(bucket.status).toBe(200);
    // §10.9: the non-owned favorite must actually be IN the payload, with the caller's flag.
    expect(bucket.body.id).toContain(ctx.spaceAssetId);
    expect(bucket.body.isFavorite[bucket.body.id.indexOf(ctx.spaceAssetId)]).toBe(true);
  });

  it('isFavorite=true + withPartners returns the partner-owned favorite (E16)', async () => {
    const buckets = await request(app)
      .get('/timeline/buckets?visibility=timeline&withPartners=true&isFavorite=true')
      .set(asBearerAuth(ctx.spaceOwner.token!));
    expect(buckets.status).toBe(200);
    // spaceOwner favorited partnerAssetId + their own spaceAssetId → 2.
    expect(total(buckets.body)).toBe(2);

    const timeBucket = (buckets.body as Array<{ timeBucket: string }>)[0].timeBucket;
    const bucket = await request(app)
      .get(
        `/timeline/bucket?visibility=timeline&withPartners=true&isFavorite=true&timeBucket=${encodeURIComponent(timeBucket)}`,
      )
      .set(asBearerAuth(ctx.spaceOwner.token!));
    expect(bucket.status).toBe(200);
    expect(bucket.body.id).toContain(ctx.partnerAssetId);
  });

  it('isFavorite=FALSE also composes with both scopes — the old guard tripped on false too (E16b)', async () => {
    // spaceViewer: readable timeline = the 1 space asset, which they favorited → not-favorited = 0.
    const spaces = await request(app)
      .get('/timeline/buckets?visibility=timeline&withSharedSpaces=true&isFavorite=false')
      .set(asBearerAuth(ctx.spaceViewer.token!));
    expect(spaces.status).toBe(200);
    expect(total(spaces.body)).toBe(0);

    // spaceOwner: own 2 + partner 1, minus their 2 favorites → 1 (ownerAssetId).
    const partners = await request(app)
      .get('/timeline/buckets?visibility=timeline&withPartners=true&isFavorite=false')
      .set(asBearerAuth(ctx.spaceOwner.token!));
    expect(partners.status).toBe(200);
    expect(total(partners.body)).toBe(1);
  });

  it('favorites + spaces + partners simultaneously, and an own-and-in-space favorite appears ONCE', async () => {
    const buckets = await request(app)
      .get('/timeline/buckets?visibility=timeline&withPartners=true&withSharedSpaces=true&isFavorite=true')
      .set(asBearerAuth(ctx.spaceOwner.token!));
    expect(buckets.status).toBe(200);
    // spaceAssetId is owned by the caller AND in the space (two scope branches) — it must
    // count once. partnerAssetId + spaceAssetId → exactly 2.
    expect(total(buckets.body)).toBe(2);

    const timeBucket = (buckets.body as Array<{ timeBucket: string }>)[0].timeBucket;
    const bucket = await request(app)
      .get(
        `/timeline/bucket?visibility=timeline&withPartners=true&withSharedSpaces=true&isFavorite=true&timeBucket=${encodeURIComponent(timeBucket)}`,
      )
      .set(asBearerAuth(ctx.spaceOwner.token!));
    const ids = bucket.body.id as string[];
    expect(ids.filter((id) => id === ctx.spaceAssetId)).toHaveLength(1);
  });

  it('showInTimeline=false hides space favorites like any other space content', async () => {
    // Mirror the toggle pattern of the existing 'toggling showInTimeline=false' test in this
    // file (~:290) — same endpoint, same restore-afterwards discipline (try/finally).
    // Assert: spaceViewer's favorites+withSharedSpaces total drops to 0 while disabled,
    // and returns to 1 after restore.
  });

  it('withSharedSpaces + isFavorite WITHOUT explicit visibility still 400s (archive arm untouched)', async () => {
    const { status } = await request(app)
      .get('/timeline/buckets?withSharedSpaces=true&isFavorite=true')
      .set(asBearerAuth(ctx.spaceViewer.token!));
    expect(status).toBe(400);
  });
});
```

Fill in the `showInTimeline` test body by copying the exact toggle/restore calls from the existing test at ~:290 in the same file.

- [ ] **Step 2: Run the new e2e tests to verify they fail.** Ensure the e2e stack is current: from repo root `make e2e` (machine-wide singleton — check no other session is mid-run). Then:

```bash
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/timeline.e2e-spec.ts -t 'cross-scope favorites'
```

Expected: E15/E16/E16b/compose tests FAIL with status 400 (the guard). The "still 400s" negative passes.

- [ ] **Step 3: Invert the unit tests.** In `server/src/services/timeline.service.spec.ts`:

Replace the test `'should throw when combined with isFavorite'` (~:283, inside the `withSharedSpaces` describe) with — mirror the mock arrangement of the adjacent passing test `'should not pass timelineSpaceIds when user has no enabled spaces'` and the space-rows mock shape of the test above it (which expects `timelineSpaceIds: ['space-1', 'space-2']`):

```ts
it('passes isFavorite through to the repository when combined with withSharedSpaces (#763 slice 4)', async () => {
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: 'space-1' }]);
  mocks.asset.getTimeBuckets.mockResolvedValue([]);

  await expect(
    sut.getTimeBuckets(authStub.admin, {
      withSharedSpaces: true,
      visibility: AssetVisibility.Timeline,
      isFavorite: true,
    }),
  ).resolves.toEqual([]);

  expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith(
    expect.objectContaining({
      isFavorite: true,
      timelineSpaceIds: ['space-1'],
      authUserId: authStub.admin.user.id,
    }),
  );
});
```

Replace `'should throw an error if withParners is true and isFavorite is either true or false'` (~:508, `getTimeBucket` describe) with — mirror the partner mocks of the nearest passing `withPartners` test in the file:

```ts
it('passes isFavorite (true and false) through when combined with withPartners (#763 slice 4)', async () => {
  mocks.asset.getTimeBucket.mockResolvedValue({ assets: '[]' });

  for (const isFavorite of [true, false]) {
    await expect(
      sut.getTimeBucket(authStub.admin, {
        timeBucket: '2024-01-01',
        visibility: AssetVisibility.Timeline,
        bucketSize: TimeBucketSize.Day,
        withPartners: true,
        userId: authStub.admin.user.id,
        isFavorite,
      }),
    ).resolves.toBeDefined();
  }

  expect(mocks.asset.getTimeBucket).toHaveBeenLastCalledWith(
    '2024-01-01',
    expect.objectContaining({ isFavorite: false, authUserId: authStub.admin.user.id }),
    authStub.admin,
  );
});
```

**Partner-mock note:** the old rejection tests threw inside `timeBucketChecks` and never reached `buildTimeBucketOptions`, so they needed no partner mocks — the inverted test DOES reach it and `getMyPartnerIds` will call the partner repository. Find a **passing** `withPartners` test in this spec file and copy its partner-repository mock arrangement; if none exists, add `mocks.partner.getAll.mockResolvedValue([])` (the `newTestService` auto-mock exposes it — verify the exact mock key by grepping `mocks.partner` in the file).

Do **not** touch the archive/undefined-visibility/trash/locked rejection tests.

- [ ] **Step 4: Run the unit tests to verify the inverted ones fail.**

```bash
cd server && pnpm exec vitest run src/services/timeline.service.spec.ts
```

Expected: the two new tests FAIL (`BadRequestException` thrown); all others pass.

- [ ] **Step 5: Remove the favorite arm from both guards.** In `server/src/services/timeline.service.ts`, replace lines 186-209 with:

```ts
if (dto.withPartners) {
  const requestedLocked = dto.visibility === AssetVisibility.Locked;
  const requestedArchived = dto.visibility === AssetVisibility.Archive || dto.visibility === undefined;
  const requestedTrash = dto.isTrashed === true;

  // #763 slice 4: isFavorite is deliberately no longer rejected here — favorites are a
  // per-user overlay (asset_favorite) resolved for the CALLER, so they compose with
  // cross-user scopes. Archive/trash/locked stay rejected: owner-private states.
  if (requestedLocked || requestedArchived || requestedTrash) {
    throw new BadRequestException('withPartners is only supported for non-archived, non-trashed, non-locked assets');
  }
}

if (dto.withSharedSpaces) {
  const requestedArchived = dto.visibility === AssetVisibility.Archive || dto.visibility === undefined;
  const requestedTrash = dto.isTrashed === true;

  if (requestedArchived || requestedTrash) {
    throw new BadRequestException('withSharedSpaces is only supported for non-archived, non-trashed assets');
  }
}
```

- [ ] **Step 6: Verify green.**

```bash
cd server && pnpm exec vitest run src/services/timeline.service.spec.ts
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/timeline.e2e-spec.ts
```

Rebuild the e2e stack first (`make e2e`) so the server image contains Step 5. Expected: full file green both times (the whole timeline e2e file, not only the new describe — the guard-message test at ~:346 must still pass).

- [ ] **Step 7: Commit.**

```bash
git add server/src/services/timeline.service.ts server/src/services/timeline.service.spec.ts e2e/src/specs/server/api/timeline.e2e-spec.ts
git commit -m "feat(favorites): compose isFavorite with withSharedSpaces and withPartners (#763)"
```

---

### Task 2: Map cross-scope — E23

**Files:**

- Modify: `server/src/services/map.service.ts:26`
- Modify: `server/src/services/shared-space.service.ts:1040`
- Modify: `server/src/services/map.service.spec.ts` (~:156)
- Modify: `server/src/services/shared-space.service.spec.ts` (~:11173)
- Modify: `e2e/src/specs/server/api/gallery-map.e2e-spec.ts`

**Interfaces:**

- Consumes: `map.repository.getMapMarkers(authUserId, userIds, albumIds, { isFavorite, timelineSpaceIds })` — already overlay-aware (slice 1, `map.repository.ts:110-111,148-176`); `sharedSpaceRepository.getFilteredMapMarkers` → `searchAssetBuilder` (already overlay-aware).
- Produces: space resolution unconditional on the favorite filter for both `/map/markers` and `/gallery/map/markers`.

- [ ] **Step 1: Write the failing e2e tests.** In `e2e/src/specs/server/api/gallery-map.e2e-spec.ts`, add a describe at the end. The existing fixture has `admin` + `user` and `assetWithGps` (thompson-springs.jpg, Colorado). Add a second user who owns a geotagged asset in a space that `user` views:

```ts
describe('cross-scope favorite markers (#763 slice 4, E23)', () => {
  let spaceOwner: LoginResponseDto;
  let spaceGpsAsset: AssetMediaResponseDto;

  beforeAll(async () => {
    spaceOwner = await utils.userSetup(admin.accessToken, createUserDto.create('t18-space-owner'));
    const filepath = join(testAssetDir, 'metadata/gps-position/thompson-springs.jpg');
    spaceGpsAsset = await utils.createAsset(spaceOwner.accessToken, {
      assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
    });
    // Wait for metadata (GPS) extraction. The file's websocket is connected as `user`, so
    // waitForWebsocketEvent will NOT see spaceOwner's upload — poll the post-condition instead
    // (memory feedback_e2e_waitforqueuefinish_false_done): loop until
    // utils.getAssetInfo(spaceOwner.accessToken, spaceGpsAsset.id) has exifInfo.latitude != null,
    // with a bounded retry (e.g. 30 × 500ms) that fails loudly on timeout.
    const space = await utils.createSpace(spaceOwner.accessToken, { name: 'map-fav-space' });
    await utils.addSpaceMember(spaceOwner.accessToken, space.id, {
      userId: user.userId,
      role: SharedSpaceRole.Viewer,
    });
    await utils.addSpaceAssets(spaceOwner.accessToken, space.id, [spaceGpsAsset.id]);
    // The VIEWER favorites the non-owned space asset.
    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(user.accessToken))
      .send({ ids: [spaceGpsAsset.id], isFavorite: true });
  });

  it('/map/markers?isFavorite=true&withSharedSpaces=true includes the cross-space favorite', async () => {
    const { status, body } = await request(app)
      .get('/map/markers?isFavorite=true&withSharedSpaces=true')
      .set(asBearerAuth(user.accessToken));
    expect(status).toBe(200);
    expect((body as Array<{ id: string }>).map((m) => m.id)).toContain(spaceGpsAsset.id);
  });

  it('/gallery/map/markers?isFavorite=true&withSharedSpaces=true includes the cross-space favorite', async () => {
    const { status, body } = await request(app)
      .get('/gallery/map/markers?isFavorite=true&withSharedSpaces=true')
      .set(asBearerAuth(user.accessToken));
    expect(status).toBe(200);
    expect((body as Array<{ id: string }>).map((m) => m.id)).toContain(spaceGpsAsset.id);
  });

  it("the owner's map does not show the viewer's favorite as their own (no cross-user read)", async () => {
    const { body } = await request(app).get('/map/markers?isFavorite=true').set(asBearerAuth(spaceOwner.accessToken));
    expect((body as Array<{ id: string }>).map((m) => m.id)).not.toContain(spaceGpsAsset.id);
  });
});
```

Adjust imports (`SharedSpaceRole`, `createUserDto` already imported in this file — verify) and reuse the file's existing websocket-wait pattern for metadata extraction on the new asset.

- [ ] **Step 2: Run to verify red.**

```bash
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/gallery-map.e2e-spec.ts -t 'cross-scope favorite markers'
```

Expected: the two inclusion tests FAIL (empty/absent marker — the skip means `timelineSpaceIds` is never resolved when `isFavorite=true`; this was never a 400). The no-cross-user-read test passes.

- [ ] **Step 3: Invert the unit tests.**
- `server/src/services/map.service.spec.ts` ~:156 `'should not resolve space IDs when isFavorite=true'` → rename to `'resolves space IDs even when isFavorite=true (#763 slice 4)'` and flip the assertion: `expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id)` and the repository call receives `timelineSpaceIds` (mirror the mock-return shape used by the adjacent passing resolution test in the same file).
- `server/src/services/shared-space.service.spec.ts` ~:11173 `'should not resolve timelineSpaceIds when isFavorite=true'` → same inversion for `getFilteredMapMarkers`: `getSpaceIdsForTimeline` called, and `sharedSpaceRepository.getFilteredMapMarkers` receives `timelineSpaceIds` + `isFavorite: true`.

- [ ] **Step 4: Run to verify the inverted unit tests fail.**

```bash
cd server && pnpm exec vitest run src/services/map.service.spec.ts src/services/shared-space.service.spec.ts
```

- [ ] **Step 5: Remove both skips.**

`server/src/services/map.service.ts:26`:

```ts
    if (options.withSharedSpaces || options.withSharedAlbums) {
```

`server/src/services/shared-space.service.ts:1040`:

```ts
    if (!dto.spaceId && dto.withSharedSpaces) {
```

- [ ] **Step 6: Verify green.**

```bash
cd server && pnpm exec vitest run src/services/map.service.spec.ts src/services/shared-space.service.spec.ts
make e2e   # rebuild stack with the change
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/gallery-map.e2e-spec.ts src/specs/server/api/map.e2e-spec.ts
```

Run the whole of both map e2e files — the existing `'isFavorite filter respects the favorite state'` test must still pass.

- [ ] **Step 7: Commit.**

```bash
git add server/src/services/map.service.ts server/src/services/shared-space.service.ts server/src/services/map.service.spec.ts server/src/services/shared-space.service.spec.ts e2e/src/specs/server/api/gallery-map.e2e-spec.ts
git commit -m "feat(favorites): resolve space scope for favorite-filtered map markers (#763)"
```

---

### Task 3: Stacked assets — E31: a favorited stack child surfaces standalone

**Files:**

- Modify: `server/src/repositories/asset.repository.ts:422-428`
- Modify: `e2e/src/specs/server/api/timeline.e2e-spec.ts` (new describe with a dedicated user)

**Interfaces:**

- Consumes: `utils.createStack(accessToken, assetIds)` (`e2e/src/utils.ts:658` — `assetIds[0]` becomes the primary; verify via the response's `primaryAssetId`).
- Produces: `withTimeBucketAssetFilters` semantics — collapse applies **unless** `isFavorite === true`.

**Design note (spec §5.4):** with an `isFavorite: true` filter every returned row already satisfies `favoriteExistsFor(caller)`, so the collapse predicate (`stackId IS NULL OR stack IS NOT NULL`, i.e. primary-only) must simply not apply — a favorited child then surfaces standalone. For `isFavorite: false` and unfiltered timelines, collapse is unchanged. The Stage-2 columnar `stacked_assets` lateral still projects a `[stackId, count]` array for such a child — the client renders it like any stack tile; that is accepted (§5.4 explicitly tolerates "reads as a bug"), and no favorites-view special-casing may be added to hide it.

**SQL-snapshot note:** the `@GenerateSql` dummy params for the bucket queries (`asset.repository.ts:1458`) use `{ withStacked: true }` with `isFavorite` undefined, so the emitted snapshot SQL is **identical** after this change (`options.isFavorite !== true` → true → the WHERE is still rendered). Do not run `make sql`. If CI's SQL check disagrees, something else is wrong — investigate, don't regenerate blind.

- [ ] **Step 1: Write the failing e2e test.** New describe in `timeline.e2e-spec.ts`, with a **dedicated user** so stack/favorite state can't disturb the shared fixture counts:

```ts
describe('GET /timeline — favorited stack children surface standalone (#763 slice 4, E31)', () => {
  let stackUser: { accessToken: string };
  let primaryId: string;
  let childId: string;

  beforeAll(async () => {
    const login = await utils.userSetup(ctx.admin.token!, createUserDto.create('stack-fav'));
    stackUser = login;
    const [a, b] = await Promise.all([utils.createAsset(login.accessToken), utils.createAsset(login.accessToken)]);
    const stack = await utils.createStack(login.accessToken, [a.id, b.id]);
    primaryId = stack.primaryAssetId;
    childId = stack.primaryAssetId === a.id ? b.id : a.id;
    // Favorite ONLY the child.
    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(login.accessToken))
      .send({ ids: [childId], isFavorite: true });
  });

  it('unfiltered withStacked timeline still collapses to the primary (regression)', async () => {
    const { body } = await request(app)
      .get('/timeline/buckets?withStacked=true')
      .set(asBearerAuth(stackUser.accessToken));
    expect(total(body)).toBe(1);
  });

  it('isFavorite=true + withStacked returns the favorited CHILD standalone (E31, §5.4)', async () => {
    const buckets = await request(app)
      .get('/timeline/buckets?withStacked=true&isFavorite=true')
      .set(asBearerAuth(stackUser.accessToken));
    expect(buckets.status).toBe(200);
    expect(total(buckets.body)).toBe(1);

    const timeBucket = (buckets.body as Array<{ timeBucket: string }>)[0].timeBucket;
    const bucket = await request(app)
      .get(`/timeline/bucket?withStacked=true&isFavorite=true&timeBucket=${encodeURIComponent(timeBucket)}`)
      .set(asBearerAuth(stackUser.accessToken));
    expect(bucket.body.id).toContain(childId);
    expect(bucket.body.id).not.toContain(primaryId);
  });
});
```

(If `ctx.admin.token` is not exposed on `SpaceContext`, create the user with a fresh `utils.adminSetup()`-style login the way other describes in this file obtain admin credentials — copy the file's existing pattern.)

- [ ] **Step 2: Run to verify red.**

```bash
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/timeline.e2e-spec.ts -t 'E31'
```

Expected: the E31 test FAILS — buckets total 0 (child collapsed away). The regression test passes.

- [ ] **Step 3: Implement.** In `server/src/repositories/asset.repository.ts`, replace the `withStacked` block (~:422-428):

```ts
    .$if(!!options.withStacked, (qb) =>
      qb
        .leftJoin('stack', (join) =>
          join.onRef('stack.id', '=', 'asset.stackId').onRef('stack.primaryAssetId', '=', 'asset.id'),
        )
        // #763 §5.4 (E31): favorites are per (user, asset). Under an isFavorite:true filter every
        // row is already one of the caller's favorites, and a favorited stack CHILD must surface
        // standalone instead of staying collapsed behind a primary the caller may not have
        // favorited — so the primary-only collapse is skipped for favorite-filtered timelines.
        .$if(options.isFavorite !== true, (qb) =>
          qb.where((eb) => eb.or([eb('asset.stackId', 'is', null), eb(eb.table('stack'), 'is not', null)])),
        ),
    )
```

- [ ] **Step 4: Verify green.**

```bash
make e2e
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/timeline.e2e-spec.ts
git diff --stat server/src/queries   # MUST be empty — see SQL-snapshot note
```

- [ ] **Step 5: Commit.**

```bash
git add server/src/repositories/asset.repository.ts e2e/src/specs/server/api/timeline.e2e-spec.ts
git commit -m "feat(favorites): surface favorited stack children standalone in favorite-filtered timelines (#763)"
```

---

### Task 4: Access-lifecycle e2e — E10, E11, E29, E30 + trash edge

**Files:**

- Modify: `e2e/src/specs/server/api/asset-favorite.e2e-spec.ts` (new describe with fresh users — the file's existing tests are order-dependent on alice/bob/carol; do not touch their state)

**Interfaces:**

- Consumes: guard removal (Task 1). Space-member removal: use the same endpoint the shared-space e2e specs use (`grep -rn "members" e2e/src/specs/server/api/shared-space.e2e-spec.ts` for the exact call). Album share/unshare: `utils.createAlbum` with `albumUsers` and the album-user removal endpoint (grep `album-user` in e2e utils/specs). Partner add/remove + timeline-enable: copy `e2e/src/actors.ts:111-118`.
- Produces: pinned re-derivation behavior. **These tests are expected to pass immediately** — re-derivation is structural (§5.2). Any red is a real gap: stop and fix the server, don't adjust the test.

- [ ] **Step 1: Write the tests.**

```ts
describe('favorite rows survive access loss and re-derive on read (#763 slice 4)', () => {
  let dave: LoginResponseDto; // owns space2 + all assets here
  let erin: LoginResponseDto; // space viewer / album recipient
  let space2Id: string;
  let assetY: AssetMediaResponseDto; // in space2
  let assetZ: AssetMediaResponseDto; // album-shared only
  let albumId: string;

  const erinFavoriteBucketTotal = async () => {
    const { body } = await request(app)
      .get('/timeline/buckets?visibility=timeline&withSharedSpaces=true&isFavorite=true')
      .set(asBearerAuth(erin.accessToken));
    return (body as Array<{ count: number }>).reduce((acc, b) => acc + b.count, 0);
  };

  beforeAll(async () => {
    [dave, erin] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('fav-dave')),
      utils.userSetup(admin.accessToken, createUserDto.create('fav-erin')),
    ]);
    const space = await utils.createSpace(dave.accessToken, { name: 'fav-lifecycle-space' });
    space2Id = space.id;
    await utils.addSpaceMember(dave.accessToken, space2Id, { userId: erin.userId, role: SharedSpaceRole.Viewer });
    [assetY, assetZ] = await Promise.all([utils.createAsset(dave.accessToken), utils.createAsset(dave.accessToken)]);
    await utils.addSpaceAssets(dave.accessToken, space2Id, [assetY.id]);
    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(erin.accessToken))
      .send({ ids: [assetY.id], isFavorite: true });
  });

  it('member leaves the space → favorite drops out of listings; rejoining restores it without re-favoriting (E10, E11)', async () => {
    expect(await erinFavoriteBucketTotal()).toBe(1);

    // Remove erin from the space (exact endpoint: copy from shared-space.e2e-spec.ts).
    // ...removal call...
    expect(await erinFavoriteBucketTotal()).toBe(0);
    // Row persisted but unreadable — the asset itself is also gone for erin:
    expect((await request(app).get(`/assets/${assetY.id}`).set(asBearerAuth(erin.accessToken))).status).toBe(400);

    // Re-add erin — the favorite reappears with NO new favorite write.
    await utils.addSpaceMember(dave.accessToken, space2Id, { userId: erin.userId, role: SharedSpaceRole.Viewer });
    expect(await erinFavoriteBucketTotal()).toBe(1);
    expect((await utils.getAssetInfo(erin.accessToken, assetY.id)).isFavorite).toBe(true);
  });

  it('a trashed favorited asset leaves the favorites timeline and returns on restore', async () => {
    await utils.deleteAssets(dave.accessToken, [assetY.id]); // trash, not permanent
    expect(await erinFavoriteBucketTotal()).toBe(0);
    // Restore (exact util: grep restoreAssets / trash restore in e2e utils).
    // ...restore call...
    expect(await erinFavoriteBucketTotal()).toBe(1);
    expect((await utils.getAssetInfo(erin.accessToken, assetY.id)).isFavorite).toBe(true);
  });

  it('album unshare hides the favorite; re-share restores it (E29)', async () => {
    // Share an album containing assetZ with erin, erin favorites it (AssetRead via album — the
    // slice-2 access widening), then unshare and re-share.
    // NOTE the pinned semantics: album-shared favorites do NOT appear in the withSharedSpaces
    // favorites timeline (albums are not a timeline scope) — visibility of the favorite is
    // asserted via getAssetInfo, and absence stays absent throughout.
    // ...createAlbum with albumUsers: [{ userId: erin.userId, role: editor-or-viewer }], assets: [assetZ.id]...
    await request(app)
      .put('/assets/favorites')
      .set(asBearerAuth(erin.accessToken))
      .send({ ids: [assetZ.id], isFavorite: true });
    expect((await utils.getAssetInfo(erin.accessToken, assetZ.id)).isFavorite).toBe(true);

    // ...remove erin from the album...
    expect((await request(app).get(`/assets/${assetZ.id}`).set(asBearerAuth(erin.accessToken))).status).toBe(400);

    // ...re-add erin to the album...
    expect((await utils.getAssetInfo(erin.accessToken, assetZ.id)).isFavorite).toBe(true); // row survived
  });

  it('partner revoke hides partner favorites; re-adding restores them (E30)', async () => {
    // frank shares with grace (grace = recipient, inTimeline enabled — copy actors.ts:111-118),
    // grace favorites frank's asset, sees it via withPartners+isFavorite; revoke; gone; re-add
    // + re-enable inTimeline; back — with NO new favorite write.
  });
});
```

Fill every `...call...` with the exact endpoint/utils found by the greps named above — no placeholders may survive into the committed test.

- [ ] **Step 2: Run.**

```bash
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/asset-favorite.e2e-spec.ts
```

Expected: whole file green (new tests pin structural behavior). If any new test is red, that is a real server gap — diagnose with superpowers:systematic-debugging before touching the test.

- [ ] **Step 3: Commit.**

```bash
git add e2e/src/specs/server/api/asset-favorite.e2e-spec.ts
git commit -m "test(favorites): pin access-loss re-derivation for spaces, albums, partners (#763)"
```

---

### Task 5: Performance budget medium test (§10.10)

**Files:**

- Create: `server/test/medium/specs/repositories/favorite-cross-scope.spec.ts`

**Interfaces:**

- Consumes: medium harness patterns from `server/test/medium/specs/repositories/asset-favorite.repository.spec.ts` (DB boot, factory) and bulk-insert helpers from `server/test/medium.factory.ts`.
- Produces: a logged first-page latency number for the PR description, and a generous regression tripwire.

- [ ] **Step 1: Write the test.** Shape (follow the existing medium spec's setup verbatim for DB/repository construction):

- Seed: caller user; 10 space-owner users; 10 spaces (one per owner) with the caller as member and `showInTimeline` enabled; 10,000 assets (1,000 per owner) linked into their owner's space (`shared_space_asset`); 10,000 `asset_favorite` rows for the caller. Use chunked kysely `insertInto(...).values(chunk)` (1,000 rows/chunk) via the factory's asset-insert helper — never 10k single inserts.
- Warm-up: run `assetRepository.getTimeBuckets(...)` once, untimed.
- Measure with `performance.now()` around the calls timeline.service would make for a favorite-filtered cross-space first page — options must mirror `buildTimeBucketOptions` output: `{ isFavorite: true, timelineSpaceIds: [all 10 space ids], userIds: [caller.id], authUserId: caller.id, visibility: AssetVisibility.Timeline, withStacked: true, bucketSize: TimeBucketSize.Month }`:
  1. `getTimeBuckets(options)`
  2. `getTimeBucket(<first bucket>, options, authDto)`
- `console.log(`[perf #763 slice-4] buckets=${bucketsMs}ms firstBucket=${bucketMs}ms (10 spaces / 10k favorites)`)` — this number goes in the PR.
- Assert both `< 5000` ms — generous (expected ~tens of ms; the tripwire catches the People-page-JIT class of regression, not CI jitter).

- [ ] **Step 2: Run.**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/favorite-cross-scope.spec.ts
```

**Warning:** `pnpm test:medium -- --run <path>` drops the path filter (memory `reference_fresh_worktree_medium_test_prereqs`) — if the full suite starts, use the direct form the other medium specs document (`pnpm exec vitest run --config <medium config> <path>`; read `server/package.json` `test:medium` script and reuse its config flag). Expected: green, with the perf line printed. Record the number.

- [ ] **Step 3: Commit.**

```bash
git add server/test/medium/specs/repositories/favorite-cross-scope.spec.ts
git commit -m "test(favorites): cross-scope favorites first-page performance budget (#763)"
```

---

### Task 6: Web — remove the favorite→scope suppression mirrors

**Files:**

- Modify: `web/src/lib/utils/photos-filter-options.ts:17-22`
- Modify: `web/src/lib/utils/album-filter-options.ts:50-58`
- Modify: `web/src/lib/utils/map-filter-options.ts:110-118`
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte:192,222,274,281,319,337,360,605`
- Create: `web/src/lib/utils/photos-filter-options.spec.ts`
- Modify: `web/src/lib/utils/space-filter-options.spec.ts` (or sibling new spec files) for the album-picker and map builders

**Interfaces:**

- Consumes: `createFilterState()` from `$lib/components/filter-panel/filter-panel` (fixture pattern: `space-filter-options.spec.ts`).
- Produces: `buildPhotosTimelineOptions` always emits `withPartners: true, withSharedSpaces: true`; `buildAlbumAssetPickerOptions` always emits `withPartners: true`; `buildMapTimelineOptions` no longer gates `withPartners` on the favorite filter.

- [ ] **Step 1: Write the failing specs.** `web/src/lib/utils/photos-filter-options.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildPhotosTimelineOptions } from '$lib/utils/photos-filter-options';

describe('photos timeline options — favorites compose with cross-user scopes (#763 slice 4)', () => {
  it('an active favorite filter no longer suppresses partner/space scope', () => {
    const options = buildPhotosTimelineOptions({ ...createFilterState(), isFavorite: true });
    expect(options.isFavorite).toBe(true);
    expect(options.withSharedSpaces).toBe(true);
    expect(options.withPartners).toBe(true);
  });

  it('isFavorite: false also keeps both scopes (the old mirror keyed on undefined)', () => {
    const options = buildPhotosTimelineOptions({ ...createFilterState(), isFavorite: false });
    expect(options.isFavorite).toBe(false);
    expect(options.withSharedSpaces).toBe(true);
    expect(options.withPartners).toBe(true);
  });

  it('no favorite filter: scopes unchanged (regression)', () => {
    const options = buildPhotosTimelineOptions(createFilterState());
    expect(options.isFavorite).toBeUndefined();
    expect(options.withSharedSpaces).toBe(true);
    expect(options.withPartners).toBe(true);
  });
});
```

Add equivalent assertions for `buildAlbumAssetPickerOptions` (`withPartners: true` with `isFavorite: true` set) and `buildMapTimelineOptions` (`withPartners: true` when `settings.withPartners` is on and `isFavorite` is set — mirror however `space-filter-options.spec.ts` constructs its inputs; read `buildMapTimelineOptions`'s signature at `map-filter-options.ts:80` for the settings argument shape).

- [ ] **Step 2: Run to verify red.**

```bash
cd web && pnpm exec vitest run src/lib/utils/photos-filter-options.spec.ts src/lib/utils/space-filter-options.spec.ts
```

Expected: the new favorite-filter cases FAIL (`withSharedSpaces`/`withPartners` undefined).

- [ ] **Step 3: Implement the utils.**

`photos-filter-options.ts:17-22`:

```ts
export function buildPhotosTimelineOptions(filters: FilterState): Record<string, unknown> {
  const base: Record<string, unknown> = {
    visibility: AssetVisibility.Timeline,
    withStacked: true,
    // #763 slice 4: favorites no longer suppress cross-user scopes — the server guard is gone
    // and the favorite predicate is per-user, so partner/space content stays in scope while
    // filtering by favorite.
    withPartners: true,
    withSharedSpaces: true,
  };
```

(delete the `includeSharedTimelineAssets` const.)

`album-filter-options.ts` picker: replace `...(filters.isFavorite === undefined ? { withPartners: true } : {}),` with `withPartners: true,`.

`map-filter-options.ts:113-118`: replace

```ts
if (isFavorite !== undefined) {
  base.isFavorite = isFavorite;
}
if (isFavorite === undefined && settings.withPartners) {
  base.withPartners = true;
}
```

with

```ts
if (isFavorite !== undefined) {
  base.isFavorite = isFavorite;
}
if (settings.withPartners) {
  base.withPartners = true;
}
```

- [ ] **Step 4: Implement the 8 `+page.svelte` sites** (`web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`):
- :192, :274, :281 — `...(nextFilters.isFavorite === undefined ? { withSharedSpaces: true } : {})` / `context?` variants → `withSharedSpaces: true,`
- :222 — `const withSharedSpaces = nextFilters.isFavorite === undefined;` → `const withSharedSpaces = true;`
- :319, :337 — `withSharedSpaces: filters.isFavorite === undefined,` → `withSharedSpaces: true,`
- :360 — `} else if (filters.isFavorite === undefined) {` → `} else {` (keeping `terms.withSharedSpaces = true;`)
- :605 — `withSharedSpaces={filters.isFavorite === undefined}` → `withSharedSpaces={true}`

Update the comment above `handleAddAllToCollection` (~:355) that says "mirrors buildPhotosTimelineOptions' partner/shared-space scoping" if its wording references the favorite condition.

- [ ] **Step 5: Verify green + web gate.**

```bash
cd web && pnpm exec vitest run src/lib/utils/photos-filter-options.spec.ts src/lib/utils/space-filter-options.spec.ts
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint
```

(`check:svelte` reports 0 files locally — treat typescript + lint + CI as the real gate, per memory `feedback_svelte_check_local_noop`.)

- [ ] **Step 6: Commit.**

```bash
git add web/src/lib/utils/photos-filter-options.ts web/src/lib/utils/photos-filter-options.spec.ts web/src/lib/utils/album-filter-options.ts web/src/lib/utils/map-filter-options.ts web/src/lib/utils/space-filter-options.spec.ts "web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte"
git commit -m "feat(web): keep partner/space scope active while filtering by favorite (#763)"
```

---

### Task 7: Slice gate

- [ ] **Step 1: Server gate.**

```bash
cd server && pnpm exec vitest run src/services/timeline.service.spec.ts src/services/map.service.spec.ts src/services/shared-space.service.spec.ts
cd server && pnpm exec tsc --noEmit
cd server && pnpm exec prettier --check src/services/timeline.service.ts src/services/map.service.ts src/services/shared-space.service.ts src/repositories/asset.repository.ts src/services/timeline.service.spec.ts src/services/map.service.spec.ts src/services/shared-space.service.spec.ts test/medium/specs/repositories/favorite-cross-scope.spec.ts
```

- [ ] **Step 2: Full favorite-related e2e sweep** (stack rebuilt via `make e2e` beforehand):

```bash
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/timeline.e2e-spec.ts src/specs/server/api/asset-favorite.e2e-spec.ts src/specs/server/api/gallery-map.e2e-spec.ts src/specs/server/api/map.e2e-spec.ts src/specs/server/api/search.e2e-spec.ts src/specs/server/api/shared-space-album.e2e-spec.ts
```

- [ ] **Step 3: Web gate** (Task 6 Step 5 commands, re-run from a clean state) plus `cd web && pnpm exec prettier --check` on the modified web files.

- [ ] **Step 4: Push.**

```bash
git push
```

Defer the full-repo `make lint-all` to the end-of-branch gate (memory `feedback_defer_lint_to_end`) — per-file prettier/eslint on touched files is the per-slice bar.

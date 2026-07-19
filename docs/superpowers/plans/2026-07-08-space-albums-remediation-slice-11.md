# Space-Albums Remediation — Slice 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the low-severity correctness/UX/resilience findings (C2, albums-7, correctness-7, gaps-7, security-9) and resolve the three investigations (C3, C5, C6) to an explicit fix-or-proven-safe state, each with a committed test.

**Architecture:** Server-only slice on the shared-spaces surface. Four behavioural fixes (event-handler resilience, card-metric SQL gates, a new index migration, route-param validation), one activity-payload redaction (C3, leak found), and two pinning-only regression suites (C5, C6 — both proven safe). Reuses the fork's existing durable face-projection reconcile job (`SharedSpaceFaceMatchAll`) rather than adding a new job type.

**Tech Stack:** NestJS 11 + Kysely (Postgres), Vitest (unit + medium/testcontainers), `@immich/sql-tools` schema decorators, fork migrations in `server/src/schema/migrations-gallery/`.

## Global Constraints

- **Base branch / worktree:** `fix/space-albums-remediation` in worktree `/Users/pierre/dev/gallery/.claude/worktrees/space-albums-remediation`. Slices 1–10 are committed (baseline tip `3ee2ca3a30`).
- **Per-task gate:** `cd server && pnpm run check` (tsc `--noEmit`) ONLY. Do **NOT** run `pnpm run lint` per task — a single ESLint pass is deferred to the run's final gate. Write lint-clean code (120-col, single quotes, trailing commas, semicolons; no relative imports — use `src/` alias; `no-floating-promises`).
- **Docker is DOWN.** Medium (`pnpm test:medium`, testcontainers) and e2e are **CI-deferred** — author the tests now, run them at the final gate/CI. Unit tests (`pnpm test`) run locally as real red→green.
- **No `make sql` locally** (no DB — running it deletes query files). Any changed `@GenerateSql`-decorated query's `.sql` doc drift is CI-deferred (regenerated against a scratch migrated DB at the final gate).
- **Migrations:** fork-only files go in `server/src/schema/migrations-gallery/` with a round timestamp `> 1782100000000` (latest used). This slice uses **`1782300000000`**.
- **Commits:** one per task, exact message given per task. **No Claude co-author / Generated-with trailers.**
- **SDK regen** (`make build-sdk` → `make open-api`) for the security-9 param-DTO OpenAPI format annotations is CI-deferred (no functional signature change; params stay `string`).

---

## Task 1 — C2: converge the space face-people projection after a failed `@OnEvent` handler

**Problem.** `onAlbumAssetsAdd` / `onAlbumAssetsRemove` / `onAssetDelete` / `onAlbumDelete` (`shared-space.service.ts:2881-2985`) wrap their whole body in a try/catch that only logs. A transient `queueAll`/DB failure leaves space person counts + face projections permanently diverged with no retry. `EventRepository.onEvent` awaits handlers inline and does not isolate errors, so throwing would fail the user's album mutation — logging-and-moving-on is correct, but there is no convergence path.

**Fix (reuse existing machinery, no new job type).** On failure, enqueue the fork's existing durable, per-space reconcile job `SharedSpaceFaceMatchAll` for each affected face-enabled space. That job pages the whole space through `processSpaceFaceMatch` (idempotent re-projection of missing faces) and its completion follow-up runs `SharedSpacePersonDedup` (recount + `deleteOrphanedPersons`) + identity reconciliation — a convergent pass. The handler bodies are already idempotent (`queueAll` of `SharedSpaceFaceMatch` upserts projections; `recountPersons` sets absolute counts; `deleteOrphanedPersons` / `removePersonFacesByAssetIds` are delete-by-key), so re-driving does not double-count. Determine the affected space set **before** the risky projection work so it is available in the catch block.

**Files:**

- Modify: `server/src/services/shared-space.service.ts:2881-2985` (the four `@OnEvent` handlers) + add one private helper.
- Test: `server/src/services/shared-space.service.spec.ts` (extend the existing `onAlbumAssetsAdd` / `onAlbumAssetsRemove` / `onAssetDelete` / `onAlbumDelete` describe blocks near lines 10505-10642).

**Interfaces:**

- Consumes: `JobName.SharedSpaceFaceMatchAll` (data `{ spaceId }`, already wired in `enum.ts:987`, `types.ts:305/596`, `job.repository.ts:508`); `this.jobRepository.queueAll`; `this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId): Promise<{ spaceId: string; faceRecognitionEnabled: boolean }[]>`.
- Produces: `private async enqueueSpaceFaceProjectionReconcile(spaceIds: string[]): Promise<void>` — dedupes, no-ops on empty, enqueues one `SharedSpaceFaceMatchAll` per space, and swallows+logs its own enqueue failure (never throws).

- [ ] **Step 1: Write the failing tests** — add to `shared-space.service.spec.ts`.

Inside `describe('onAlbumAssetsAdd', ...)`:

```ts
it('enqueues a SharedSpaceFaceMatchAll reconcile per face-enabled space when queueAll fails', async () => {
  const albumId = newUuid();
  const spaceA = newUuid();
  const spaceB = newUuid();
  mocks.sharedSpace.getSpacesLinkedToAlbum.mockResolvedValue([
    { spaceId: spaceA, faceRecognitionEnabled: true },
    { spaceId: spaceB, faceRecognitionEnabled: false },
  ] as any);
  // First queueAll (the face-match enqueue) throws; the reconcile enqueue (2nd call) succeeds.
  mocks.job.queueAll.mockRejectedValueOnce(new Error('transient'));

  await expect(sut.onAlbumAssetsAdd({ albumId, assetIds: [newUuid()] })).resolves.toBeUndefined();

  expect(mocks.job.queueAll).toHaveBeenLastCalledWith([
    { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: spaceA } },
  ]);
});
```

Inside `describe('onAssetDelete', ...)`:

```ts
it('enqueues a SharedSpaceFaceMatchAll reconcile per affected space when recount fails', async () => {
  const spaceA = newUuid();
  const spaceB = newUuid();
  mocks.sharedSpace.recountPersons.mockRejectedValueOnce(new Error('transient'));

  await expect(
    sut.onAssetDelete({
      assetId: newUuid(),
      userId: newUuid(),
      affectedSpacePersons: [
        { spaceId: spaceA, personId: newUuid() },
        { spaceId: spaceB, personId: newUuid() },
      ],
    }),
  ).resolves.toBeUndefined();

  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: spaceA } },
    { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: spaceB } },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t "reconcile"`
Expected: FAIL — the current catch blocks only log, so no `SharedSpaceFaceMatchAll` job is enqueued (`toHaveBeenLastCalledWith` / `toHaveBeenCalledWith` assertion fails).

- [ ] **Step 3: Add the reconcile helper** — insert directly above `onAlbumAssetsAdd` (before the `@OnEvent({ name: 'AlbumAssetsAdd' })` at line 2881).

```ts
// C2: after a transient failure in a best-effort face-people projection handler, enqueue the
// durable per-space reconcile (SharedSpaceFaceMatchAll → paged re-projection + dedup recount +
// deleteOrphanedPersons) so the projection converges. Idempotent (jobId is per-space); never throws.
private async enqueueSpaceFaceProjectionReconcile(spaceIds: string[]): Promise<void> {
  const uniqueSpaceIds = [...new Set(spaceIds)];
  if (uniqueSpaceIds.length === 0) {
    return;
  }
  try {
    await this.jobRepository.queueAll(
      uniqueSpaceIds.map((spaceId) => ({ name: JobName.SharedSpaceFaceMatchAll as const, data: { spaceId } })),
    );
  } catch (error) {
    this.logger.error(
      `Failed to enqueue space face-projection reconcile for spaces ${uniqueSpaceIds.join(', ')}: ${error}`,
    );
  }
}
```

- [ ] **Step 4: Rewrite the four handlers** to determine the affected spaces up-front and reconcile on failure.

Replace `onAlbumAssetsAdd` (2881-2902) with:

```ts
@OnEvent({ name: 'AlbumAssetsAdd' })
async onAlbumAssetsAdd({ albumId, assetIds }: ArgOf<'AlbumAssetsAdd'>): Promise<void> {
  if (assetIds.length === 0) {
    return;
  }
  let faceEnabledSpaceIds: string[];
  try {
    const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
    faceEnabledSpaceIds = spaces.filter((space) => space.faceRecognitionEnabled).map((space) => space.spaceId);
  } catch (error) {
    this.logger.error(`Failed to resolve spaces for album ${albumId} face-people sync: ${error}`);
    return;
  }
  try {
    const jobs = faceEnabledSpaceIds.flatMap((spaceId) =>
      assetIds.map((assetId) => ({ name: JobName.SharedSpaceFaceMatch as const, data: { spaceId, assetId } })),
    );
    if (jobs.length > 0) {
      await this.jobRepository.queueAll(jobs);
    }
  } catch (error) {
    this.logger.error(`Failed to sync space people after adding assets to album ${albumId}: ${error}`);
    await this.enqueueSpaceFaceProjectionReconcile(faceEnabledSpaceIds);
  }
}
```

Replace `onAssetDelete` (2909-2932) with:

```ts
@OnEvent({ name: 'AssetDelete' })
async onAssetDelete({ assetId, affectedSpacePersons }: ArgOf<'AssetDelete'>): Promise<void> {
  if (!affectedSpacePersons || affectedSpacePersons.length === 0) {
    return;
  }
  const spacePersonMap = new Map<string, string[]>();
  for (const { spaceId, personId } of affectedSpacePersons) {
    let ids = spacePersonMap.get(spaceId);
    if (!ids) {
      ids = [];
      spacePersonMap.set(spaceId, ids);
    }
    ids.push(personId);
  }
  try {
    for (const [spaceId, personIds] of spacePersonMap) {
      await this.sharedSpaceRepository.recountPersons(personIds);
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
    }
  } catch (error) {
    this.logger.error(`Failed to sync space people after deleting asset ${assetId}: ${error}`);
    await this.enqueueSpaceFaceProjectionReconcile([...spacePersonMap.keys()]);
  }
}
```

Replace `onAlbumDelete` (2934-2957) with:

```ts
@OnEvent({ name: 'AlbumDelete' })
async onAlbumDelete({ albumId }: ArgOf<'AlbumDelete'>): Promise<void> {
  let faceEnabledSpaceIds: string[];
  try {
    const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
    faceEnabledSpaceIds = spaces.filter((space) => space.faceRecognitionEnabled).map((space) => space.spaceId);
  } catch (error) {
    this.logger.error(`Failed to resolve spaces for album ${albumId} face-people sync: ${error}`);
    return;
  }
  try {
    let anyOrphanWork = false;
    for (const spaceId of faceEnabledSpaceIds) {
      const orphaned = await this.sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId);
      if (orphaned.length === 0) {
        continue;
      }
      await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphaned);
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
      anyOrphanWork = true;
    }
    if (anyOrphanWork) {
      await this.queueSpacePersonMetadataBackfill();
    }
  } catch (error) {
    this.logger.error(`Failed to sync space people after deleting album ${albumId}: ${error}`);
    await this.enqueueSpaceFaceProjectionReconcile(faceEnabledSpaceIds);
  }
}
```

Replace `onAlbumAssetsRemove` (2959-2985) with:

```ts
@OnEvent({ name: 'AlbumAssetsRemove' })
async onAlbumAssetsRemove({ albumId, assetIds }: ArgOf<'AlbumAssetsRemove'>): Promise<void> {
  if (assetIds.length === 0) {
    return;
  }
  let faceEnabledSpaceIds: string[];
  try {
    const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
    faceEnabledSpaceIds = spaces.filter((space) => space.faceRecognitionEnabled).map((space) => space.spaceId);
  } catch (error) {
    this.logger.error(`Failed to resolve spaces for album ${albumId} face-people sync: ${error}`);
    return;
  }
  try {
    let anyOrphanWork = false;
    for (const spaceId of faceEnabledSpaceIds) {
      const orphaned = await this.sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(spaceId, assetIds);
      if (orphaned.length === 0) {
        continue;
      }
      await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphaned);
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
      anyOrphanWork = true;
    }
    if (anyOrphanWork) {
      await this.queueSpacePersonMetadataBackfill();
    }
  } catch (error) {
    this.logger.error(`Failed to sync space people after removing assets from album ${albumId}: ${error}`);
    await this.enqueueSpaceFaceProjectionReconcile(faceEnabledSpaceIds);
  }
}
```

> **Note for the implementer:** the pre-existing tests at 10505-10642 assert the happy-path calls (`queueAll` with the face-match array, `getAssetIdsWithoutOtherSpacePath` called with `(space, ids)`, `deleteOrphanedPersons` per space, `SharedSpacePersonMetadataBackfill` once). The rewrite preserves all of those call shapes and ordering, so those tests stay green. The `onAssetDelete` happy-path test (10607) already resolves `recountPersons` — leave it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS (new reconcile tests + all pre-existing handler tests green).

- [ ] **Step 6: Type-check**

Run: `cd server && pnpm run check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "fix(spaces): reconcile space face-people projection after a failed OnEvent handler"
```

---

## Task 2 — albums-7: gate space-card metrics on `showInTimeline` + add album/library recency arms

**Problem.** `getAssetCount` / `getNewAssetCount` / `getRecentAssets` include the album arm with **no** `showInTimeline` gate, so an off-timeline linked album inflates the card counts vs. the actual space timeline (the timeline only surfaces album assets when `shared_space_album.showInTimeline = true`). `getLastAssetAddedAt` / `getLastContributor` query only `shared_space_asset`, so album/library-driven recency never updates the card.

**Fix.**

1. Add `.where('shared_space_album.showInTimeline', '=', true)` to the album arm of `getAssetCount` (repo ~277), `getRecentAssets` (~775), `getNewAssetCount` (~837).
2. Union library (`asset.createdAt`) and album (`asset.createdAt`, `showInTimeline`-gated) arms into `getLastAssetAddedAt` (~787-798) via a `ts` timestamp, then `max(ts)`.
3. Union library + album arms into `getLastContributor` (~847-863). **Contributor attribution decision:** direct assets attribute to `shared_space_asset.addedById` (the space contributor); library/album assets have no per-asset space-contributor, so attribute to `asset.ownerId` (the asset owner) — the closest defensible proxy. Album arm `showInTimeline`-gated.

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` — `getAssetCount` (244-284), `getRecentAssets` (736-784), `getNewAssetCount` (800-844), `getLastAssetAddedAt` (786-798), `getLastContributor` (846-863).
- Test (MEDIUM, CI-deferred): `server/test/medium/specs/repositories/shared-space.repository.spec.ts` — extend `getAssetCount` (818), `getRecentAssets` (976), `getNewAssetCount` (1027), and the `space activity from direct asset links` block (746) describes. The spec already has a `linkAlbum`-style helper at line 182 taking `{ showInTimeline }`.

**Interfaces:**

- Consumes: `visibleSpaceAssetVisibilities`, `AssetType.Image` (already imported in this file). No new imports.
- Produces: unchanged method signatures — `getLastAssetAddedAt(spaceId): Promise<Date | undefined>`, `getLastContributor(spaceId, since): Promise<{ id: string; name: string } | undefined>`.

- [ ] **Step 1: Write the failing medium tests.**

In `describe('getAssetCount', ...)`:

```ts
it('excludes album assets whose link is off-timeline (showInTimeline = false)', async () => {
  const { user } = await ctx.newUser();
  const space = await createSpace(user.id);
  const album = await createAlbumWithAsset(user.id); // helper: album + 1 non-deleted timeline asset
  await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id, showInTimeline: false } as any);

  const count = await sut.getAssetCount(space.id);

  expect(count).toBe(0);
});
```

In the recency describe (near 746):

```ts
it('getLastAssetAddedAt reflects the most recent album asset createdAt for an on-timeline album', async () => {
  const { user } = await ctx.newUser();
  const space = await createSpace(user.id);
  const album = await createAlbumWithAssetAt(user.id, new Date('2025-06-01T00:00:00.000Z'));
  await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id, showInTimeline: true } as any);

  const lastAddedAt = await sut.getLastAssetAddedAt(space.id);

  expect(lastAddedAt?.toISOString()).toBe('2025-06-01T00:00:00.000Z');
});

it('getLastContributor attributes an album asset to the asset owner', async () => {
  const { user } = await ctx.newUser();
  const space = await createSpace(user.id);
  const album = await createAlbumWithAssetAt(user.id, new Date('2025-06-01T00:00:00.000Z'));
  await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id, showInTimeline: true } as any);

  const contributor = await sut.getLastContributor(space.id, new Date('2025-01-01T00:00:00.000Z'));

  expect(contributor?.id).toBe(user.id);
});
```

> The spec file already has `createSpace` / album+asset seed helpers around lines 182-205; adapt `createAlbumWithAsset` / `createAlbumWithAssetAt` from the existing seed helpers (they set `asset.createdAt`). If a helper is missing, add a thin one mirroring the existing `addAssetToSpace` pattern.

- [ ] **Step 2: (CI-deferred) Note the expected red.** Medium tests need testcontainers (Docker is down). Record: these fail today because `getAssetCount` counts the off-timeline album asset (returns 1, not 0) and `getLastAssetAddedAt`/`getLastContributor` ignore the album arm (return `undefined`). They will be run at the final gate/CI.

- [ ] **Step 3: Add the `showInTimeline` gate to the three count/preview album arms.**

In `getAssetCount`, in the album `.union(...)` (the block starting `this.db.selectFrom('shared_space_album')` at ~266), add after `.where('shared_space_album.spaceId', '=', spaceId)`:

```ts
              .where('shared_space_album.showInTimeline', '=', true)
```

Apply the identical single-line addition to the album `.union(...)` arms in `getRecentAssets` (~771, after `.where('shared_space_album.spaceId', '=', spaceId)`) and `getNewAssetCount` (~833, after `.where('shared_space_album.spaceId', '=', spaceId)`).

- [ ] **Step 4: Rewrite `getLastAssetAddedAt`** (786-798) to union all three arms:

```ts
@GenerateSql({ params: [DummyValue.UUID] })
async getLastAssetAddedAt(spaceId: string): Promise<Date | undefined> {
  const result = await this.db
    .selectFrom(
      this.db
        .selectFrom('shared_space_asset')
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select('shared_space_asset.addedAt as ts')
        .where('shared_space_asset.spaceId', '=', spaceId)
        .where('asset.deletedAt', 'is', null)
        .where('asset.isOffline', '=', false)
        .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
        .union(
          this.db
            .selectFrom('shared_space_library')
            .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
            .select('asset.createdAt as ts')
            .where('shared_space_library.spaceId', '=', spaceId)
            .where('asset.deletedAt', 'is', null)
            .where('asset.isOffline', '=', false)
            .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
        )
        .union(
          this.db
            .selectFrom('shared_space_album')
            .innerJoin('album', (j) =>
              j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
            )
            .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
            .innerJoin('asset', 'asset.id', 'album_asset.assetId')
            .select('asset.createdAt as ts')
            .where('shared_space_album.spaceId', '=', spaceId)
            .where('shared_space_album.showInTimeline', '=', true)
            .where('asset.deletedAt', 'is', null)
            .where('asset.isOffline', '=', false)
            .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
        )
        .as('combined'),
    )
    .select((eb) => eb.fn.max('combined.ts').as('lastAddedAt'))
    .executeTakeFirst();
  return result?.lastAddedAt ?? undefined;
}
```

- [ ] **Step 5: Rewrite `getLastContributor`** (846-863) to union all three arms then resolve the user:

```ts
@GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE] })
async getLastContributor(spaceId: string, since: Date): Promise<{ id: string; name: string } | undefined> {
  const contributions = this.db
    .selectFrom('shared_space_asset')
    .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
    .select(['shared_space_asset.addedById as userId', 'shared_space_asset.addedAt as ts'])
    .where('shared_space_asset.spaceId', '=', spaceId)
    .where('shared_space_asset.addedAt', '>', since)
    .where('asset.deletedAt', 'is', null)
    .where('asset.isOffline', '=', false)
    .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
    .union(
      this.db
        .selectFrom('shared_space_library')
        .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
        .select(['asset.ownerId as userId', 'asset.createdAt as ts'])
        .where('shared_space_library.spaceId', '=', spaceId)
        .where('asset.createdAt', '>', since)
        .where('asset.deletedAt', 'is', null)
        .where('asset.isOffline', '=', false)
        .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
    )
    .union(
      this.db
        .selectFrom('shared_space_album')
        .innerJoin('album', (j) =>
          j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
        )
        .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
        .innerJoin('asset', 'asset.id', 'album_asset.assetId')
        .select(['asset.ownerId as userId', 'asset.createdAt as ts'])
        .where('shared_space_album.spaceId', '=', spaceId)
        .where('shared_space_album.showInTimeline', '=', true)
        .where('asset.createdAt', '>', since)
        .where('asset.deletedAt', 'is', null)
        .where('asset.isOffline', '=', false)
        .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
    );

  return this.db
    .selectFrom(contributions.as('contrib'))
    .innerJoin('user', (join) => join.onRef('user.id', '=', 'contrib.userId').on('user.deletedAt', 'is', null))
    .orderBy('contrib.ts', 'desc')
    .select(['user.id', 'user.name'])
    .limit(1)
    .executeTakeFirst();
}
```

- [ ] **Step 6: Type-check**

Run: `cd server && pnpm run check`
Expected: no errors (Kysely validates the union column shapes: each union arm selects the same aliased columns/types).

- [ ] **Step 7: Commit** (medium `.sql` doc drift + medium test runs are CI-deferred)

```bash
git add server/src/repositories/shared-space.repository.ts server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "fix(spaces): match space-card metrics to the timeline (showInTimeline gate + album/library recency)"
```

---

## Task 3 — correctness-7: repair the `revert-to-immich.sql` guard **and** the migration DELETE list

**Problem (two gaps, both in `scripts/revert-to-immich.sql`).**

1. **Step-9 guard (cited).** The `fork_tables_left` sanity-check IN-list (lines 419-430) omits **7** fork tables that step 2 drops: `shared_space_face_match_backfill_target`, `shared_space_library_asset_audit`, `shared_space_album_asset_audit`, `shared_space_album_user`, `shared_space_album_user_audit`, `shared_space_album_audit`, `shared_space_album`. The guard therefore never verifies these dropped.
2. **Step-8 `kysely_migrations` DELETE list (newly found, more severe).** It omits the two slice-8/9 fork migrations `1782000000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger` and `1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId` (verified: every other `migrations-gallery/*.ts` file is present). Because the step-9 `fork_rows_left` guard matches `name LIKE '%SharedSpace%'`, those two undeleted rows make the **whole revert script abort** ("Gallery row(s) still present … aborting") on any DB that ran them.

**Fix.** Add the 7 tables to the step-9 IN-list and the 2 migration names to the step-8 DELETE list. Add a Vitest test that parses the script and enforces both invariants going forward.

**Files:**

- Modify: `scripts/revert-to-immich.sql` (step 8 list ~322-379; step 9 guard IN-list ~419-430).
- Test (UNIT, runs locally — pure file parse, no DB): create `server/test/revert-to-immich.spec.ts`.

- [ ] **Step 1: Write the failing test** — `server/test/revert-to-immich.spec.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..');
const sqlPath = join(repoRoot, 'scripts', 'revert-to-immich.sql');
const migrationsGalleryDir = join(repoRoot, 'server', 'src', 'schema', 'migrations-gallery');

const sql = readFileSync(sqlPath, 'utf8');

// Only the shared_space_* / face_match fork tables the album slices added — this is a targeted
// regression guard, not an exhaustive drop-vs-guard differ.
const droppedForkTables = [...sql.matchAll(/DROP TABLE IF EXISTS "([^"]+)" CASCADE/g)]
  .map((m) => m[1])
  .filter((name) => name.startsWith('shared_space'));

// The step-9 guard IN-list is the parenthesised block after `tablename IN (`.
const guardBlock = sql.slice(sql.indexOf('AND tablename IN ('));
const guardTables = [...guardBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe('revert-to-immich.sql', () => {
  it('lists every dropped shared_space fork table in the step-9 fork_tables_left guard', () => {
    const missing = droppedForkTables.filter((t) => !guardTables.includes(t));
    expect(missing).toEqual([]);
  });

  it('lists every migrations-gallery migration in the step-8 kysely_migrations DELETE block', () => {
    const migrationNames = readdirSync(migrationsGalleryDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, ''));
    const missing = migrationNames.filter((name) => !sql.includes(`'${name}'`));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test -- --run test/revert-to-immich.spec.ts`
Expected: FAIL — first test lists the 7 missing tables; second test lists `1782000000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger` and `1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId`.

- [ ] **Step 3: Add the two missing migration names to the step-8 DELETE list.** In `scripts/revert-to-immich.sql`, replace the line `   '1781181889688-SharedSpaceLibraryAssetAuditTable',` (~362) with:

```sql
   '1781181889688-SharedSpaceLibraryAssetAuditTable',
   '1782000000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger',
   '1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId',
```

- [ ] **Step 4: Add the 7 missing tables to the step-9 guard IN-list.** Replace the IN-list body (lines ~419-430) so it reads:

```sql
     AND tablename IN (
       'library_user', 'library_audit', 'library_asset_audit',
       'shared_space_library_audit', 'shared_space_library',
       'shared_space_library_asset_audit',
       'shared_space_activity', 'shared_space_person_alias',
       'shared_space_person_face', 'shared_space_person',
       'shared_space_face_match_backfill_target',
       'shared_space_asset_audit', 'shared_space_member_audit',
       'shared_space_audit', 'shared_space_asset', 'shared_space_member',
       'shared_space_album', 'shared_space_album_audit',
       'shared_space_album_user', 'shared_space_album_user_audit',
       'shared_space_album_asset_audit',
       'face_identity_face', 'face_identity',
       'shared_space', 'user_group_member', 'user_group',
       'classification_prompt_embedding', 'classification_category',
       'storage_migration_log', 'asset_duplicate_checksum'
     );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test -- --run test/revert-to-immich.spec.ts`
Expected: PASS (both invariants hold).

- [ ] **Step 6: Commit**

```bash
git add scripts/revert-to-immich.sql server/test/revert-to-immich.spec.ts
git commit -m "fix(spaces): repair revert-to-immich guard list and album-slice migration DELETE list"
```

---

## Task 4 — gaps-7: composite audit indexes for the member-join sync fan-out

**Problem.** Joining a space inserts a grant per (member × album) and the `getDeletes` scans on the album audit tables lack a composite index matching their access pattern:

- `SharedSpaceAlbumToAssetSync.getDeletes` (`sync.repository.ts:1612-1626`) scans `shared_space_album_asset_audit` by `albumId IN (…) AND id > ack AND id < nowId`. Current indexes are single-column (`albumId`, `assetId`, `deletedAt`) — a composite `(albumId, id)` serves the filter-by-album + id-range-scan directly.
- `SharedSpaceAlbumSync.getDeletes` (`sync.repository.ts:1486-1490`) scans `shared_space_album_user_audit` by `userId = ? AND id range`. A composite `(userId, id)` serves the equality + range without a sort.

Both indexes are cheap; add them regardless. **Measurement note (record in commit body):** at target scale (large space, many linked albums) the delete-scan is `Index Cond: (albumId = ANY(...) AND id > ack)`; without the composite it degrades to a bitmap-OR of the single-column `albumId` index plus an in-memory sort on `id`. The composite makes it a single ordered range scan. No local DB to `EXPLAIN` against (Docker down) — validated by CI medium timing + the plan-tested query shape above.

**Index registration pattern (confirmed):** the fork declares composite indexes with the class-level `@Index({ name, columns })` decorator from `@immich/sql-tools` (e.g. `asset-face.table.ts:29`) **and** a matching `migrations-gallery/` migration. A plain multi-column index is representable by the decorator, so — unlike the expression index in `1778600000000-SortSpacePeopleByNameIndex.ts` — **no `migration_overrides` row is needed**. `functions.ts` is not involved. No `revert-to-immich.sql` table/column entry is needed (the indexes live on fork tables already dropped `CASCADE`), but the new migration **name must be added to the revert step-8 DELETE list**.

**Files:**

- Modify: `server/src/schema/tables/shared-space-album-asset-audit.table.ts` (add `@Index` + import).
- Modify: `server/src/schema/tables/shared-space-album-user-audit.table.ts` (add `@Index` + import).
- Create: `server/src/schema/migrations-gallery/1782300000000-AddSharedSpaceAlbumAuditSyncIndexes.ts`.
- Modify: `scripts/revert-to-immich.sql` (step-8 DELETE list — add the new migration name; the Task-3 regression test enforces this).

- [ ] **Step 1: Add the `@Index` decorator to the album-asset audit table.** In `shared-space-album-asset-audit.table.ts`, change the import line 1 to include `Index`:

```ts
import { Column, CreateDateColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
```

and add the class-level decorator directly above `export class SharedSpaceAlbumAssetAuditTable {`:

```ts
@Index({ name: 'shared_space_album_asset_audit_albumId_id_idx', columns: ['albumId', 'id'] })
```

- [ ] **Step 2: Add the `@Index` decorator to the album-user audit table.** In `shared-space-album-user-audit.table.ts`, change the import line 1 to include `Index`:

```ts
import { AfterInsertTrigger, Column, CreateDateColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
```

and add, directly above `export class SharedSpaceAlbumUserAuditTable {` (after the `@AfterInsertTrigger({...})` decorator):

```ts
@Index({ name: 'shared_space_album_user_audit_userId_id_idx', columns: ['userId', 'id'] })
```

- [ ] **Step 3: Create the migration** `server/src/schema/migrations-gallery/1782300000000-AddSharedSpaceAlbumAuditSyncIndexes.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "shared_space_album_asset_audit_albumId_id_idx" ON "shared_space_album_asset_audit" ("albumId", "id")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_user_audit_userId_id_idx" ON "shared_space_album_user_audit" ("userId", "id")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "shared_space_album_asset_audit_albumId_id_idx"`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_album_user_audit_userId_id_idx"`.execute(db);
}
```

- [ ] **Step 4: Register the migration in the revert script.** In `scripts/revert-to-immich.sql` step-8 DELETE list, add after the `'1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId',` line (added in Task 3):

```sql
   '1782300000000-AddSharedSpaceAlbumAuditSyncIndexes',
```

- [ ] **Step 5: Type-check + run the revert regression test.**

Run: `cd server && pnpm run check && pnpm test -- --run test/revert-to-immich.spec.ts`
Expected: tsc clean; the step-8 invariant test now includes and passes for `1782300000000-AddSharedSpaceAlbumAuditSyncIndexes`.

> **CI-deferred:** applying the migration on a fresh + already-migrated DB and the `make sql` schema-diff (decorator ↔ migration match, no `migration_overrides` needed) run at the final gate. The `@Index` decorator makes the generated expected schema include these composite indexes so the `should have no schema drift` sql-tools check passes.

- [ ] **Step 6: Commit**

```bash
git add server/src/schema/tables/shared-space-album-asset-audit.table.ts \
        server/src/schema/tables/shared-space-album-user-audit.table.ts \
        server/src/schema/migrations-gallery/1782300000000-AddSharedSpaceAlbumAuditSyncIndexes.ts \
        scripts/revert-to-immich.sql
git commit -m "perf(spaces): add composite audit indexes for the member-join sync delete-scan"
```

---

## Task 5 — C3 (investigation → **LEAK FOUND**): redact cross-space identifiers from the `PersonMerge` activity payload

**Resolution: FIX + test.** Investigation of every `SharedSpaceActivityType.data` blob found 13 of 14 shapes safe (space-scoped ids/names/counts every member can already see; actor name/email matches the album-feed precedent and `GET :id/members`). The one **low-severity leak**: a **propagated** `PersonMerge` activity (written by `identity-merge-propagation.service.ts:589-607` `buildActivityPayload` when a user merges people in their personal library or another space) carries `affectedSpaceIds`, `originatingSpaceId`, `targetProfileId`, `sourceProfileIds`, `targetIdentityId`, `sourceIdentityIds` into **every affected space's** feed. `getActivities` (`shared-space.service.ts:796`) passes `a.data` through raw, so any member of any of those spaces sees cross-space + personal-library UUIDs. Opaque, non-actionable ids (no names/emails/paths), hence low severity — but a genuine cross-tenant metadata disclosure the in-space direct merge (`{ personName, count }`) does not make.

**Fix (read-time redaction, minimal blast radius).** Redact in `getActivities`' map, not at the write site — keeps other consumers/tests of the stored blob untouched and localises the change to the space feed. Whitelist the member-safe keys for `PersonMerge` only.

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — `getActivities` map (793-803) + a private helper. `SharedSpaceActivityType` is already imported (used across the file).
- Test: `server/src/services/shared-space.service.spec.ts` — new `describe('getActivities redaction', ...)`.

**Interfaces:**

- Produces: `private redactActivityData(type: SharedSpaceActivityType, data: Record<string, unknown>): Record<string, unknown>` — for `PersonMerge` returns only `{ personName?, count?, activityRole? }` (present-only); otherwise returns `data` unchanged.

- [ ] **Step 1: Write the failing test** in `shared-space.service.spec.ts`:

```ts
describe('getActivities redaction', () => {
  it('strips cross-space and personal identity ids from PersonMerge activity data', async () => {
    const auth = factory.auth();
    const spaceId = newUuid();
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ spaceId, userId: auth.user.id }));
    mocks.sharedSpace.getActivities.mockResolvedValue([
      {
        id: newUuid(),
        type: SharedSpaceActivityType.PersonMerge,
        data: {
          personName: 'Alex',
          count: 2,
          activityRole: 'origin',
          affectedSpaceIds: [newUuid(), newUuid()],
          originatingSpaceId: newUuid(),
          targetProfileId: newUuid(),
          sourceProfileIds: [newUuid()],
          targetIdentityId: newUuid(),
          sourceIdentityIds: [newUuid()],
        },
        createdAt: new Date(),
        userId: auth.user.id,
        name: 'Owner',
        email: 'owner@example.com',
        profileImagePath: '',
        avatarColor: null,
      },
    ] as any);

    const [activity] = await sut.getActivities(auth, spaceId, {});

    expect(activity.data).toEqual({ personName: 'Alex', count: 2, activityRole: 'origin' });
    expect(activity.data).not.toHaveProperty('affectedSpaceIds');
    expect(activity.data).not.toHaveProperty('sourceProfileIds');
    expect(activity.data).not.toHaveProperty('targetIdentityId');
  });

  it('passes non-PersonMerge activity data through unchanged', async () => {
    const auth = factory.auth();
    const spaceId = newUuid();
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ spaceId, userId: auth.user.id }));
    mocks.sharedSpace.getActivities.mockResolvedValue([
      {
        id: newUuid(),
        type: SharedSpaceActivityType.AlbumLink,
        data: { albumId: newUuid(), albumName: 'Trip' },
        createdAt: new Date(),
        userId: auth.user.id,
        name: 'Owner',
        email: 'owner@example.com',
        profileImagePath: '',
        avatarColor: null,
      },
    ] as any);

    const [activity] = await sut.getActivities(auth, spaceId, {});

    expect(activity.data).toHaveProperty('albumId');
    expect(activity.data).toHaveProperty('albumName');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t "redaction"`
Expected: FAIL — the first test fails because `activity.data` still contains `affectedSpaceIds`/`sourceProfileIds`/`targetIdentityId` (raw pass-through).

- [ ] **Step 3: Add the redaction helper** (place next to `getActivities`, e.g. directly above it at ~784):

```ts
// C3: the space activity feed is readable by any member (SharedSpaceRead + membership). Most
// activity `data` blobs are space-scoped ids/names members can already see, but a *propagated*
// PersonMerge (written by identity-merge-propagation when a user merges people in another space
// or their personal library) carries cross-space + personal-library UUIDs. Redact PersonMerge
// down to the member-safe fields the in-space direct merge already uses.
private redactActivityData(
  type: SharedSpaceActivityType,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (type !== SharedSpaceActivityType.PersonMerge) {
    return data;
  }
  const safe: Record<string, unknown> = {};
  for (const key of ['personName', 'count', 'activityRole'] as const) {
    if (data[key] !== undefined) {
      safe[key] = data[key];
    }
  }
  return safe;
}
```

- [ ] **Step 4: Apply it in the `getActivities` map** — change line 796 (`data: a.data as Record<string, unknown>,`) to:

```ts
      data: this.redactActivityData(a.type as SharedSpaceActivityType, a.data as Record<string, unknown>),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `cd server && pnpm run check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "fix(spaces): redact cross-space identifiers from the space activity PersonMerge payload"
```

---

## Task 6 — C5 (investigation → **SAFE**): pin album-arm trash + stack parity with regression tests

**Resolution: proven SAFE → committed pinning tests (no code change).** The album arm is not a divergence surface. Trash: every count/preview album arm carries `asset.deletedAt IS NULL` symmetrically with the direct/library arms, and the member grid (`asset.repository.ts` `getTimeBucket` / `withTimeBucketAssetFilters`) filters trash at the single `asset` root before the album `EXISTS` (`asset.repository.ts:253,1352`). Stack: the grid collapses stacks at the `asset` root (`withTimeBucketAssetFilters:352-357`, `getTimeBucket:1458-1468`) for every arm, matching the normal (non-space) album grid which uses the same `getTimeBucket` `albumId` path. The album-only extra predicates are the intended `album.deletedAt IS NULL` invariant + `showInTimeline` gate. Deliverable: lock this in so a future album-arm rewrite can't silently start over/under-surfacing.

**Files:**

- Test (MEDIUM, CI-deferred): `server/test/medium/specs/repositories/shared-space.repository.spec.ts` (album-arm count parity) + `server/test/medium/specs/repositories/asset.repository.spec.ts` (grid trash/stack parity). Use the album+asset seed helpers already in the shared-space medium spec.

- [ ] **Step 1: Write the pinning tests (trash).** In the shared-space repository medium spec:

```ts
describe('C5 album-arm trash parity', () => {
  it('a soft-deleted album asset drops out of getAssetCount / getRecentAssets / isAssetInSpace', async () => {
    const { user } = await ctx.newUser();
    const space = await createSpace(user.id);
    const album = await createAlbumWithAsset(user.id); // 1 timeline asset
    const assetId = /* the seeded album asset id */;
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id, showInTimeline: true } as any);
    expect(await sut.getAssetCount(space.id)).toBe(1);

    await ctx.get(AssetRepository).update({ id: assetId, deletedAt: new Date() });

    expect(await sut.getAssetCount(space.id)).toBe(0);
    expect(await sut.isAssetInSpace(space.id, assetId)).toBe(false);
    expect(await sut.getRecentAssets(space.id, 4)).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the pinning tests (grid trash + stack parity).** In the asset repository medium spec, seed an album linked into a space (via the shared-space helpers), then assert the space `getTimeBucket(albumId)` / space-arm bucket:
  - a soft-deleted album asset is absent from the space timeline bucket (mirror the existing direct-arm trash test);
  - a stacked **child** album asset is collapsed under its primary in the space timeline bucket when `withStacked: true` — request the same bucket via the direct arm and via a normal (non-space) album grid and assert identical asset-id sets.

```ts
it('collapses a stacked child album asset in the space timeline bucket (parity with direct + normal album)', async () => {
  // seed: album with primary P and child C stacked (stack.primaryAssetId = P), both in a space-linked album
  // request the space album bucket with { withStacked: true }
  // assert returned ids === [P] and equal to the direct-arm and normal-album-grid results for the same stack
});
```

> The exact seed helpers (`newAssetStack`, `newAlbumAsset`) exist in the medium `test/medium/specs/repositories/asset.repository.spec.ts` fixtures; reuse them and route membership through the shared-space seed helper.

- [ ] **Step 3: (CI-deferred) Run at the final gate.** These are green on first run (the behaviour is already correct — they are regression pins, not red→green). Note in the commit body that C5 is resolved **SAFE** and the tests pin the parity.

Run at CI: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts test/medium/specs/repositories/asset.repository.spec.ts`
Expected: PASS.

- [ ] **Step 4: Type-check**

Run: `cd server && pnpm run check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/test/medium/specs/repositories/shared-space.repository.spec.ts \
        server/test/medium/specs/repositories/asset.repository.spec.ts
git commit -m "test(spaces): pin album-arm trash + stack parity on space read surfaces (C5 resolved safe)"
```

---

## Task 7 — C6 (investigation → **SAFE/CONSISTENT**): pin the partner × space-linked visibility invariant

**Resolution: proven SAFE → committed pinning test (no code change).** The partner arm and the space arm are two independent grants unioned at the access-orchestration layer (`utils/access.ts:116-124` `AssetRead`, dup'd for `AssetView`/`AssetDownload`) — `setUnion(owner, album, partner, space)`. Partner access (`access.repository.ts:260-265`) grants **Timeline + Hidden** (upstream behaviour — partners DO see the owner's Hidden; they never see Archive or Locked). The space gate (`shared-space-album-scope.ts:42-47`) grants **Timeline + Archive**, stripping Hidden/Locked. Resolved union for a user P who is both O's partner and a member of a space O linked X into: Timeline→visible (both); Archive→visible via **space**; Hidden→visible via **partner** (space-independent, pre-existing); **Locked→blocked by both arms**. `Locked` is the only truly-private tier and it never leaks through the union — the load-bearing safety property. This is fully consistent with slice-4 **security-7**, which had to suppress the space-driven library purge for partners so a partner+member doesn't lose a still-entitled Hidden asset (`sync.repository.ts:1341-1354`).

**Files:**

- Test (MEDIUM, CI-deferred): `server/test/medium/specs/repositories/access.repository.spec.ts` (real visibility predicates). If the access medium spec lacks a partner+space fixture, add one mirroring the existing partner + shared-space seed helpers.

- [ ] **Step 1: Write the invariant test.** Seed: owner O, user P as O's partner AND a member of space S; O links a library/album containing asset X into S.

```ts
describe('C6 partner × space-linked visibility invariant', () => {
  const seed = async (visibility: AssetVisibility) => {
    // O owns X (visibility); P is O's partner (sharedById=O, sharedWithId=P) AND a member of space S;
    // X is reachable in S via a linked album/library. Return { P, X }.
  };

  it('Locked X is blocked by BOTH arms (the private tier never leaks through the union)', async () => {
    const { P, X } = await seed(AssetVisibility.Locked);
    expect(await sut.asset.checkAlbumAccess(P.id, new Set([X.id]))).toEqual(new Set()); // n/a arm
    expect(await sut.asset.checkPartnerAccess(P.id, new Set([X.id]))).toEqual(new Set());
    expect(await sut.asset.checkSpaceAccess(P.id, new Set([X.id]))).toEqual(new Set());
  });

  it('Hidden X is granted via the PARTNER arm (attributable to partner-sharing, not the space)', async () => {
    const { P, X } = await seed(AssetVisibility.Hidden);
    expect(await sut.asset.checkPartnerAccess(P.id, new Set([X.id]))).toEqual(new Set([X.id]));
    expect(await sut.asset.checkSpaceAccess(P.id, new Set([X.id]))).toEqual(new Set()); // space strips Hidden
  });

  it('Archive X is granted via the SPACE arm (partner default cannot see Archive)', async () => {
    const { P, X } = await seed(AssetVisibility.Archive);
    expect(await sut.asset.checkSpaceAccess(P.id, new Set([X.id]))).toEqual(new Set([X.id]));
    expect(await sut.asset.checkPartnerAccess(P.id, new Set([X.id]))).toEqual(new Set());
  });
});
```

> Adjust to the actual `AccessRepository` method names/signatures used in the existing access medium spec (`sut.asset.checkPartnerAccess(userId, ids)`, `checkSpaceAccess`, `checkAlbumAccess`). The load-bearing assertion is the **Locked** one.

- [ ] **Step 2: (CI-deferred) Run at the final gate.** Green on first run (pins existing correct behaviour). Note C6 resolved **SAFE/CONSISTENT** in the commit body.

Run at CI: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/access.repository.spec.ts`
Expected: PASS.

- [ ] **Step 3: Type-check**

Run: `cd server && pnpm run check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/test/medium/specs/repositories/access.repository.spec.ts
git commit -m "test(spaces): pin partner × space-linked visibility (Locked blocked, Hidden via partner) (C6 resolved safe)"
```

---

## Task 8 — security-9: validate shared-space route params (400 not 500 on non-UUID)

**Problem.** Pre-existing shared-space routes take raw `@Param('x') x: string` path params, so a non-UUID value reaches `asUuid`/Postgres and raises `22P02` → **500** instead of **400**. Cited: `shared-space.controller.ts:167,209-210,363,410-412`. These are representative of the whole raw-string-param class in the file; fix them all for consistency (the album routes already use `SharedSpaceAlbumParamDto`). **Verified:** every entity behind these params (`shared_space.id`, `user.id`, `shared_space_person.id`, `asset_face.id` for `faceId`, `library.id`) is a `uuidv4` id in Immich (`person.controller.ts` validates person `:id` with `UUIDParamDto` = `z.uuidv4()`; `faceId` is used as `assetFaceId` = an upstream `asset_face.id`), so `z.uuidv4()` will **not** 400 legitimate requests.

**Fix.** Add four zod param DTOs (mirroring `SharedSpaceAlbumParamSchema`) and convert every raw-string-param handler to a validated `@Param() { … }: …ParamDto`. Single-`{id}` routes reuse the existing `UUIDParamDto`.

**Files:**

- Modify: `server/src/dtos/shared-space.dto.ts` — add 4 schemas + 4 DTO classes (near the existing `SharedSpaceAlbumParamSchema` at 137 and the DTO exports at 200).
- Modify: `server/src/controllers/shared-space.controller.ts` — convert the raw-string routes; add the new DTOs to the existing `src/dtos/shared-space.dto` import group.
- Test (UNIT, local): `server/src/dtos/shared-space.dto.spec.ts` (new) — the zod schemas reject non-UUIDs; **e2e (CI-deferred)**: extend `e2e/src/api/specs/shared-space*.e2e-spec.ts` with a 400 assertion.

**Interfaces:**

- Produces (in `shared-space.dto.ts`): `SharedSpaceMemberParamDto` (`{ id, userId }`), `SharedSpacePersonParamDto` (`{ id, personId }`), `SharedSpacePersonFaceParamDto` (`{ id, personId, faceId }`), `SharedSpaceLibraryParamDto` (`{ id, libraryId }`) — all `z.uuidv4()` fields.

- [ ] **Step 1: Write the failing schema unit test** — `server/src/dtos/shared-space.dto.spec.ts`:

```ts
import {
  SharedSpaceLibraryParamDto,
  SharedSpaceMemberParamDto,
  SharedSpacePersonFaceParamDto,
  SharedSpacePersonParamDto,
} from 'src/dtos/shared-space.dto';
import { describe, expect, it } from 'vitest';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('shared-space param DTOs', () => {
  it('SharedSpaceMemberParamDto rejects a non-UUID userId', () => {
    expect(SharedSpaceMemberParamDto.schema.safeParse({ id: uuid, userId: 'not-a-uuid' }).success).toBe(false);
    expect(SharedSpaceMemberParamDto.schema.safeParse({ id: uuid, userId: uuid }).success).toBe(true);
  });

  it('SharedSpacePersonParamDto rejects a non-UUID personId', () => {
    expect(SharedSpacePersonParamDto.schema.safeParse({ id: uuid, personId: 'nope' }).success).toBe(false);
  });

  it('SharedSpacePersonFaceParamDto rejects a non-UUID faceId', () => {
    expect(SharedSpacePersonFaceParamDto.schema.safeParse({ id: uuid, personId: uuid, faceId: 'nope' }).success).toBe(
      false,
    );
  });

  it('SharedSpaceLibraryParamDto rejects a non-UUID libraryId', () => {
    expect(SharedSpaceLibraryParamDto.schema.safeParse({ id: uuid, libraryId: 'nope' }).success).toBe(false);
  });
});
```

> `createZodDto` exposes the underlying schema as `.schema` (nestjs-zod). If the local nestjs-zod version differs, use the exported `*Schema` const instead — but keep the schemas exported from the module (Step 2 exports the DTO classes; also export the schemas if `.schema` is unavailable).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test -- --run src/dtos/shared-space.dto.spec.ts`
Expected: FAIL — the four DTOs do not exist yet (import error).

- [ ] **Step 3: Add the schemas + DTO classes** to `shared-space.dto.ts`. After `SharedSpaceAlbumParamSchema` (137-140) add:

```ts
const SharedSpaceMemberParamSchema = z.object({
  id: z.uuidv4(),
  userId: z.uuidv4(),
});

const SharedSpacePersonParamSchema = z.object({
  id: z.uuidv4(),
  personId: z.uuidv4(),
});

const SharedSpacePersonFaceParamSchema = z.object({
  id: z.uuidv4(),
  personId: z.uuidv4(),
  faceId: z.uuidv4(),
});

const SharedSpaceLibraryParamSchema = z.object({
  id: z.uuidv4(),
  libraryId: z.uuidv4(),
});
```

After `export class SharedSpaceAlbumParamDto …` (200) add:

```ts
export class SharedSpaceMemberParamDto extends createZodDto(SharedSpaceMemberParamSchema) {}
export class SharedSpacePersonParamDto extends createZodDto(SharedSpacePersonParamSchema) {}
export class SharedSpacePersonFaceParamDto extends createZodDto(SharedSpacePersonFaceParamSchema) {}
export class SharedSpaceLibraryParamDto extends createZodDto(SharedSpaceLibraryParamSchema) {}
```

- [ ] **Step 4: Import the new DTOs in the controller.** In `shared-space.controller.ts`, add `SharedSpaceLibraryParamDto`, `SharedSpaceMemberParamDto`, `SharedSpacePersonFaceParamDto`, `SharedSpacePersonParamDto` to the `from 'src/dtos/shared-space.dto'` import block (36-54, alphabetical).

- [ ] **Step 5: Convert every raw-string-param handler.** Apply these signature edits (body calls stay the same — they pass `id`, `userId`, `personId`, `faceId`, `libraryId`):
  - `updateMemberTimeline` (165-169), `updateMemberPreferences` (180-185), `deduplicateSpacePeople` (363): change `@Param('id') id: string` → `@Param() { id }: UUIDParamDto`.
  - `updateMember` (207-213), `updateMemberMetadataContribution` (223-229), `removeMember` (240): change the `@Param('id') id: string, @Param('userId') userId: string` pair → `@Param() { id, userId }: SharedSpaceMemberParamDto`.
  - `getSpacePersonStatistics` (374-378), `getSpacePersonFaces` (389-395), `updateSpacePersonRepresentativeFace` (424-429), `getSpacePerson` (440-444), `getSpacePersonThumbnail` (456-462), `updateSpacePerson` (473-479), `deleteSpacePerson` (490-495), `mergeSpacePeople` (506-512), `setSpacePersonAlias` (523-528), `deleteSpacePersonAlias` (540-545), `getSpacePersonAssets` (555-560): change the `@Param('id') id: string, @Param('personId') personId: string` pair → `@Param() { id, personId }: SharedSpacePersonParamDto`.
  - `getSpacePersonFaceThumbnail` (406-414): change the `@Param('id') id: string, @Param('personId') personId: string, @Param('faceId') faceId: string` triple → `@Param() { id, personId, faceId }: SharedSpacePersonFaceParamDto`.
  - `unlinkLibrary` (587-592): change `@Param('libraryId') libraryId: string` (keep `@Param() { id }: UUIDParamDto` → replace both) → `@Param() { id, libraryId }: SharedSpaceLibraryParamDto`.

  Example (`updateMember`):

```ts
  updateMember(
    @Auth() auth: AuthDto,
    @Param() { id, userId }: SharedSpaceMemberParamDto,
    @Body() dto: SharedSpaceMemberUpdateDto,
  ): Promise<SharedSpaceMemberResponseDto> {
    return this.service.updateMember(auth, id, userId, dto);
  }
```

Example (`getSpacePersonFaceThumbnail`):

```ts
  async getSpacePersonFaceThumbnail(
    @Res() res: Response,
    @Next() next: NextFunction,
    @Auth() auth: AuthDto,
    @Param() { id, personId, faceId }: SharedSpacePersonFaceParamDto,
  ) {
    await sendFile(res, next, () => this.service.getSpacePersonFaceThumbnail(auth, id, personId, faceId), this.logger);
  }
```

- [ ] **Step 6: Write the e2e 400 test (CI-deferred).** In the shared-space e2e spec add, e.g.:

```ts
it('returns 400 (not 500) for a non-UUID member userId path param', async () => {
  const { status } = await request(app)
    .patch(`/shared-spaces/${space.id}/members/not-a-uuid`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ role: 'viewer' });
  expect(status).toBe(400);
});
```

- [ ] **Step 7: Run the unit tests + type-check**

Run: `cd server && pnpm test -- --run src/dtos/shared-space.dto.spec.ts && pnpm run check`
Expected: schema tests PASS; tsc clean.

> **CI-deferred:** the e2e 400 test and SDK regen (`make build-sdk` → `make open-api` — the params gain a `format: uuid` OpenAPI annotation; function signatures stay `string`, so no web/mobile break) run at the final gate.

- [ ] **Step 8: Commit**

```bash
git add server/src/dtos/shared-space.dto.ts server/src/dtos/shared-space.dto.spec.ts \
        server/src/controllers/shared-space.controller.ts \
        e2e/src/api/specs/shared-space.e2e-spec.ts
git commit -m "fix(spaces): validate shared-space route params so non-UUID input returns 400 not 500"
```

---

## Final gate (run once, after all tasks)

- [ ] **Type check (all):** `cd server && pnpm run check` → no errors.
- [ ] **Server unit suite:** `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts src/dtos/shared-space.dto.spec.ts test/revert-to-immich.spec.ts` → PASS (Tasks 1, 3, 5, 8 local red→green).
- [ ] **Single ESLint pass (deferred from per-task):** `cd server && pnpm run lint` (or `make lint-server`) → zero warnings. Fix any stragglers.
- [ ] **CI-deferred (Docker was down locally) — run at CI / final gate:**
  - Medium: `cd server && pnpm test:medium` — albums-7 (Task 2), C5 (Task 6), C6 (Task 7).
  - e2e: `cd e2e && pnpm test` — security-9 400 (Task 8).
  - `make sql` against a **scratch migrated DB** to regenerate changed `@GenerateSql` `.sql` docs (Task 2 recency queries) and validate the Task-4 index migration applies cleanly on fresh + already-migrated DBs with no schema drift.
  - SDK regen (`make build-sdk` → `make open-api`) for the Task-8 param OpenAPI annotations.

## Investigation resolutions (summary)

- **C3 — LEAK FOUND → FIXED (Task 5):** propagated `PersonMerge` activity payload leaked cross-space + personal-library UUIDs to space members; read-time whitelist redaction in `getActivities` + unit test.
- **C5 — SAFE → PINNED (Task 6):** album-arm trash + stack already handled at the `asset` root (grid) and symmetrically in the count arms; committed medium parity tests, no code change.
- **C6 — SAFE/CONSISTENT → PINNED (Task 7):** partner ∪ space is correct most-permissive-of-two-independent-grants; Locked is blocked by both arms (the private tier never leaks), Hidden reaches partners via the pre-existing partner grant, consistent with slice-4 security-7; committed medium invariant test, no code change.

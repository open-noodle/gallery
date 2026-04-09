# Dedup → Shared Space Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a user resolves a duplicate group in the Dedup UI, any keeper asset gets auto-added to shared spaces the trashed duplicates belonged to, mirroring how album membership is already merged.

**Architecture:** Add one new repository method (`getEditableByAssetIds`) to `SharedSpaceRepository` that returns spaces containing any of a set of assets where the user has Editor+ role, joined on `shared_space_asset` only (library content excluded). In `DuplicateService.resolveGroup`, add a new branch immediately after the access checks — placed first so partial-failure blast radius is minimal — that calls the new repo method and then `sharedSpaceRepository.addAssets` for each (space, keeper) pair, plus `SharedSpaceFaceMatch` job queue entries. No schema migration.

**Tech Stack:** NestJS, Kysely, vitest (unit + medium + e2e), supertest, `src/actors.ts` helpers.

**Design doc:** `docs/plans/2026-04-06-dedup-space-sync-design.md` (already committed at `e71e248a4`). Read it before starting.

**Commit dating:** All commits must be dated **2026-04-06** using the current time-of-day. Use:

```bash
COMMIT_DATE="2026-04-06T$(date +%H:%M:%S)" \
  GIT_AUTHOR_DATE="$COMMIT_DATE" \
  GIT_COMMITTER_DATE="$COMMIT_DATE" \
  git commit -m "..."
```

**No `Co-Authored-By` trailer** (per user's global CLAUDE.md).

---

## Task 1: Add `getEditableByAssetIds` repository method

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (add method + import)
- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts` (add tests)
- Regenerate: `server/src/queries/shared-space.repository.sql` (via `make sql` if DB is running; otherwise apply CI diff manually — see `feedback_sql_query_regen.md`)

**Why a medium test, not a unit test?** Repository methods talk to a real Postgres. Gallery's convention is to test repository methods with `newMediumService` against a real DB. Follow the surrounding tests in `shared-space.repository.spec.ts`.

### Step 1: Write the failing medium tests

Add this `describe` block **inside the existing `describe(SharedSpaceRepository.name, ...)` in `server/test/medium/specs/repositories/shared-space.repository.spec.ts`** (place it alphabetically near the other asset-related describes, or append at the end of the file if simpler):

```ts
describe('getEditableByAssetIds', () => {
  it('returns spaces containing the asset where the user is Editor', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'editor' });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await sut.addAssets([{ spaceId: space.id, assetId: asset.id, addedById: user.id }]);

    const result = await sut.getEditableByAssetIds(user.id, new Set([asset.id]));

    expect(result).toEqual(new Set([space.id]));
  });

  it('returns spaces containing the asset where the user is Owner', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await sut.addAssets([{ spaceId: space.id, assetId: asset.id, addedById: user.id }]);

    const result = await sut.getEditableByAssetIds(user.id, new Set([asset.id]));

    expect(result).toEqual(new Set([space.id]));
  });

  it('excludes spaces where the user is only a Viewer', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await sut.addAssets([{ spaceId: space.id, assetId: asset.id, addedById: owner.id }]);

    const result = await sut.getEditableByAssetIds(viewer.id, new Set([asset.id]));

    expect(result).toEqual(new Set());
  });

  it('excludes spaces where the user is not a member', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await sut.addAssets([{ spaceId: space.id, assetId: asset.id, addedById: owner.id }]);

    const result = await sut.getEditableByAssetIds(stranger.id, new Set([asset.id]));

    expect(result).toEqual(new Set());
  });

  it('returns multiple spaces when the asset is in several editable ones', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space: spaceA } = await ctx.newSharedSpace({ createdById: user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: user.id, role: 'editor' });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: user.id, role: 'owner' });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await sut.addAssets([
      { spaceId: spaceA.id, assetId: asset.id, addedById: user.id },
      { spaceId: spaceB.id, assetId: asset.id, addedById: user.id },
    ]);

    const result = await sut.getEditableByAssetIds(user.id, new Set([asset.id]));

    expect(result).toEqual(new Set([spaceA.id, spaceB.id]));
  });

  it('returns spaces containing ANY of the given asset ids', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'editor' });

    const { asset: asset1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: asset2 } = await ctx.newAsset({ ownerId: user.id });
    // Only asset1 is in the space; asset2 is loose.
    await sut.addAssets([{ spaceId: space.id, assetId: asset1.id, addedById: user.id }]);

    const result = await sut.getEditableByAssetIds(user.id, new Set([asset1.id, asset2.id]));

    expect(result).toEqual(new Set([space.id]));
  });

  it('returns empty set when input is empty', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const result = await sut.getEditableByAssetIds(user.id, new Set());

    expect(result).toEqual(new Set());
  });
});
```

### Step 2: Run tests to verify they fail

```bash
cd server && pnpm test:medium -- --run src/repositories/shared-space.repository.spec.ts -t "getEditableByAssetIds"
```

**Expected:** 7 failures, all citing "sut.getEditableByAssetIds is not a function" (or similar — the method doesn't exist yet).

### Step 3: Implement the repository method

In `server/src/repositories/shared-space.repository.ts`:

**(a) Update the imports at the top:**

```ts
import { ChunkedArray, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import { AssetType, AssetVisibility, SharedSpaceRole, VectorIndex } from 'src/enum';
```

(Add `ChunkedSet` to the `decorators` import and `SharedSpaceRole` to the `enum` import. Leave the other imports untouched.)

**(b) Add the method.** Place it near the other read methods — after `addAssets` (currently around line 195) and before `removeAssets` is a good spot:

```ts
  /**
   * Returns the set of space IDs that contain ANY of the given asset IDs
   * via direct membership (`shared_space_asset`) AND in which the user has
   * Owner or Editor role.
   *
   * Library-linked content (`shared_space_library`) is deliberately excluded
   * — only direct per-asset membership counts. See dedup-space-sync design
   * doc for rationale.
   *
   * Returns `Set<string>` (not `Map<assetId, spaceIds[]>` as
   * `albumRepository.getByAssetIds` does) because the dedup sync caller
   * applies every matched space to every keeper, so the per-asset grouping
   * is unused.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async getEditableByAssetIds(userId: string, assetIds: Set<string>): Promise<Set<string>> {
    if (assetIds.size === 0) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('shared_space_asset')
      .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
      .select('shared_space_asset.spaceId')
      .where('shared_space_asset.assetId', 'in', [...assetIds])
      .where('shared_space_member.userId', '=', userId)
      .where('shared_space_member.role', 'in', [SharedSpaceRole.Owner, SharedSpaceRole.Editor])
      .distinct()
      .execute();

    return new Set(rows.map((row) => row.spaceId));
  }
```

### Step 4: Run tests to verify they pass

```bash
cd server && pnpm test:medium -- --run src/repositories/shared-space.repository.spec.ts -t "getEditableByAssetIds"
```

**Expected:** 7 tests passing.

### Step 5: Regenerate the SQL query file

```bash
make sql  # from repo root — requires a running DB
# Or, if you have a built dist/: cd server && pnpm sync:sql
```

If no local DB is running, you'll need to let CI regenerate it — push first, fetch the diff from the failing CI job, and apply manually. See `feedback_sql_query_regen.md` and `feedback_make_sql_no_db.md` — **NEVER run `make sql` without the DB running** (it deletes all query files).

**No OpenAPI / Dart regen needed.** This change has no DTO changes, no controller signature changes, and no new endpoints — only an internal repository method and a service-layer branch. Skip `make open-api`. (Per `feedback_openapi_dart_and_sql.md`, OpenAPI regen is required when adding endpoints; SQL regen is required when adding `@GenerateSql` methods. We're only doing the latter.)

**Verify** that `server/src/queries/shared-space.repository.sql` now contains a section for `SharedSpaceRepository.getEditableByAssetIds`.

### Step 6: Run type check

```bash
cd server && pnpm check
```

**Expected:** no errors.

### Step 7: Commit

```bash
COMMIT_DATE="2026-04-06T$(date +%H:%M:%S)" \
  GIT_AUTHOR_DATE="$COMMIT_DATE" \
  GIT_COMMITTER_DATE="$COMMIT_DATE" \
  git add server/src/repositories/shared-space.repository.ts \
          server/test/medium/specs/repositories/shared-space.repository.spec.ts \
          server/src/queries/shared-space.repository.sql && \
  GIT_AUTHOR_DATE="$COMMIT_DATE" \
  GIT_COMMITTER_DATE="$COMMIT_DATE" \
  git commit -m "feat(server): add SharedSpaceRepository.getEditableByAssetIds

Returns the set of space IDs containing any of the given assets where
the user has Owner or Editor role. Joins shared_space_asset with
shared_space_member filtered by role; library content is excluded.

Used by upcoming dedup resolve sync to mirror album merging for spaces."
```

---

## Task 2: Add space sync branch to DuplicateService.resolveGroup

**Files:**

- Modify: `server/src/services/duplicate.service.ts` (add branch in `resolveGroup`)
- Modify: `server/src/services/duplicate.service.spec.ts` (add 5 unit tests)

### Step 1: Write the failing unit tests

Open `server/src/services/duplicate.service.spec.ts`.

**FIRST**, add a default mock to the top-level `beforeEach` so existing tests that traverse `resolveGroup` don't crash on the new branch. The `sharedSpace` repository is auto-mocked in **strict** mode (`server/test/utils.ts:343` — no `{ strict: false }` option), so any unmocked method call hard-fails via `assert.fail`. The existing `should sync merged tags to asset_exif.tags` test (line ~319) goes through `resolveGroup` with non-empty `idsToKeep` and **will** hit the new branch.

Modify the existing `beforeEach` (around line 34):

```ts
beforeEach(() => {
  ({ sut, mocks } = newTestService(DuplicateService));
  mocks.duplicateRepository.delete.mockResolvedValue(undefined as any);
  mocks.duplicateRepository.deleteAll.mockResolvedValue(undefined as any);
  // Default to "no editable spaces" so the new merge branch is a no-op for
  // existing tests. Tests that exercise the merge override per case.
  mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set());
});
```

**THEN** add this `describe` block inside `describe('resolveGroup (via resolve)', ...)` — place it alongside the existing merge tests like `should sync merged tags to asset_exif.tags`:

```ts
describe('shared space sync', () => {
  const spaceX = 'space-x-id';
  const spaceY = 'space-y-id';

  const setupBaseDuplicate = (asset1: any, asset2: any) => {
    mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset2.id]));
    mocks.duplicateRepository.get.mockResolvedValue({
      duplicateId: 'group-1',
      assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
    });
  };

  it('adds keeper to spaces the trashed asset was in', async () => {
    const asset1 = AssetFactory.create();
    const asset2 = AssetFactory.create();
    setupBaseDuplicate(asset1, asset2);
    mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set([spaceX]));
    mocks.sharedSpace.addAssets.mockResolvedValue([]);

    const result = await sut.resolve(authStub.admin, {
      groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
    });

    expect(result[0].success).toBe(true);
    expect(mocks.sharedSpace.getEditableByAssetIds).toHaveBeenCalledWith(
      authStub.admin.user.id,
      new Set([asset1.id, asset2.id]),
    );
    expect(mocks.sharedSpace.addAssets).toHaveBeenCalledWith([
      { spaceId: spaceX, assetId: asset1.id, addedById: authStub.admin.user.id },
    ]);
    expect(mocks.job.queueAll).toHaveBeenCalledWith(
      expect.arrayContaining([{ name: JobName.SharedSpaceFaceMatch, data: { spaceId: spaceX, assetId: asset1.id } }]),
    );
  });

  it('does not call addAssets when the user has no editable spaces containing the group', async () => {
    const asset1 = AssetFactory.create();
    const asset2 = AssetFactory.create();
    setupBaseDuplicate(asset1, asset2);
    mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set());

    const result = await sut.resolve(authStub.admin, {
      groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
    });

    expect(result[0].success).toBe(true);
    expect(mocks.sharedSpace.addAssets).not.toHaveBeenCalled();
    // queueAll may still be called for SidecarWrite from the tag branch; assert it was
    // NOT called with a SharedSpaceFaceMatch job.
    const faceMatchCalls = mocks.job.queueAll.mock.calls
      .flat(2)
      .filter((j: any) => j?.name === JobName.SharedSpaceFaceMatch);
    expect(faceMatchCalls).toHaveLength(0);
  });

  it('adds keeper to multiple editable spaces', async () => {
    const asset1 = AssetFactory.create();
    const asset2 = AssetFactory.create();
    setupBaseDuplicate(asset1, asset2);
    mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set([spaceX, spaceY]));
    mocks.sharedSpace.addAssets.mockResolvedValue([]);

    const result = await sut.resolve(authStub.admin, {
      groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
    });

    expect(result[0].success).toBe(true);
    const addAssetsArg = mocks.sharedSpace.addAssets.mock.calls[0][0] as Array<{
      spaceId: string;
      assetId: string;
      addedById: string;
    }>;
    expect(addAssetsArg).toHaveLength(2);
    expect(addAssetsArg).toEqual(
      expect.arrayContaining([
        { spaceId: spaceX, assetId: asset1.id, addedById: authStub.admin.user.id },
        { spaceId: spaceY, assetId: asset1.id, addedById: authStub.admin.user.id },
      ]),
    );

    const queuedFaceJobs = mocks.job.queueAll.mock.calls
      .flat(2)
      .filter((j: any) => j?.name === JobName.SharedSpaceFaceMatch);
    expect(queuedFaceJobs).toHaveLength(2);
  });

  it('skips the space sync branch entirely when there are no keepers', async () => {
    const asset1 = AssetFactory.create();
    const asset2 = AssetFactory.create();
    setupBaseDuplicate(asset1, asset2);
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));

    const result = await sut.resolve(authStub.admin, {
      groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [asset1.id, asset2.id] }],
    });

    expect(result[0].success).toBe(true);
    expect(mocks.sharedSpace.getEditableByAssetIds).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.addAssets).not.toHaveBeenCalled();
  });

  it('reports failure cleanly if addAssets throws, and NO downstream mutation runs', async () => {
    // This is the regression guard for the "place merge first" decision in
    // the design doc. If anyone moves the new branch to a later position
    // in resolveGroup, downstream mutations would have already happened
    // before the throw, leaving partial state. These assertions catch that.
    const asset1 = AssetFactory.create();
    const asset2 = AssetFactory.create();
    setupBaseDuplicate(asset1, asset2);
    mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set([spaceX]));
    mocks.sharedSpace.addAssets.mockRejectedValue(new Error('db exploded'));

    const result = await sut.resolve(authStub.admin, {
      groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
    });

    expect(result[0].success).toBe(false);
    expect(result[0].error).toBe(BulkIdErrorReason.UNKNOWN);

    // None of the downstream merge / mutation steps should have run.
    expect(mocks.album.addAssetIdsToAlbums).not.toHaveBeenCalled();
    expect(mocks.tag.replaceAssetTags).not.toHaveBeenCalled();
    expect(mocks.asset.updateAllExif).not.toHaveBeenCalled();

    // The trash step must NOT have run. updateAll is called with a trash
    // payload only from the trash branch (line ~221). Confirm no call
    // included a deletedAt or AssetStatus.Trashed payload.
    const trashCalls = mocks.asset.updateAll.mock.calls.filter(
      ([_ids, update]: [string[], any]) => update && (update.deletedAt !== undefined || update.status !== undefined),
    );
    expect(trashCalls).toHaveLength(0);
  });
});
```

**Note on imports in the spec file:** `JobName`, `BulkIdErrorReason`, and `MapAsset` should already be imported at the top — verify and add any missing.

### Step 2: Run tests to verify they fail

```bash
cd server && pnpm test -- --run src/services/duplicate.service.spec.ts -t "shared space sync"
```

**Expected:** all 5 new tests fail. First three fail because `sharedSpace.getEditableByAssetIds` is never called (the branch doesn't exist). Test 4 passes vacuously if the branch isn't there (we don't call `getEditableByAssetIds`), which is fine but verify the assertion it's NOT called matches. Test 5 fails because `addAssets` is also never called.

If test 4 passes spuriously, that's expected — it's verifying a no-op path that is ALREADY a no-op before we add any code. It will still pass after implementation. Leave it as a regression guard.

### Step 3: Implement the space sync branch

In `server/src/services/duplicate.service.ts`, locate `resolveGroup`. Find the block that checks `idsToTrash` permissions (ends around line 155 with `}`). Insert the new branch **immediately after** that block and **before** the `const assetAlbumMap = await this.albumRepository.getByAssetIds(...)` line (currently line 157).

```ts
// Sync shared space membership: add the keeper(s) to any space the group's
// assets were in, provided the auth user has Editor+ role there. Placed
// before any other mutation so partial-failure blast radius is minimal —
// if addAssets throws, nothing else has been written yet.
//
// Caveat: if addAssets succeeds but queueAll throws, the keeper is in the
// space but no SharedSpaceFaceMatch jobs were queued. The outer try/catch
// reports the group as failed, so the user retries — addAssets is
// idempotent and queueAll runs again. Self-healing on retry.
if (idsToKeep.length > 0) {
  const editableSpaceIds = await this.sharedSpaceRepository.getEditableByAssetIds(auth.user.id, groupAssetIds);

  if (editableSpaceIds.size > 0) {
    await this.sharedSpaceRepository.addAssets(
      [...editableSpaceIds].flatMap((spaceId) =>
        idsToKeep.map((assetId) => ({ spaceId, assetId, addedById: auth.user.id })),
      ),
    );

    // Queue face match jobs unconditionally — handleSharedSpaceFaceMatch
    // short-circuits when space.faceRecognitionEnabled is false, so a
    // wasted queue entry is cheaper than a pre-filter query.
    await this.jobRepository.queueAll(
      [...editableSpaceIds].flatMap((spaceId) =>
        idsToKeep.map((assetId) => ({
          name: JobName.SharedSpaceFaceMatch as const,
          data: { spaceId, assetId },
        })),
      ),
    );
  }
}
```

**Note:** `groupAssetIds` is **already** a `Set<string>` built at line 119 of `duplicate.service.ts` (`const groupAssetIds = new Set(duplicateGroup.assets.map((a) => a.id))`). Pass it directly — no `new Set(groupAssetIds)` wrap needed.

### Step 4: Run tests to verify they pass

```bash
cd server && pnpm test -- --run src/services/duplicate.service.spec.ts
```

**Expected:** the full `duplicate.service.spec.ts` suite passes, including the 5 new tests and all existing tests. If an existing test now fails because a mock for `sharedSpace.getEditableByAssetIds` wasn't set and the default returns `undefined`, add `mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set());` to the `beforeEach` in that describe block.

### Step 5: Run type check

```bash
cd server && pnpm check
```

**Expected:** no errors. If ESLint flags a stylistic issue, fix it.

### Step 6: Commit

```bash
COMMIT_DATE="2026-04-06T$(date +%H:%M:%S)" \
  GIT_AUTHOR_DATE="$COMMIT_DATE" \
  GIT_COMMITTER_DATE="$COMMIT_DATE" \
  git add server/src/services/duplicate.service.ts \
          server/src/services/duplicate.service.spec.ts && \
  GIT_AUTHOR_DATE="$COMMIT_DATE" \
  GIT_COMMITTER_DATE="$COMMIT_DATE" \
  git commit -m "feat(server): sync shared space membership during duplicate resolve

When resolving a duplicate group, add the keeper asset(s) to any shared
space the trashed duplicates belonged to, provided the auth user has
Editor or Owner role there. Queues SharedSpaceFaceMatch jobs so the
keeper's faces flow into the space's people sidebar.

Placed early in resolveGroup so a failure does not leave partially
merged state (albums done, tags done, trash done, spaces missing).

Library-linked content is out of scope; fork follow-up if needed."
```

---

## Task 3: Add e2e tests using the SpaceContext helpers

**Files:**

- Create: `e2e/src/specs/server/api/duplicate-spaces.e2e-spec.ts`

This is a **new, fork-only** spec file. The existing upstream spec at `e2e/src/api/specs/duplicate.e2e-spec.ts` is upstream-shaped (uses `{status:'COMPLETED', results:[...]}`) and is intentionally left alone.

### Step 1: Create the spec file with fixtures

Create `e2e/src/specs/server/api/duplicate-spaces.e2e-spec.ts` with:

```ts
import { AssetMediaResponseDto, LoginResponseDto, SharedSpaceRole } from '@immich/sdk';
import { buildSpaceContext, type SpaceContext } from 'src/actors';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Return the current UTC month as a YYYY-MM-01 bucket string — the same
// format /timeline/bucket?timeBucket=... expects. Pure, hoisted.
function currentMonthBucketString(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

// Fetch the set of asset IDs currently visible in the space via the timeline
// bucket endpoint. Requires `spaceId` because the direct-listing route isn't
// exposed — the timeline endpoint is the fork-canonical way to "list assets in
// a space".
async function spaceAssetIds(token: string, spaceId: string): Promise<Set<string>> {
  const { status, body } = await request(app)
    .get('/timeline/bucket')
    .query({ spaceId, timeBucket: currentMonthBucketString() })
    .set('Authorization', `Bearer ${token}`);
  if (status !== 200) {
    throw new Error(`spaceAssetIds failed: ${status} ${JSON.stringify(body)}`);
  }
  return new Set((body as { id: string[] }).id ?? []);
}

// Shared mini-helper: mark two assets as a duplicate group by assigning them
// the same synthetic duplicateId via the fork's setAssetDuplicateId helper.
async function markAsDuplicate(token: string, duplicateId: string, assetIds: string[]): Promise<void> {
  await Promise.all(assetIds.map((id) => utils.setAssetDuplicateId(token, id, duplicateId)));
}

describe('/duplicates/resolve — shared space sync (fork)', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  // tests added in subsequent steps
});
```

### Step 2: Verify it compiles and the (empty) describe loads

```bash
cd e2e && pnpm build
```

**Expected:** no TS errors.

If there are import errors (e.g. `buildSpaceContext` not exported), check that `e2e/src/actors.ts` exports it — it should as of PR #307.

### Step 3: Add test 1 — happy path (Owner resolves, keeper lands in space)

**IMPORTANT:** The `actors.ts` doc explicitly says _"Treat the returned fixtures as read-only; mutating tests must restore state in try/finally"_. We must NOT trash `ctx.spaceAssetId` or otherwise mutate the shared SpaceContext state. Each test creates its own asset pair owned by `ctx.spaceOwner` so it can mutate freely without polluting `ctx`.

Inside the `describe`, add:

```ts
it('adds the owner-kept asset to the space when the trashed duplicate was in the space', async () => {
  // Set up a fresh asset pair so we don't mutate ctx.spaceAssetId / ctx.ownerAssetId.
  // Both owned by spaceOwner; one added to the space, one not.
  const ownerToken = ctx.spaceOwner.token!;
  const inSpace = await utils.createAsset(ownerToken);
  const loose = await utils.createAsset(ownerToken);
  await utils.addSpaceAssets(ownerToken, ctx.spaceId, [inSpace.id]);

  const duplicateId = '00000000-0000-4000-8000-000000000100';
  await markAsDuplicate(ownerToken, duplicateId, [inSpace.id, loose.id]);

  const { status, body } = await request(app)
    .post('/duplicates/resolve')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      groups: [
        {
          duplicateId,
          keepAssetIds: [loose.id],
          trashAssetIds: [inSpace.id],
        },
      ],
    });

  expect(status).toBe(200);
  expect(body).toEqual([{ id: duplicateId, success: true }]);

  // The keeper should now be visible in the space; the trashed one should not.
  const ids = await spaceAssetIds(ownerToken, ctx.spaceId);
  expect(ids.has(loose.id)).toBe(true);
  expect(ids.has(inSpace.id)).toBe(false);
});
```

### Step 4: Add test 2 — Editor path

```ts
it('allows an Editor to add their own keeper to a space they edit', async () => {
  // Editor uploads a second asset, adds their first asset (ctx.editorAssetId)
  // to the space, marks both of their assets as duplicates, then resolves
  // keeping the new one.
  const editorToken = ctx.spaceEditor.token!;
  const secondAsset: AssetMediaResponseDto = await utils.createAsset(editorToken);

  await utils.addSpaceAssets(editorToken, ctx.spaceId, [ctx.editorAssetId]);

  const duplicateId = '00000000-0000-4000-8000-000000000101';
  await markAsDuplicate(editorToken, duplicateId, [ctx.editorAssetId, secondAsset.id]);

  const { status, body } = await request(app)
    .post('/duplicates/resolve')
    .set('Authorization', `Bearer ${editorToken}`)
    .send({
      groups: [
        {
          duplicateId,
          keepAssetIds: [secondAsset.id],
          trashAssetIds: [ctx.editorAssetId],
        },
      ],
    });

  expect(status).toBe(200);
  expect(body).toEqual([{ id: duplicateId, success: true }]);

  const ids = await spaceAssetIds(editorToken, ctx.spaceId);
  expect(ids.has(secondAsset.id)).toBe(true);
  expect(ids.has(ctx.editorAssetId)).toBe(false);
});
```

### Step 5: Add test 3 — no-op when nothing is in a space

```ts
it('does not alter space membership when no duplicate is in a space', async () => {
  // Two loose assets (neither in any space). Resolving them must not touch
  // space state in any way.
  const ownerToken = ctx.spaceOwner.token!;
  const [loose1, loose2] = await Promise.all([utils.createAsset(ownerToken), utils.createAsset(ownerToken)]);

  const before = await spaceAssetIds(ownerToken, ctx.spaceId);

  const duplicateId = '00000000-0000-4000-8000-000000000102';
  await markAsDuplicate(ownerToken, duplicateId, [loose1.id, loose2.id]);

  const { status, body } = await request(app)
    .post('/duplicates/resolve')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      groups: [
        {
          duplicateId,
          keepAssetIds: [loose1.id],
          trashAssetIds: [loose2.id],
        },
      ],
    });

  expect(status).toBe(200);
  expect(body).toEqual([{ id: duplicateId, success: true }]);

  const after = await spaceAssetIds(ownerToken, ctx.spaceId);
  expect(after).toEqual(before);
  expect(after.has(loose1.id)).toBe(false);
  expect(after.has(loose2.id)).toBe(false);
});
```

### Step 6: Add test 4 — idempotency (keeper already in the space)

```ts
it('is idempotent when the keeper is already in the space', async () => {
  // Put both assets in the space first, then resolve. The addAssets call
  // must ON CONFLICT DO NOTHING the keeper.
  const ownerToken = ctx.spaceOwner.token!;
  const loose: AssetMediaResponseDto = await utils.createAsset(ownerToken);
  await utils.addSpaceAssets(ownerToken, ctx.spaceId, [loose.id]);

  // Sanity check: both in the space now.
  const before = await spaceAssetIds(ownerToken, ctx.spaceId);
  expect(before.has(loose.id)).toBe(true);

  // Second asset owned by the same user, not in space, to form a duplicate group.
  const second = await utils.createAsset(ownerToken);
  const duplicateId = '00000000-0000-4000-8000-000000000103';
  await markAsDuplicate(ownerToken, duplicateId, [loose.id, second.id]);

  const { status, body } = await request(app)
    .post('/duplicates/resolve')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      groups: [
        {
          duplicateId,
          keepAssetIds: [loose.id],
          trashAssetIds: [second.id],
        },
      ],
    });

  expect(status).toBe(200);
  expect(body).toEqual([{ id: duplicateId, success: true }]);

  // Loose is still in the space, second is trashed and not visible.
  const after = await spaceAssetIds(ownerToken, ctx.spaceId);
  expect(after.has(loose.id)).toBe(true);
  expect(after.has(second.id)).toBe(false);
});
```

### Step 7: Start the e2e stack and run the new spec

```bash
make e2e  # from repo root, starts the e2e stack if not already running
cd e2e && pnpm test -- --run src/specs/server/api/duplicate-spaces.e2e-spec.ts
```

**Expected:** all 4 tests passing. Test runtime is dominated by the `buildSpaceContext` setup + asset uploads; expect ~20-40 seconds.

**Common failures and how to diagnose:**

- Status 401 on `/duplicates/resolve` → token is invalid or `ctx.spaceOwner.token` is undefined. Confirm `buildSpaceContext` succeeded.
- Status 200 but `success: false, error: 'NOT_FOUND'` → duplicate group ID wasn't assigned. Verify `setAssetDuplicateId` was awaited and the assets belong to the same user.
- `spaceAssetIds` returns empty set when you expected the keeper → `/timeline/bucket` uses `timeBucket` as the partition key; if the assets were uploaded outside the current UTC month (unlikely for fresh fixtures), `currentMonthBucketString()` will miss them. Diagnose by logging the full bucket listing with `/timeline/buckets?spaceId=`.

### Step 8: Commit

```bash
COMMIT_DATE="2026-04-06T$(date +%H:%M:%S)" \
  GIT_AUTHOR_DATE="$COMMIT_DATE" \
  GIT_COMMITTER_DATE="$COMMIT_DATE" \
  git add e2e/src/specs/server/api/duplicate-spaces.e2e-spec.ts && \
  GIT_AUTHOR_DATE="$COMMIT_DATE" \
  GIT_COMMITTER_DATE="$COMMIT_DATE" \
  git commit -m "test(e2e): cover shared space sync during duplicate resolve

Four fork-only tests via buildSpaceContext:
1. Owner resolves duplicate; keeper ends up in space.
2. Editor can add their own keeper to a space they edit.
3. Resolving assets in no space leaves space state untouched.
4. Idempotent when the keeper is already in the space (ON CONFLICT)."
```

---

## Task 4: Final verification and cleanup

### Step 1: Run server type check

```bash
cd server && pnpm check
```

**Expected:** no errors.

### Step 2: Run the full duplicate + shared-space unit/medium suite one more time

```bash
cd server && pnpm test -- --run src/services/duplicate.service.spec.ts
cd server && pnpm test:medium -- --run src/repositories/shared-space.repository.spec.ts
```

Both green.

### Step 3: Check git status — no surprise stragglers

```bash
git status
git log --oneline main..HEAD
```

**Expected:** 3-4 commits on `research/upstream-dedup` (1 design doc already committed + repository + service + e2e), all dated 2026-04-06, nothing uncommitted outside the worktree.

### Step 4: Open the PR

Per user's preference (see `feedback_always_use_prs.md`), push the branch and open a PR. Target: `main`. Keep the PR title short; put detail in the body. Reference the design doc.

**DO NOT run `gh pr create` without explicit user approval** — the user's instruction was to implement the feature; the PR step is a separate go-ahead (see `feedback_never_merge_without_asking.md`). Stop here and report status.

---

## Skill references

- @superpowers:verification-before-completion — run all verification commands before claiming work is complete
- @superpowers:test-driven-development — failing test first, minimal implementation, no skipped tests
- @superpowers:requesting-code-review — after Task 4, before PR

## Memory-backed gotchas to honor

- `feedback_sql_query_regen.md` — regenerate SQL query files for `@GenerateSql` methods
- `feedback_make_sql_no_db.md` — NEVER run `make sql` without a running DB (destructive)
- `feedback_mock_type_safety.md` — `void 0 as any` and `Promise.resolve` in mocks where needed
- `feedback_svelte_map_lint.md` — N/A (no svelte changes)
- `feedback_lint_sequential.md` — don't run lint locally, let CI do it; only run type checks
- `feedback_e2e_admin_only_queues.md` — N/A (we don't use waitForQueueFinish)
- `feedback_i18n_key_sorting.md` — N/A (no i18n changes)

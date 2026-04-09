# Sync shared space membership during duplicate resolution

## Problem

When a user resolves a duplicate group and trashes an asset that was a member of a shared space, the space silently loses the photo. The keeper asset is not added to the space, so:

- Space members can no longer see the photo from the space view
- Activity (likes, comments) tied to the trashed asset is eventually lost when the asset is hard-deleted from trash
- This is inconsistent with how albums are treated in the same flow — album membership IS merged onto the keeper

The duplicates UI presents two visually identical photos and asks the user to pick one; the user has no way to know that one of them was the only copy living in a shared space they care about.

## Goal

Mirror the existing album merge logic so that shared space membership is preserved across duplicate resolution. When duplicates are resolved:

1. Find all shared spaces that contain any of the assets in the group.
2. Filter to spaces where the auth user has Editor or Owner role.
3. Add each keeper asset to those spaces (`shared_space_asset` insert with `ON CONFLICT DO NOTHING`).
4. Queue `SharedSpaceFaceMatch` jobs for each (spaceId, keeperAssetId) pair so the keeper's faces flow into the space's people sidebar.

## Non-goals

- **Library-linked content** (`shared_space_library`): assets shown in spaces via library links are out of scope. Cross-library or library/owned duplicates may still lose space visibility — accepted as a follow-up if real users hit it.
- **Activity log entries**: this is a system operation, not a user-initiated add. No "User added X assets" entries in the space activity log.
- **`lastActivityAt` updates**: same reasoning. The album merge path doesn't bump any activity timestamps either.
- **E2E test in this PR**: covered by unit tests in this iteration. An E2E test can be added later if the unit coverage proves insufficient.

## Architecture

### Repository changes — `SharedSpaceRepository`

One new method:

```ts
@GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
@ChunkedSet({ paramIndex: 1 })
async getEditableByAssetIds(userId: string, assetIds: Set<string>): Promise<Set<string>>
```

Returns the set of space IDs that contain ANY of the given asset IDs AND in which the user has Editor or Owner role.

**Exact join shape** (library content explicitly excluded):

```sql
SELECT DISTINCT ssa.spaceId
FROM shared_space_asset ssa
INNER JOIN shared_space_member ssm ON ssm.spaceId = ssa.spaceId
WHERE ssa.assetId IN (:assetIds)
  AND ssm.userId = :userId
  AND ssm.role IN ('owner', 'editor')
```

The Kysely query MUST reference `SharedSpaceRole.Owner` / `SharedSpaceRole.Editor` enum values from `enum.ts`, not hardcoded strings. Library content is excluded by joining only on `shared_space_asset` — assets shown in spaces via `shared_space_library` will not cause the space to be selected for merging. This is intentional: silently promoting library content into directly-owned membership would be a correctness violation.

`@ChunkedSet({ paramIndex: 1 })` is required because asset ID lists can exceed Postgres' parameter limit. The chunked calls must union their result sets.

Returns `Set<string>` since we don't need the per-asset breakdown — we add every keeper to every matching space, the same shape the album path uses internally. This is asymmetric with `albumRepository.getByAssetIds` (which returns `Map<string, string[]>`); a one-line comment will document why.

We reuse the existing `sharedSpaceRepository.addAssets()` method with its `ON CONFLICT DO NOTHING` behavior, which makes the merge naturally idempotent.

### Service changes — `DuplicateService.resolveGroup`

**Placement: immediately after the access checks (after line 155), BEFORE the album merge.** Putting the space sync first minimizes partial-failure blast radius — if `addAssets` throws, no other DB mutations have happened yet, and the outer `try/catch` in `resolve()` (line 102) reports the group as `UNKNOWN` cleanly.

```ts
if (idsToKeep.length > 0) {
  const editableSpaceIds = await this.sharedSpaceRepository.getEditableByAssetIds(auth.user.id, new Set(groupAssetIds));

  if (editableSpaceIds.size > 0) {
    await this.sharedSpaceRepository.addAssets(
      [...editableSpaceIds].flatMap((spaceId) =>
        idsToKeep.map((assetId) => ({ spaceId, assetId, addedById: auth.user.id })),
      ),
    );

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

**Note: face match jobs are queued unconditionally** for editable spaces, in contrast to `SharedSpaceService.addAssets` which pre-filters by `space.faceRecognitionEnabled`. This is intentional: the `handleSharedSpaceFaceMatch` job (`shared-space.service.ts:818`) already short-circuits when face recognition is disabled, so the worst case is a queue entry that immediately returns `Skipped`. For typical dedup operations (small N spaces × small N keepers), the simplification is worth the redundant queue entries.

## Data flow

Concrete walkthrough:

1. User picks duplicate group `{ A (in Space X, owned by user), B (no space, owned by user) }`
2. User chooses `keepAssetIds=[B], trashAssetIds=[A]`
3. `resolveGroup` runs:
   - Album merge runs (no-op for this scenario)
   - **NEW** Space sync runs:
     - `getEditableByAssetIds(userId, [A.id, B.id])` → `Set(X.id)` (user is Editor in X)
     - `addAssets([{ spaceId: X.id, assetId: B.id, addedById: userId }])` → row inserted
     - Queue `SharedSpaceFaceMatch { spaceId: X.id, assetId: B.id }` job
   - Tag merge runs
   - Asset metadata sync (favorite, visibility, rating, etc.)
   - A is moved to trash, `duplicateId` cleared on B
   - Tombstone created for A's checksum
4. Result: B is now in Space X, faces will be matched asynchronously, A is in trash. Space X retains the photo.

## Edge cases

- **User is only a Viewer in the space.** `getEditableByAssetIds` excludes the space; the keeper is not added; the space loses visibility. Same as today — accepted by design.
- **User is no longer a member of the space at all.** Same as Viewer case: excluded.
- **Keeper is already in the space.** `addAssets` uses `ON CONFLICT DO NOTHING`, so the insert is a no-op and `SharedSpaceFaceMatch` queues a redundant job. The job handler is idempotent (face matches use upsert semantics) — no harm, minor wasted work.
- **All members of a duplicate group are kept.** `idsToKeep` is non-empty, `editableSpaceIds` may be non-empty, but `addAssets` is a no-op for already-present assets. Safe.
- **Asset is in multiple spaces, user has Editor in some, Viewer in others.** Only Editor spaces get the keeper. Viewer spaces lose visibility (consistent with the no-membership case).
- **Empty `idsToKeep` (all-trash group).** Guarded by `idsToKeep.length > 0` — we don't query or insert anything. The space loses the photo because there's no keeper, which is the correct user-intent outcome.

## Error handling

- Repository methods are idempotent. `addAssets` and `getEditableByAssetIds` are pure DB ops.
- Job queueing failures bubble up to the existing `try/catch` in `resolve()` (line 102) and surface as `BulkIdErrorReason.UNKNOWN` for the affected group.
- If `addAssets` succeeds but `queueAll` for face matches fails, the keeper is in the space but face matching is delayed. Acceptable: a user can manually trigger a rescan, and the next time the asset is touched (or any space-wide rescan), faces will be matched.
- Permission filtering is silent: spaces the user can't edit are excluded with no error.

## Tests

### Unit tests — `duplicate.service.spec.ts`

Add tests in the `resolveGroup (via resolve)` describe block:

1. **`should add keeper assets to spaces containing trashed assets`**: Mocks `getEditableByAssetIds` to return `Set([X])`, asserts `addAssets` called with `[{ spaceId: X, assetId: keeper, addedById: userId }]` and `SharedSpaceFaceMatch` queued for the same pair.
2. **`should not call addAssets when no editable spaces returned`** (the Viewer-only / non-member case): Mocks empty set even though the asset is in spaces, asserts neither `addAssets` nor a `SharedSpaceFaceMatch` queue call is invoked.
3. **`should add keeper to multiple spaces`**: Mocks `Set([X, Y])`, asserts `addAssets` called with both spaces and face match jobs queued for both.
4. **`should skip space sync when there are no keepers`**: Edge case — `idsToKeep` is empty (e.g., all-trash). Asserts `getEditableByAssetIds` is not even called.
5. **`should report failure cleanly if addAssets throws`**: Mocks `addAssets` to reject. Asserts the group is reported as `BulkIdErrorReason.UNKNOWN` and that the trash step does NOT run (no `assetRepository.updateAll` call with trash status). Confirms the "merge first, fail clean" placement.

### E2E tests — `e2e/src/specs/server/api/duplicate-spaces.e2e-spec.ts`

New fork-only spec file (the existing `e2e/src/api/specs/duplicate.e2e-spec.ts` is upstream-shaped and should not be mixed with fork behavior). Uses the `buildSpaceContext` / `forEachActor` helpers from `e2e/src/actors.ts` (landed in PR #307).

Shape:

```ts
import { buildSpaceContext, type SpaceContext } from 'src/actors';
import { app, utils } from 'src/utils';
import request from 'supertest';

describe('/duplicates/resolve (fork: shared space sync)', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  // tests...
});
```

Four e2e tests:

1. **`adds keeper to space when trashed asset was in that space`** (happy path)
   - spaceOwner has `spaceAssetId` (in the space) and `ownerAssetId` (not in space). Mark both as duplicates via `utils.setAssetDuplicateId`. Resolve keeping `ownerAssetId`, trashing `spaceAssetId`.
   - Assert: `GET /shared-spaces/:id/assets` returns `ownerAssetId` (not `spaceAssetId`, since it's trashed).

2. **`editor adds their own keeper to space after resolving`**
   - spaceEditor uploads a second asset via `utils.createAsset`, adds `editorAssetId` to the space, marks both editor assets as duplicates, resolves keeping the new one and trashing the in-space one.
   - Assert: new asset is in the space, trashed one is gone.
   - Validates the Editor role path (distinct from Owner).

3. **`does not alter space when no assets are in any space`**
   - spaceOwner has two non-space assets (create a second via `utils.createAsset`). Mark as duplicates, resolve.
   - Assert: space asset listing is unchanged; `GET /shared-spaces/:id/assets` returns the same set as before the resolve.
   - Guards against a bug where the space sync accidentally runs even when it shouldn't.

4. **`is idempotent when keeper is already in the space`**
   - spaceOwner adds `ownerAssetId` to the space (now both `spaceAssetId` and `ownerAssetId` are in the space). Mark as duplicates. Resolve keeping `ownerAssetId`, trashing `spaceAssetId`.
   - Assert: `ownerAssetId` remains in the space exactly once, no 500, no duplicate rows.
   - Validates the `ON CONFLICT DO NOTHING` path.

**What we deliberately don't e2e-test:**

- Face match job side effect: verified by unit tests and by the existing `shared-space.service.ts` face-match job tests. Polling for space person presence in e2e would be slow and flaky.
- Viewer role: `SpaceContext` doesn't give us a Viewer with their own assets in the space (Viewers can't add assets). Setting one up requires cross-user sharing plumbing that's out of scope.
- Hard-failure scenarios (`addAssets` throws): unit-test-only; can't reliably induce a repo throw in e2e without infrastructure hacks.

## Migration

None. Pure code change; reuses the existing `shared_space_asset` table.

## Process notes

- The new `@GenerateSql`-decorated method requires regenerating `server/src/queries/shared-space.repository.sql` via `make sql` (or applying the CI diff manually if no local DB is running). Per `feedback_sql_query_regen.md`.
- No OpenAPI changes — this is a service-layer change with no new endpoints or DTOs.

## Known pre-existing gap (not addressed here)

`resolveGroup` never validates that `idsToKeep` belong to `auth.user`. It only checks `Permission.AssetDelete` on `idsToTrash`. The album merge already silently writes someone else's keeper into the auth user's albums; the new space merge inherits the same gap (the keeper would land in the editable space with `addedById = auth.user.id`). This is a pre-existing issue with the album path and is out of scope for this PR. If we want to close it, the fix is to gate `idsToKeep` by ownership in `resolveGroup` itself, in a separate change.

## Backwards compatibility

Fully additive. Existing duplicate resolution flows work unchanged; this only adds extra rows in `shared_space_asset` and extra jobs in the face match queue.

## Risks

- **Queue load**: Each resolved duplicate group with N keepers across M editable spaces queues N×M face match jobs. In practice N is typically 1 and M is small (most users have a handful of spaces). Worst case is bounded by the number of duplicates a user is resolving in one operation, which is human-paced.
- **Permission drift**: If a space role is changed mid-resolve (race condition), we might add a keeper to a space the user was Editor in 1ms ago but no longer is. This is the same race window the existing album merge has and is not a concern.
- **Library-linked space gap**: Users with library-linked spaces still lose visibility for cross-library duplicates. Acceptable for v1; can be addressed if reported.

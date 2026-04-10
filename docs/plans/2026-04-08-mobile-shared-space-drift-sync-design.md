# Design: Mobile Shared-Space Drift Sync

**Status:** Draft
**Date:** 2026-04-08
**Owners:** Gallery mobile + server

## Problem

Opening a shared space on the Flutter mobile app takes multiple seconds because the client eagerly fetches every time bucket over the network before rendering anything. The current path in `mobile/lib/pages/library/spaces/space_detail.page.dart:41` calls `getSpaceAssets()` in `mobile/lib/repositories/shared_space_api.repository.dart:73-103`, which loops through all time buckets sequentially via the `/timeline` API and materialises the full asset list before the `Timeline` widget is instantiated. For a space that spans N months the client performs (1 + N) serial HTTP round trips, all blocked behind a loading spinner.

Remote albums and the main library timeline do not have this problem because they are backed by the local Drift database and consume `TimelineQuery` via lazy bucket/asset sources. The goal of this work is to give shared spaces the same architecture: local Drift-backed queries, sync-stream-driven updates, lazy bucket loading on scroll.

## Goals

1. Opening a shared space on mobile feels as fast as opening a remote album — first paint on the order of a frame.
2. Space timelines work offline for any content the device has synced.
3. Space content stays up to date via the existing sync stream protocol without manual refresh.
4. The design scales to spaces containing hundreds of thousands of photos drawn from multiple linked libraries.
5. Write amplification on the server-side sync stream remains linear in the number of unique assets, not (space × member × asset).

## Non-goals

- Changing the web client. Web already does lazy bucket loading against the same server endpoint.
- Changing the server-side storage model for `shared_space`, `shared_space_asset`, `shared_space_library`. We only add new sync-stream emitters and audit tables, not new source-of-truth tables.
- General-purpose library sync to mobile. Libraries are only synced to the extent they are visible through space membership or ownership — we do not build a standalone "browse libraries" surface on mobile in this work.
- Offline _modification_ of spaces. Adding/removing assets and managing members still requires network.

## Approach at a glance

Mirror the existing remote-album sync pipeline and extend it with library-awareness.

On the server side, add a parallel family of `Sync*` classes for `shared_space`, `shared_space_member`, `shared_space_asset`, `shared_space_library`, `library`, and `library_asset`, following the same template as `AlbumSync`, `AlbumUserSync`, `AlbumAssetSync`, `AlbumAssetExifSync`, `AlbumToAssetSync`. These classes stream creates / updates / deletes / backfills over the existing sync stream protocol, with access scoping that restricts emission to entities the current user can legitimately see.

On the mobile side, add corresponding Drift tables, sync-stream handlers that insert and delete rows in response to the new event types, and a `DriftTimelineRepository.sharedSpace(spaceId)` method that returns a `TimelineQuery` whose `bucketSource` and `assetSource` are backed by local Drift queries. The `SpaceDetailPage` is rewired to use this new `TimelineQuery` through `timelineFactoryProvider.sharedSpace(...)`, the same override pattern that `drift_remote_album.page.dart:181` uses for albums.

The core mobile Drift query mirrors the server's query in `server/src/repositories/asset.repository.ts` — a disjunction over direct addition via `shared_space_asset` and membership via linked libraries in `shared_space_library`:

```sql
SELECT * FROM remote_asset
WHERE id IN (SELECT assetId FROM shared_space_asset WHERE spaceId = ?)
   OR libraryId IN (SELECT libraryId FROM shared_space_library WHERE spaceId = ?)
```

## Scale reasoning

For a user who is a member of a space linking three libraries totalling 500k photos, the dimensional sync approach emits each library asset exactly once (via `LibraryAssetV1`), regardless of how many spaces the user is in that link the same library. A library scan adding 10k new photos emits 10k events, period — every space linked to that library automatically reflects the new content via the local UNION query. Library unlinking is a single `SharedSpaceLibraryDeleteV1` row, not a per-asset fan-out. Mobile storage for asset metadata is approximately 100 MB per 500k assets, which is real but manageable.

A flat materialisation scheme (one sync event per `(spaceId, assetId)` pair) was rejected because initial sync and library updates fan out by (spaces × members), destroying scale properties in exactly the large-library case this design targets.

## Library linkage contract

The server's existing semantics for shared-space-library linkage are: **linking a library to a space makes every asset in that library visible to every member of that space, now and in the future.** This is non-negotiable and orthogonal to this design — it is already the server contract for web clients.

This design propagates that contract faithfully to mobile: when a library is linked to a space the user is a member of, every asset in that library is synced to the device. If the user is a viewer on a small space that links a 500k-photo library, 500k asset-metadata rows end up on the device. Mobile metadata storage is approximately 100 MB per 500k assets — real but bounded by what the user already has server-side access to.

Users who want to limit mobile storage have one lever available today: leave the space. This is intentional. Adding a per-space "don't sync to mobile" opt-out is a potential follow-up but is out of scope here; adding asset-level gating would contradict the server contract and is not considered.

## Delivery plan

The work is split into two PRs for reviewability. **Both PRs ship in a single release.** PR 1 never lands on users without PR 2. This eliminates the upgrade-path problem, the race on library linkages added between PRs, and the need for a transitional fallback in `SpaceDetailPage`.

**PR 1 — Direct-add sync.** Implements SharedSpace, SharedSpaceMember, SharedSpaceAsset (asset rows), SharedSpaceAssetExif, and SharedSpaceToAsset sync. Introduces the Drift entities and sync-stream handlers but does **not** rewire `SpaceDetailPage`; the page keeps the existing `getSpaceAssets()` path while PR 1 is in review. This lets PR 1 be reviewed end-to-end without blocking on PR 2.

**PR 2 — Library-linked sync + UI switchover.** Implements Library, LibraryAsset, and SharedSpaceLibrary sync. Adds the Drift timeline query with the UNION over `shared_space_library`. Rewires `SpaceDetailPage` to use `timelineFactoryProvider.sharedSpace(spaceId)`. Deletes `SharedSpaceApiRepository.getSpaceAssets`. Only after PR 2 does user-facing behavior change.

Sequencing the UI switch into PR 2 means there is no intermediate state where users see half-working spaces. It does mean PR 1's new machinery is dormant until PR 2 lands — acceptable because both ship together in the same release.

Both PRs are fully designed up front; PR 2 is not speculative.

## PR 1 — Direct-add sync

### Server-side changes

**New `SyncEntityType` values** (`server/src/enum.ts`), grouped at the end of the enum under a `// --- gallery-fork additions ---` marker so upstream rebases don't conflict:

- `SharedSpaceV1`, `SharedSpaceDeleteV1` (2)
- `SharedSpaceMemberV1`, `SharedSpaceMemberDeleteV1`, `SharedSpaceMemberBackfillV1` (3)
- `SharedSpaceAssetCreateV1`, `SharedSpaceAssetUpdateV1`, `SharedSpaceAssetBackfillV1` — streams full asset rows for assets that appear in any space the user is a member of, analogous to `AlbumAssetCreateV1` (3)
- `SharedSpaceAssetExifCreateV1`, `SharedSpaceAssetExifUpdateV1`, `SharedSpaceAssetExifBackfillV1` (3)
- `SharedSpaceToAssetV1`, `SharedSpaceToAssetDeleteV1`, `SharedSpaceToAssetBackfillV1` — streams the join rows `(spaceId, assetId)` (3)

Total: **14 new values** in PR 1.

**New audit tables** in a fork-only migration (`server/src/schema/migrations-gallery/`). All three follow the **per-user fan-out** pattern used by `albums_audit` and `album_users_audit` — each audit row records `(entityId, userId, deletedAt)`, meaning "user U lost visibility of entity E at time T". The triggers fan out at DELETE time, inserting one row per affected user. `getDeletes` then queries `WHERE userId = :userId` with no membership join — the audit row itself encodes the revocation.

- `shared_space_audit(spaceId, userId, deletedAt)`
  - Trigger on `shared_space` DELETE: insert one row per `(spaceId, memberId)` for every member of the deleted space, plus one for the creator.
  - Trigger on `shared_space_member` DELETE: insert a single row for `(spaceId, removedUserId)`. The cascade from `shared_space` DELETE → `shared_space_member` DELETE is handled by `pg_trigger_depth` guards, same pattern as `album_users_delete_audit` at `migrations/1747664684909:62-67`.
- `shared_space_member_audit(spaceId, userId, deletedAt)` — mirrors `album_users_audit`. Populated by the same trigger as above.
- `shared_space_asset_audit(spaceId, assetId, deletedAt)` — for direct-add join row deletes. Not per-user — it records join-row removals that need to be propagated to all current space members. The `getDeletes` query scopes by `spaceId IN ACCESSIBLE_SPACES(userId)` for this one; mirrors `album_asset_audit`.

**New `Sync*` classes** in `server/src/repositories/sync.repository.ts`. The scoping subquery for "spaces the user can see" is used by all five and is defined once:

```
ACCESSIBLE_SPACES(userId) :=
  SELECT id FROM shared_space WHERE createdById = userId
  UNION
  SELECT spaceId FROM shared_space_member WHERE userId = userId
```

The UNION includes the creator because `shared_space_member` does not contain a row for the owner (the owner is tracked via `shared_space.createdById`) — verified against `shared-space.table.ts` and `shared-space-member.table.ts`. All five classes must apply this scoping; a forgotten OR-with-owner branch is a copy-paste bug to guard against in review.

- **`SharedSpaceSync`** — `getCreates / getUpdates` scoped to `id IN ACCESSIBLE_SPACES(userId)`. `getDeletes` reads `FROM shared_space_audit WHERE userId = :userId` — the per-user fan-out in the audit table means no membership join is needed for delete notifications.
- **`SharedSpaceMemberSync`** — `getCreates / getUpdates / getBackfill` per space, scoped by `spaceId IN ACCESSIBLE_SPACES(userId)`. `getDeletes` reads `FROM shared_space_member_audit WHERE userId = :userId`. Emits the columns `spaceId, userId, role, joinedAt, showInTimeline`. Explicitly excludes `lastViewedAt` — it is per-member personal state, not needed by the mobile timeline, and not worth the cross-member leak.
- **`SharedSpaceAssetSync`** — streams full asset rows joined through `shared_space_asset`, scoped by `spaceId IN ACCESSIBLE_SPACES(userId)`. Mirrors `AlbumAssetSync`. If the same asset is directly added to multiple spaces for the same user, it will stream once per `shared_space_asset` row — identical to how `AlbumAssetSync` behaves for multi-album assets today. This is bandwidth-inefficient but not a scale concern: direct-add entries are bounded by explicit user actions, not data volume. The 100k+ scale case is handled by library sync in PR 2, which does deduplicate.
- **`SharedSpaceAssetExifSync`** — streams exif rows for those assets. Mirrors `AlbumAssetExifSync`.
- **`SharedSpaceToAssetSync`** — streams `(spaceId, assetId, updateId)` join rows. Mirrors `AlbumToAssetSync`. `getDeletes` reads from `shared_space_asset_audit` filtered by `spaceId IN ACCESSIBLE_SPACES(userId)`.

**Wiring in `sync.service.ts`**: new handlers for each type following the album pattern. When a new space appears via `SharedSpaceV1`, the service immediately issues backfills in the order members → asset rows → asset exif → asset joins, before streaming creates/updates. Identical to how album backfills work.

**DTO + OpenAPI**: each new entity type gets a DTO; `pnpm sync:open-api` regenerates.

### Mobile-side changes

**New Drift entities** under `mobile/lib/infrastructure/entities/`:

- `shared_space.entity.dart` — columns mirroring `shared_space.table.ts`: `id` (PK), `name`, `description`, `color`, `createdById`, `thumbnailAssetId`, `thumbnailCropY`, `faceRecognitionEnabled`, `petsEnabled`, `lastActivityAt`, `createdAt`, `updatedAt`.
- `shared_space_member.entity.dart` — composite PK `(spaceId, userId)`, `role`, `joinedAt`, `showInTimeline`. FK on `spaceId → sharedSpaceEntity` with cascade delete.
- `shared_space_asset.entity.dart` — composite PK `(spaceId, assetId)`. FK on `spaceId → sharedSpaceEntity` with cascade delete. **No FK on `assetId → remoteAssetEntity`** — the join table can temporarily reference assets not yet present locally during incremental sync (see Sync ordering below). Orphan rows are acceptable; they become invisible because the timeline query inner-joins against `remoteAssetEntity`, and they are cleaned up by `SharedSpaceToAssetDeleteV1` when the server's `asset → shared_space_asset` `ON DELETE CASCADE` fires the audit trigger on asset deletion. Insert conflict policy: `InsertMode.insertOrReplace` — a duplicate join row (e.g., backfill then incremental) is a no-op on the content.

**Drift migration step** in `db.repository.steps.dart` — new `MigrationStep` that creates the three tables and relevant indexes (at minimum `shared_space_asset(spaceId)` for bucket queries).

**Sync stream handlers** in `sync_stream.repository.dart`:

- `updateSharedSpacesV1` / `deleteSharedSpacesV1`
- `updateSharedSpaceMembersV1` / `deleteSharedSpaceMembersV1`
- `updateSharedSpaceAssetsV1` — inserts or updates `remoteAssetEntity` rows (extends existing `updateAssetsV1` logic via a shared helper)
- `updateSharedSpaceAssetExifsV1` — inserts or updates `remoteExifEntity` rows
- `updateSharedSpaceToAssetsV1` / `deleteSharedSpaceToAssetsV1` — inserts or deletes `sharedSpaceAssetEntity` rows

Each handler is a Drift batch transaction, the same pattern as the existing album handlers.

**`DriftTimelineRepository.sharedSpace(spaceId, groupBy)`** — a new `TimelineQuery` whose sources mirror `remoteAlbum()` at line 181:

```dart
TimelineQuery sharedSpace(String spaceId, GroupAssetsBy groupBy) => (
  bucketSource: () => _watchSharedSpaceBucket(spaceId, groupBy: groupBy),
  assetSource: (offset, count) => _getSharedSpaceBucketAssets(spaceId, offset: offset, count: count),
  origin: TimelineOrigin.remoteSpace,
);
```

Both helpers join `remoteAssetEntity` against `sharedSpaceAssetEntity` with `WHERE spaceId = ?`. Buckets group by `effectiveCreatedAt(groupBy)`; assets are ordered `createdAt DESC` and paginated via `LIMIT count OFFSET offset`.

**`TimelineFactory.sharedSpace(...)`** — one-line factory method in `domain/services/timeline.service.dart`.

**No `SpaceDetailPage` changes in PR 1.** The UI continues to use the current `getSpaceAssets()` path throughout PR 1 review. PR 2 switches it over. This keeps PR 1 purely additive — new server emitters, new mobile entities, new sync handlers, new Drift query method — with no user-visible behavior change and no risk of regression.

### Data flow — PR 1

On first sync after login (PR 1 in isolation — remember PR 1 is plumbing only, the UI is not yet wired up):

1. Existing `AssetV1` / `PartnerAssetV1` streams populate `remoteAssetEntity` with the user's own and partner-shared assets (unchanged).
2. `SharedSpaceV1` events populate `sharedSpaceEntity`.
3. For each new space the client receives: `SharedSpaceMemberBackfillV1` (member rows) → `SharedSpaceAssetBackfillV1` (foreign asset rows for direct-add assets) → `SharedSpaceAssetExifBackfillV1` → `SharedSpaceToAssetBackfillV1` (join rows). All scoped per-space, so backfill is bounded by the space size.
4. Ack checkpoints advance as in album sync.

Incremental updates arrive as standard creates/updates/deletes.

**User-facing behaviour in PR 1 is unchanged.** Opening a space still uses the existing `getSpaceAssets()` network path. The new Drift entities are populated behind the scenes but `SpaceDetailPage` does not consume them yet. The UI switchover happens in PR 2.

### Sync ordering

The design depends on two ordering guarantees provided by the existing sync service:

1. **Backfill order per new space**: when the client first observes a space via `SharedSpaceV1`, the sync service streams that space's backfills in the order `SharedSpaceMemberBackfillV1` → `SharedSpaceAssetBackfillV1` → `SharedSpaceAssetExifBackfillV1` → `SharedSpaceToAssetBackfillV1`. Asset rows always precede the join rows that reference them. This matches the album backfill order in `sync.service.ts`.
2. **Ack-sequenced incremental streams**: on incremental updates, the sync service drains `SharedSpaceAssetCreateV1` (and the corresponding ack) before emitting `SharedSpaceToAssetV1` events whose `updateId > assetAck.updateId`. `AlbumAssetExifSync.getUpdates` already demonstrates the pattern (`sync.repository.ts:248` — `.where('album_asset.updateId', '<=', albumToAssetAck.updateId)`); we apply the same structure.

Given these guarantees, mobile handlers can treat a `SharedSpaceToAssetV1` join row as always arriving after its asset row. The `sharedSpaceAssetEntity` table intentionally does **not** declare an FK on `assetId` — this sidesteps the "FK violation on out-of-order insert" failure mode the reviewer correctly flagged. An orphan row (join row whose asset is missing locally) is harmless: it will not appear in the Drift timeline query because that query inner-joins against `remoteAssetEntity`, and it will be corrected when the missing asset eventually arrives. In practice, given the ordering guarantees above, orphan rows should not occur outside of test scenarios.

### Error handling — PR 1

- **Interrupted sync**: handled by existing ack checkpoint machinery. New entity types participate in the same protocol.
- **User removed from space**: `SharedSpaceMemberDeleteV1` for the current user → mobile handler deletes the member row and the space row; Drift cascade clears `sharedSpaceAssetEntity`. Foreign assets that are no longer referenced by any local space and are not owned by the user or a partner are cleaned up by the existing orphan sweep (same mechanism remote albums use).
- **Space deleted**: `SharedSpaceDeleteV1` → `sharedSpaceEntity.deleteWhere(id=...)`. Drift cascade on `sharedSpaceMemberEntity` and `sharedSpaceAssetEntity` removes the child rows.
- **Thumbnail auth for foreign assets**: unchanged — the mobile client already displays assets owned by other users in shared albums. Same auth path.
- **Partner-shared assets that are also in a space**: the asset row may arrive via `PartnerAssetV1` first, then again via `SharedSpaceAssetCreateV1`. Both paths insert into `remoteAssetEntity` with upsert semantics, so the second insert is a no-op. Both paths reference the same primary key — no duplication.
- **Live photo video companions**: `livePhotoVideoId` on a foreign asset points to another asset row that must also be present locally. The server emits both rows through `SharedSpaceAssetCreateV1` / `AlbumAssetCreateV1` — they are both assets in the accessible set. If the companion is library-linked, PR 2's library sync brings it in. No extra work required.

### Testing — PR 1

**Server unit tests** in `sync.repository.spec.ts`:

- `SharedSpaceSync.getCreates` emits spaces the user owns (creator path only, no member row).
- `SharedSpaceSync.getCreates` emits spaces the user is a member of but does not own.
- `SharedSpaceSync.getCreates` does not emit spaces the user has no access to.
- `SharedSpaceMemberSync.getBackfill` returns all members for a specific space.
- `SharedSpaceAssetSync.getCreates` emits foreign asset rows scoped to space membership.
- `SharedSpaceAssetSync.getCreates` does not emit assets from spaces the user is not a member of.
- `SharedSpaceAssetSync.getCreates` does not filter by `asset.ownerId` — foreign assets must be emitted.
- `SharedSpaceAssetSync.getCreates` emits the same asset once per `shared_space_asset` row for assets added to multiple spaces the user is in (documents the accepted write amplification for direct-add).
- `SharedSpaceToAssetSync.getDeletes` includes entries that appear in the audit table.
- `SharedSpaceToAssetSync.getDeletes` does not include join rows from unrelated spaces.

**Server trigger / medium tests** (against a real Postgres) — load-bearing because `getDeletes` reads directly from tables populated by triggers:

- `shared_space_audit` receives one row per `(spaceId, memberId)` when a space is deleted (fan-out via cascade).
- `shared_space_audit` receives one row for `(spaceId, memberId)` when a member is removed individually.
- `shared_space_audit` receives one row for the creator when the space is deleted (creator is not in `shared_space_member`).
- `shared_space_member_audit` and `shared_space_audit` do not double-populate on cascade-delete — `pg_trigger_depth` guard works.
- `shared_space_asset_audit` receives one row per `(spaceId, assetId)` when an asset is removed from a space directly.
- `shared_space_asset_audit` receives one row per `(spaceId, assetId)` when an asset is hard-deleted and cascade-removes its `shared_space_asset` rows — this is the path that backs the "orphan rows clean themselves up via the audit trigger" claim in the Sync ordering section.

**Mobile Drift query tests** in `timeline.repository.spec.dart` (or test file alongside):

- `_watchSharedSpaceBucket` returns correct bucket counts grouped by day.
- `_getSharedSpaceBucketAssets` returns assets ordered by `createdAt DESC` with correct offset/limit slicing.
- Space with zero assets returns empty bucket list.
- Space with assets from multiple owners returns all of them.

**Mobile sync handler tests**: follow the album handler test pattern in the same file. Critical case: insertion of a `SharedSpaceToAssetV1` before the corresponding asset row does not crash.

**Manual verification** (PR 1 is plumbing only — all user-visible assertions belong in PR 2):

- Fresh install → sync completes → inspect the Drift DB (via a debug screen or `adb pull` of the database file) and verify `shared_space`, `shared_space_member`, and `shared_space_asset` tables are populated with the expected rows.
- Manually invoke `DriftTimelineRepository.sharedSpace(spaceId)` from a test harness on a known space and verify the bucket and asset results match what the server returns for that space.
- Open a space in the existing UI → still uses `getSpaceAssets()`, still loads at the existing speed → confirm no regression.
- Add a photo to a space on the server → next sync populates both the existing path's response and the new `shared_space_asset` / `remote_asset` rows → confirm no crashes in sync handlers, no data corruption.
- Remove a member from a space → next sync delivers `SharedSpaceMemberDeleteV1` → verify the local member row is deleted and `shared_space_audit` on the server has fanned out the expected rows.

## PR 2 — Library-linked sync + UI switchover

### Server-side changes

**New `SyncEntityType` values** (grouped under the `// --- gallery-fork additions ---` marker from PR 1):

- `LibraryV1`, `LibraryDeleteV1` (2)
- `LibraryAssetCreateV1`, `LibraryAssetUpdateV1`, `LibraryAssetBackfillV1` (3)
- `LibraryAssetExifCreateV1`, `LibraryAssetExifUpdateV1`, `LibraryAssetExifBackfillV1` (3)
- `SharedSpaceLibraryV1`, `SharedSpaceLibraryDeleteV1`, `SharedSpaceLibraryBackfillV1` (3)

Total: **11 new values** in PR 2.

**New audit tables** in `migrations-gallery/`. Only one of the three (`library_audit`) uses per-user fan-out with transitive-access path checks; the other two are simpler.

#### `library_audit(libraryId, userId, deletedAt)` — per-user fan-out with transitive-access path checks

Library access is transitive: `library ← shared_space_library ← shared_space_member` (plus the direct `library.ownerId` ownership path and the `shared_space.createdById` creator path). Losing one membership only revokes library access if the user has no other path.

The audit is populated by **three** triggers. The third case from an earlier draft (trigger on `library` DELETE) is folded into case 1 via cascade: deleting a library cascades to `shared_space_library`, which fires case 1 for each linked space, which fans out per affected user. Case 3 (BEFORE-row on `shared_space`) was added during PR 2 implementation after the original two-trigger design failed for `DELETE FROM shared_space`: both AFTER triggers fire only after `shared_space_member` and `shared_space_library` rows have been cascade-cleared, so their joins find nothing. The BEFORE-row trigger captures the (member × library) and (creator × library) cartesian product while everything is still visible, mirroring PR 1's `shared_space_delete_audit` pattern.

**Helper: user-has-other-path subquery.** Used by both triggers, defined once as a SQL function or macro. Given `(targetLibraryId, targetUserId)`, returns true if the user retains any access path to the library. The path check unions `shared_space_member` and `shared_space.createdById` because the creator is not in the member table:

```sql
CREATE OR REPLACE FUNCTION user_has_library_path(
  target_library_id uuid,
  target_user_id uuid,
  exclude_space_id uuid  -- the space whose row is being deleted
) RETURNS boolean LANGUAGE SQL STABLE AS $$
  SELECT
    -- direct ownership
    EXISTS (SELECT 1 FROM library l WHERE l.id = target_library_id AND l.ownerId = target_user_id AND l.deletedAt IS NULL)
    OR
    -- another space where user is a member, and that space also links the library
    EXISTS (
      SELECT 1
      FROM shared_space_library ssl2
      INNER JOIN shared_space_member ssm2 ON ssm2.spaceId = ssl2.spaceId
      WHERE ssl2.libraryId = target_library_id
        AND ssm2.userId = target_user_id
        AND ssl2.spaceId <> exclude_space_id
    )
    OR
    -- another space where user is the creator, and that space also links the library
    EXISTS (
      SELECT 1
      FROM shared_space_library ssl3
      INNER JOIN shared_space ss3 ON ss3.id = ssl3.spaceId
      WHERE ssl3.libraryId = target_library_id
        AND ss3.createdById = target_user_id
        AND ssl3.spaceId <> exclude_space_id
    );
$$;
```

**Case 1: AFTER STATEMENT trigger on `shared_space_library` DELETE** — for each user affected by losing this link (every member of the space + the space creator), emit an audit row if they have no other path. Also records the join-row delete into `shared_space_library_audit` so the client can drop its local `sharedSpaceLibraryEntity` row. Invoked both on direct unlinking and on cascade from `library` deletion. **Skips during `shared_space` deletion via the `EXISTS shared_space` guard** — case 3 handles that path.

```sql
CREATE OR REPLACE FUNCTION shared_space_library_delete_audit()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
BEGIN
  -- 1. Always record the join-row delete so clients drop sharedSpaceLibraryEntity.
  INSERT INTO shared_space_library_audit ("spaceId", "libraryId")
  SELECT "spaceId", "libraryId" FROM "old";

  -- 2. Fan out library_audit per affected member only if no other path remains.
  --    EXISTS guard skips during shared_space cascade (case 3 handles that).
  INSERT INTO library_audit ("libraryId", "userId")
  SELECT o."libraryId", ssm."userId"
  FROM "old" o
  INNER JOIN shared_space_member ssm ON ssm."spaceId" = o."spaceId"
  WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
    AND NOT user_has_library_path(o."libraryId", ssm."userId", o."spaceId");

  -- 3. Creator of the unlinked space. INNER JOIN shared_space naturally skips
  --    during shared_space cascade because the parent row is gone.
  INSERT INTO library_audit ("libraryId", "userId")
  SELECT o."libraryId", ss."createdById"
  FROM "old" o
  INNER JOIN shared_space ss ON ss."id" = o."spaceId"
  WHERE NOT user_has_library_path(o."libraryId", ss."createdById", o."spaceId");

  RETURN NULL;
END $$;

CREATE TRIGGER shared_space_library_delete_audit
AFTER DELETE ON shared_space_library
REFERENCING OLD TABLE AS "old"
FOR EACH STATEMENT
EXECUTE FUNCTION shared_space_library_delete_audit();
```

**Case 2: AFTER STATEMENT trigger on `shared_space_member` DELETE** — for the removed user, for each library linked to that space, emit an audit row if they have no other path. **Skips during `shared_space` deletion via the `EXISTS shared_space` guard** — case 3 handles that path.

```sql
CREATE OR REPLACE FUNCTION shared_space_member_delete_library_audit()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
BEGIN
  INSERT INTO library_audit ("libraryId", "userId")
  SELECT ssl."libraryId", o."userId"
  FROM "old" o
  INNER JOIN shared_space_library ssl ON ssl."spaceId" = o."spaceId"
  WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
    AND NOT user_has_library_path(ssl."libraryId", o."userId", o."spaceId");

  RETURN NULL;
END $$;

CREATE TRIGGER shared_space_member_delete_library_audit
AFTER DELETE ON shared_space_member
REFERENCING OLD TABLE AS "old"
FOR EACH STATEMENT
EXECUTE FUNCTION shared_space_member_delete_library_audit();
```

**Case 3: BEFORE ROW trigger on `shared_space` DELETE** — handles whole-space deletion. Fires before any cascade so `shared_space_library` and `shared_space_member` rows are still visible. The BEFORE-row scope mirrors PR 1's `shared_space_delete_audit` pattern.

```sql
CREATE OR REPLACE FUNCTION shared_space_delete_library_audit()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
BEGIN
  INSERT INTO library_audit ("libraryId", "userId")
  SELECT DISTINCT "libraryId", "userId" FROM (
    SELECT ssl."libraryId", ssm."userId"
    FROM shared_space_library ssl
    INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssl."spaceId"
    WHERE ssl."spaceId" = OLD."id"
      AND NOT user_has_library_path(ssl."libraryId", ssm."userId", OLD."id")
    UNION
    SELECT ssl."libraryId", OLD."createdById"
    FROM shared_space_library ssl
    WHERE ssl."spaceId" = OLD."id"
      AND NOT user_has_library_path(ssl."libraryId", OLD."createdById", OLD."id")
  ) AS targets;

  RETURN OLD;
END $$;

CREATE TRIGGER shared_space_delete_library_audit
BEFORE DELETE ON shared_space
FOR EACH ROW
EXECUTE FUNCTION shared_space_delete_library_audit();
```

**Cascade ordering.** When a `library` is deleted, cascade fires `shared_space_library` DELETE → case 1 fires (the EXISTS guard passes because `shared_space` is still alive) → per-user audit rows are emitted. When a `shared_space` is deleted, case 3's BEFORE-row trigger fires first while everything is still visible and emits all (member × library) and (creator × library) audit rows; the subsequent cascade to `shared_space_library` and `shared_space_member` triggers cases 1 and 2, but their `EXISTS shared_space` guards fail (the parent row is gone) so they emit nothing for `library_audit`. Case 1's part-1 join-row audit (`shared_space_library_audit`) still fires unconditionally so the client can drop its local `sharedSpaceLibraryEntity` row.

#### `library_asset_audit(assetId, deletedAt)` — for individual asset deletes within a library

Purpose: propagate deletions of individual library assets (a photo removed from a library scan, or a library scan detecting a file removal) to mobile clients that have the library synced. Not to be confused with the `library_audit` path which handles losing access to a whole library.

Populated by one trigger only: on `asset` DELETE where `libraryId IS NOT NULL`. The trigger does not fan out per-user — emission is scoped at query time via `LibraryAssetSync.getDeletes`, which filters to assets whose `libraryId IN ACCESSIBLE_LIBRARIES(userId)`. This mirrors the `album_asset_audit` pattern.

**Not populated by**: `shared_space_library` DELETE (that's unlinking, not an asset delete) or direct `library` DELETE (that cascades to `asset` DELETE which fires this trigger directly).

#### `shared_space_library_audit(spaceId, libraryId, deletedAt)` — simple join-row audit

Purpose: client-side cleanup of the `sharedSpaceLibraryEntity` join table. When a library is unlinked from a space, the client needs to drop the local row so the Drift UNION query stops including that library's assets in that space's timeline. Not per-user — `getDeletes` scopes by `spaceId IN ACCESSIBLE_SPACES(userId)` at query time.

Populated by the same `shared_space_library_delete_audit` trigger as `library_audit` — the first `INSERT` statement in the function (see Case 1 above). Combining both audit writes in one trigger avoids a second trigger pass on the same event.

---

The `user_has_library_path` function is the correctness-critical new code. A bug here produces either stale mobile state (user keeps seeing a library they shouldn't) or premature deletion (user loses a library they should still see). Explicit test enumeration is in the Testing section below.

**Accessible libraries scoping** — the correctness-critical subquery used by `LibrarySync`, `LibraryAssetSync`, and `LibraryAssetExifSync`:

```
ACCESSIBLE_LIBRARIES(userId) :=
  -- Libraries the user owns directly
  SELECT id FROM library WHERE ownerId = userId AND deletedAt IS NULL
  UNION
  -- Libraries linked to any space the user can access
  SELECT ssl.libraryId
  FROM shared_space_library ssl
  WHERE ssl.spaceId IN ACCESSIBLE_SPACES(userId)
```

`ACCESSIBLE_SPACES` is the subquery defined in PR 1. This produces the complete set of library IDs the user can see via ownership or any space-linkage path. The UNION deduplicates automatically — if a user both owns library L and is a member of a space linking L, L appears once.

**New `Sync*` classes**:

- **`LibrarySync`** — `getCreates / getUpdates` scoped to `id IN ACCESSIBLE_LIBRARIES(userId)`. `getDeletes` reads `FROM library_audit WHERE userId = :userId` — per-user audit fan-out handles transitive access loss. Emits columns: `id, name, ownerId, createdAt, updatedAt`.
- **`LibraryAssetSync`** — emits full asset rows for assets whose `libraryId IN ACCESSIBLE_LIBRARIES(userId)`. Crucially, the query filters `asset` directly by `libraryId`, **not** by joining through `shared_space_library`. This is what gives the once-per-asset property: each asset has exactly one `libraryId`, so each asset matches the filter exactly once, regardless of how many spaces link the library. Emits the full `columns.syncAsset` payload. `getDeletes` reads from `library_asset_audit` scoped to assets whose library is in `ACCESSIBLE_LIBRARIES(userId)` — same scoping pattern as `AlbumAssetSync.getDeletes`.
- **`LibraryAssetExifSync`** — `asset_exif` rows joined to assets with `libraryId IN ACCESSIBLE_LIBRARIES(userId)`. Same ack-ordering pattern as `AlbumAssetExifSync`.
- **`SharedSpaceLibrarySync`** — `getCreates / getUpdates` scoped by `spaceId IN ACCESSIBLE_SPACES(userId)`. `getDeletes` reads from `shared_space_library_audit` with the same scoping.

**Wiring in `sync.service.ts`**: the iteration loop over new libraries follows the existing album pattern at `sync.service.ts:498-535`. The outer backfill checkpoint advances per `library.createId`, and per-library completion markers (`sendEntityBackfillCompleteAck`) gate individual backfills. When a `SharedSpaceLibraryV1` arrives for a library whose `createId` is past the client's backfill checkpoint and whose per-library completion marker is unset, the service triggers `LibraryAssetBackfillV1` for that library.

**Caveat — re-add after revocation**: if the client previously synced a library, lost access, and is then re-added, the server's backfill machinery may consider the library "already sent" (the checkpoint state is past that library's `createId` and the completion marker is set). In that case the backfill will not re-fire automatically and the user needs a full resync. This is the same limitation the existing album sync has — see Known limitations below. Not solved in this design.

**Known limitation (inherited from the album sync pattern)**: a user added to a pre-existing space whose linked library has content older than the user's backfill checkpoint will not automatically receive a backfill for that old content. This is the same limitation the existing album sync has — the backfill mechanism is keyed to `library.createId`, and old libraries that were already past the checkpoint don't re-trigger. Users in this situation need a full resync (app reinstall or a "resync from scratch" action). This design explicitly accepts the limitation rather than solving it, because solving it would require changes to the backfill mechanism affecting albums and other entity types — out of scope here.

**Asset immutability assumption**: this design assumes `asset.libraryId` is effectively immutable after insert. Libraries cascade-delete their assets (`asset.libraryId` has `ON DELETE CASCADE`), so library deletion does not migrate assets between libraries — it deletes them. Admin-driven mutations of `asset.libraryId` via direct DB access are out of scope and would leave stale mobile state until the next full resync. If a future feature needs mutable `libraryId`, an `asset_library_audit` table and corresponding sync event will be required; this design does not pre-build that machinery.

### Mobile-side changes

**New Drift entities**:

- `library.entity.dart` — `id` (PK), `name`, `ownerId`, `createdAt`, `updatedAt`.
- `shared_space_library.entity.dart` — composite PK `(spaceId, libraryId)`, `addedById`, `createdAt`. FK on `spaceId → sharedSpaceEntity` with cascade delete. No FK on `libraryId` (same looseness reasoning as `sharedSpaceAssetEntity` in PR 1).

Library assets do **not** get a new table. They reuse `remoteAssetEntity` with `libraryId` populated — the column already exists and has been library-aware since the beginning. This is what makes the UNION query trivial.

**Drift migration step**: add `libraryEntity` and `sharedSpaceLibraryEntity`. Indexes:

- `shared_space_library(spaceId)` — used by the UNION subquery.
- `remote_asset(libraryId)` — used by the UNION's second branch on every bucket/asset query.

A composite index `remote_asset(libraryId, createdAt)` is added **by default** — large library-linked spaces are the scale target, and the composite index is cheap insurance against a sort spill on the hot bucket query. The scale test verifies it is actually used; if the planner ignores it, it is dropped before merge, not after.

**Sync stream handlers**:

- `updateLibrariesV1` / `deleteLibrariesV1`
- `updateLibraryAssetsV1` / `deleteLibraryAssetsV1` — reuse the shared helper introduced in PR 1 that inserts into `remoteAssetEntity`
- `updateLibraryAssetExifsV1`
- `updateSharedSpaceLibrariesV1` / `deleteSharedSpaceLibrariesV1`

**Timeline query update** — `DriftTimelineRepository.sharedSpace()` gains the UNION branch. This is the first time the query method is actually exercised end-to-end (PR 1 added the method but did not wire it to any UI):

```sql
SELECT ... FROM remote_asset
WHERE remote_asset.deletedAt IS NULL
  AND (
    remote_asset.id IN (SELECT assetId FROM shared_space_asset WHERE spaceId = ?)
    OR remote_asset.libraryId IN (SELECT libraryId FROM shared_space_library WHERE spaceId = ?)
  )
```

Both the bucket watcher and the asset fetcher use the same `WHERE` clause. The `SELECT DISTINCT` is implicit because both branches select from `remote_asset` and the primary key deduplicates — an asset that is both directly added AND library-linked appears exactly once.

**Wire up `SpaceDetailPage`**: replace `_loadData()` + `_assets` state with a `ProviderScope` override on `timelineServiceProvider`, exactly as `drift_remote_album.page.dart:181` does. The page no longer shows a loading spinner for asset fetch. Member list and space metadata still load through `GET /spaces/:id` (fast, small response).

**Delete dead code**: remove `SharedSpaceApiRepository.getSpaceAssets`, `_parseDuration`, and the timeline API coupling in `shared_space_api.repository.dart`.

### Data flow — PR 2

On first sync after the release containing both PRs lands on a device:

1. `LibraryV1` events populate `libraryEntity` for all libraries the user can see.
2. For each new library: `LibraryAssetBackfillV1` streams the library's assets into `remoteAssetEntity`, `LibraryAssetExifBackfillV1` streams exif.
3. `SharedSpaceLibraryV1` events populate `sharedSpaceLibraryEntity`.

Note: PR 1's new Drift tables and PR 2's new tables arrive in the same release, applied via sequential migration steps in `db.repository.steps.dart`. Ordering within the release: PR 1 migration runs first, then PR 2 migration — enforced by the numeric migration step ordering, not by the PR split.

After initial sync, opening any space runs the Drift UNION query locally — library-linked spaces are now as fast as direct-add spaces.

Incremental updates:

- New photo discovered in a library scan → `LibraryAssetCreateV1` → asset appears in `remoteAssetEntity`. Because the Drift query is reactive and UNIONs through `sharedSpaceLibraryEntity`, every open space view that links that library updates automatically. Zero additional per-space events on the wire.
- Library linked to a new space → `SharedSpaceLibraryV1` → join row inserted → the UNION now includes those assets for that space.
- Library unlinked from a space → `SharedSpaceLibraryDeleteV1` → join row deleted → the UNION drops those assets for that space. Library assets themselves remain in `remoteAssetEntity` because they may still be visible through another space or via direct ownership.

### Access revocation and garbage collection — PR 2

PR 2 handles access revocation through **audit-trigger per-user fan-out**, the same mechanism the existing album sync uses for "user removed from album" (see `AlbumSync.getDeletes` at `sync.repository.ts:156-162` and the trigger at `migrations/1747664684909-AddAlbumAuditTables.ts:25-42`). There is no reconciliation endpoint, no client-side ack-reset, no separate sweep pass — all GC is driven by delete events arriving through the sync stream.

The trick is that for libraries — unlike albums — access is transitive (library ← shared_space_library ← shared_space_member). Losing one membership doesn't necessarily lose library access if another path exists. The two triggers described above (`library_audit` case 1 on `shared_space_library` DELETE and case 2 on `shared_space_member` DELETE) use the `user_has_library_path` function to compute this at delete time, so the stream only emits `LibraryDeleteV1` events to users who have genuinely lost access. The load-bearing work happens at trigger time, not at every sync tick.

**Mobile handling**: when the client receives a `LibraryDeleteV1` event, the sync handler does two things in a single Drift batch:

1. Delete the local `libraryEntity` row.
2. Sweep asset rows that belonged to that library and are no longer reachable via another path:

```sql
DELETE FROM remote_asset
WHERE libraryId = :deletedLibraryId
  AND ownerId != :currentUserId
  AND ownerId NOT IN (
    SELECT sharedById FROM partner_entity WHERE sharedWithId = :currentUserId
  )
  AND id NOT IN (SELECT assetId FROM shared_space_asset)
```

The `partner_entity` clause preserves library assets that the user reaches via partner sharing (partners' libraries may become visible via `PartnerAssetV1` independently of space membership). The `shared_space_asset` clause preserves assets that were also directly added to a space — the direct-add path still makes them visible. This sweep runs inline in the delete handler, not as a separate reconciliation pass.

`SharedSpaceLibraryDeleteV1` events arrive independently for the `sharedSpaceLibraryEntity` join table. When they arrive, the mobile handler deletes the local join row — which by itself already removes those assets from the affected space's timeline (because the Drift UNION query no longer includes that library). If the library is _also_ being fully revoked for the user, a `LibraryDeleteV1` follows (emitted by the same trigger cascade on the server) and the asset sweep runs then.

Scenarios handled:

- **User removed from the last space linking a library**: server trigger on `shared_space_member` DELETE checks `NOT EXISTS` → fires `library_audit` row for that user → server streams `LibraryDeleteV1` → client deletes `libraryEntity` + sweeps orphan assets.
- **Library unlinked from one space but still linked to another the user is in**: server trigger's `NOT EXISTS` finds the other space → no `library_audit` row → client only receives `SharedSpaceLibraryDeleteV1`, drops the join row, assets remain visible through the other space.
- **Library deleted server-side**: `library` DELETE cascades to `shared_space_library` for every space that linked it → case 1 trigger fires per cascaded row → fan-out `library_audit` rows for every affected user across all those spaces → stream emits `LibraryDeleteV1` → standard delete flow.
- **Library unlinked from ALL spaces but library still exists on the server**: each `shared_space_library` DELETE fires the trigger; the last one's `NOT EXISTS` returns true → `library_audit` row emitted → standard delete flow.
- **User re-added to a space linking a previously-removed library**: `SharedSpaceLibraryV1` arrives; if the library itself is not in the user's local state and the server's per-library backfill tracking doesn't consider it "already sent" to this client, the backfill fires. If it _does_ consider it already sent (because the checkpoint state was not reset), the user will need a full resync — this matches the same limitation the existing album sync has for users added to pre-existing albums. Out of scope to solve here; documented under Known limitations.

The critical correctness boundary is the trigger's `NOT EXISTS` clauses. Every scenario above needs an explicit medium test that asserts the right audit rows are emitted (or not) for every revocation path.

### Testing — PR 2

**Server unit tests**:

- `LibrarySync.getCreates` emits libraries the user owns.
- `LibrarySync.getCreates` emits libraries linked via a space the user is a member of.
- `LibrarySync.getCreates` emits libraries linked via a space the user created (creator path, no member row).
- `LibrarySync.getCreates` does not emit libraries the user has no path to.
- `LibrarySync.getCreates` does not emit soft-deleted libraries (`deletedAt IS NOT NULL`).
- `LibraryAssetSync.getCreates` emits each asset exactly once regardless of the number of space-library linkages.
- `LibraryAssetSync.getCreates` respects the same access scoping.
- `LibraryAssetSync.getCreates` does not emit assets from a library the user lost access to.
- `SharedSpaceLibrarySync.getDeletes` includes unlinked libraries (via the new audit table).
- `SharedSpaceLibrarySync.getBackfill` returns all library links for a specific space.

**Server trigger / medium tests** — the `user_has_library_path` function and its two triggers are the correctness-critical new code.

Direct unit tests on `user_has_library_path`:

- `user_has_library_path_returns_true_for_owner` — user owns library L. Function returns true regardless of other arguments.
- `user_has_library_path_returns_true_for_member_of_other_space` — user is a member of space B which also links L, `exclude_space_id` is A. Function returns true.
- `user_has_library_path_returns_true_for_creator_of_other_space` — user is creator of space B which also links L, not in `shared_space_member`, `exclude_space_id` is A. Function returns true.
- `user_has_library_path_returns_false_when_excluded_space_is_only_path` — user is only reachable to L through the excluded space. Function returns false.
- `user_has_library_path_ignores_soft_deleted_libraries` — user owns L but L has `deletedAt IS NOT NULL`. Function returns false on the owner branch (still returns true if another path exists).

Trigger / end-to-end scenarios (integration with the triggers):

- `trigger_member_removed_library_still_visible_via_other_space` — user is in spaces A and B, both link library L. User removed from A. Assert `library_audit` has NO row for (L, user).
- `trigger_member_removed_library_not_visible_anywhere_else` — user is only in space A, linking library L. User removed from A. Assert exactly one `library_audit` row for (L, user).
- `trigger_member_removed_user_is_library_owner` — user owns library L, is also in space A which links L. User removed from A. Assert NO `library_audit` row for (L, user) (ownership preserves access).
- `trigger_member_removed_user_is_creator_of_other_space` — user is creator of space B which links L, member of space A which also links L. User removed from A. Assert NO `library_audit` row (creator path preserves access).
- `trigger_library_unlinked_one_of_two_spaces` — library L linked to spaces A and B, user is in both. L unlinked from A. Assert NO `library_audit` rows for any user still in B.
- `trigger_library_unlinked_last_space` — library L linked only to space A. L unlinked. Assert `library_audit` rows for every member + creator of A.
- `trigger_library_deleted_cascades_to_per_user_audit` — library L linked to three spaces with overlapping and disjoint members. Delete L directly. Assert cascade to `shared_space_library` fires case 1 for each of the three spaces, and `library_audit` contains exactly one row per unique affected user across the union of all three spaces (no duplicates).
- `trigger_space_deleted_cascade` — space A (linking library L, with three members plus a creator) is deleted. Cascade fires both `shared_space_member` DELETE and `shared_space_library` DELETE. Assert `library_audit` receives the correct rows exactly once per affected user (no double-counting via `pg_trigger_depth` guard).
- `trigger_creator_check_uses_createdById_not_member_table` — user creates a space linking library L, is not in `shared_space_member`. Delete the space. Assert the creator receives a `library_audit` row (the creator path in the trigger works).
- `trigger_simultaneous_member_and_library_unlink` — two concurrent transactions, one removing user from the space and one unlinking the library from the same space. Assert the result is consistent (no duplicate rows, no missing rows) under Postgres's default isolation level.

**Server medium test — end-to-end access control**: user A owns libraries L1 and L2, creates space S, links both. User B joins S. Run sync for B. Verify B receives both libraries, receives every asset in L1 and L2 exactly once, receives both `shared_space_library` rows, does not receive library assets from libraries outside S. Then remove B from S and re-run sync for B. Verify B receives `LibraryDeleteV1` for both L1 and L2. Then re-add B to S. Verify the re-add behaviour matches the Known Limitations section (backfill may or may not re-fire; document the observed behaviour).

**Mobile Drift query tests**:

- UNION returns direct-add assets only (space with direct-add, no library links).
- UNION returns library assets only (space with library link, no direct-add).
- UNION returns the sum of both, with no duplication when an asset is both directly added and library-linked (asset id appears once in the result).
- UNION correctly handles empty branches (`shared_space_asset` empty but `shared_space_library` populated; and vice versa).
- Removing a `sharedSpaceLibraryEntity` row removes those assets from that space's timeline view (reactive stream fires).
- Inserting a new `remoteAssetEntity` row with a `libraryId` matching a linked space fires the reactive stream and the timeline updates without manual refresh. This exercises the load-bearing Drift `.watch()` propagation through the UNION.
- Inserting a new `sharedSpaceLibraryEntity` row for an already-populated library fires the reactive stream and the space timeline starts including that library's existing assets. This is the "user links a new library to an existing space" flow — the most common day-to-day path.
- `libraryId` index is used (check via `EXPLAIN QUERY PLAN` in test).
- `LibraryDeleteV1` handler is a safe no-op when the library is not in the local `libraryEntity` (e.g., the event arrived before the corresponding `LibraryV1`).
- `SharedSpaceLibraryV1` arriving before `LibraryV1` — the UNION query correctly includes matching assets even though `libraryEntity` has no row for that library (the UNION references `shared_space_library` directly, not `libraryEntity`).

**Mobile sync handler tests — `LibraryDeleteV1` inline sweep**:

- Sweep preserves library asset owned by current user (should not happen in practice but belt-and-braces): not deleted.
- Sweep preserves library asset owned by an active partner: not deleted.
- Sweep preserves library asset also present in `shared_space_asset` (directly added to some space): not deleted.
- Sweep deletes foreign library asset reachable only via the now-deleted library: deleted.
- Sweep after handling concurrent `LibraryDeleteV1` events for two libraries leaves both sets correctly cleaned up.
- Sweep runs in a single Drift batch transaction — if any part fails, none of the rows are modified.

**Scale test — blocking deliverable on PR 2:**

Create a synthetic library with 100k assets in a test database, sync it to mobile, and measure:

- Server stream wall-clock
- Mobile insert wall-clock and Drift DB size delta
- Resident memory during insert
- Timeline query wall-clock on a 100k-asset space

The measurements **must be captured and documented in the PR description** before PR 2 merges. No specific numeric thresholds are pre-committed — the targets below are expectations, not gates. Significant deviation from any target requires an explicit justification and sign-off in review, not an automatic block.

Expected targets (not hard gates):

- Mobile resident memory during backfill: ~500 MB order of magnitude
- Backfill completes in "single-digit minutes" on a mid-range device
- Timeline bucket query under ~200 ms

If measurements are dramatically worse than expected, the most likely remediation is chunking the single-batch insert in `sync_stream.repository.dart`. That change lands in PR 2 alongside the sync handlers, not as a deferred follow-up — we commit to shipping PR 2 with known scale characteristics, whatever they turn out to be.

**Manual verification**:

- Create a library with 1000 photos, link it to a space on the server → mobile syncs → opens space instantly with all library content visible.
- Unlink the library → mobile timeline drops those assets reactively.
- Receive new photo in the library → timeline updates without manual refresh.
- Uninstall + reinstall the app → full re-sync completes within an acceptable window.

## Components summary

| Layer                 | Component                               | PR 1                                  | PR 2                                                                  |
| --------------------- | --------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| Server enum           | `SyncEntityType` additions              | 14 values                             | 11 values                                                             |
| Server migrations     | Audit tables + triggers                 | 3 tables                              | 3 tables (one with transitive-access trigger)                         |
| Server sync classes   | `sync.repository.ts`                    | 5 classes                             | 4 classes                                                             |
| Server wiring         | `sync.service.ts`                       | ~100 LoC                              | ~80 LoC                                                               |
| Mobile entities       | `infrastructure/entities/*.dart`        | 3                                     | 2                                                                     |
| Mobile migrations     | `db.repository.steps.dart`              | 1 step                                | 1 step                                                                |
| Mobile sync handlers  | `sync_stream.repository.dart`           | ~250 LoC                              | ~200 LoC (including inline orphan sweep in `LibraryDeleteV1` handler) |
| Mobile timeline query | `timeline.repository.dart`              | new `sharedSpace()` (direct-add only) | extend with UNION                                                     |
| Mobile UI             | `space_detail.page.dart`                | no change                             | rewire to Drift, delete old path                                      |
| Tests                 | server spec + mobile spec + medium test | ~600 LoC                              | ~700 LoC                                                              |

Rough total: 1500–2500 LoC net, most of which is boilerplate cloned from the album template.

## Resolved questions

- **`showInTimeline = false`**: the sync stream emits space content for members regardless of this setting. `showInTimeline` is a display-only filter for the main library timeline query, not a sync gate. Spaces with `showInTimeline=false` still sync fully; the main timeline simply excludes their contents when composing the merged view.

(Partner-shared assets in spaces and live-photo companions are discussed in the Error handling section — no separate resolution needed.)

## Known limitations (accepted, matching existing sync behavior)

- **User added to pre-existing space/library won't see old content without a full resync.** The backfill mechanism is keyed to `createId` — content predating the client's checkpoint is not automatically re-backfilled for newly-joined users. This is the same limitation the existing album sync has; we accept it rather than solve it, because solving it requires changes to the backfill mechanism affecting albums and other entity types.
- **Foreign asset hard-deletes are only audited to the owner.** `AssetSync.getDeletes` scopes by `ownerId = userId` (`sync.repository.ts:393`). A user with a foreign library asset synced locally won't receive a direct delete event when that asset is hard-deleted. The local `LibraryDeleteV1` handler's inline sweep catches this case whenever the whole library goes away; for individual asset deletes mid-library, the stale row remains until the next full resync. Matches existing album behavior.

## Open questions

- **Library ownership display**: when a foreign library asset is shown in a space, does the UI need a small badge indicating its origin library? Out of scope for this design; follow-up if needed.
- **Per-space mobile sync opt-out**: future enhancement for power users who want to be a member of large spaces without syncing them to their phone. Explicitly deferred; see the Library linkage contract section.
- **`asset.libraryId` admin mutation**: out of scope by stated assumption. If admin tools ever allow mutating this column at runtime, a follow-up design will need to add an asset-library audit stream.

## Risks and mitigations

- **Library access control leak**: the `LibrarySync` / `LibraryAssetSync` scoping query is the highest-risk new code in PR 2. Mitigation: dedicated medium test against a real Postgres with multiple users, exercising membership, non-membership, revoked-membership, owned-but-unlinked, and linked-through-multiple-spaces scenarios. Plus manual multi-user verification on a staging instance before release.
- **`library_audit` trigger `NOT EXISTS` correctness**: the transitive-access path checks in the trigger functions are the new correctness-critical code path. A bug here produces either stale mobile state (user keeps seeing a library they shouldn't) or premature deletion (user loses a library they should still see). Mitigation: the medium test covers every revocation path (member removed with other spaces still linked, member removed with no other path, library unlinked from one of multiple spaces, library unlinked from the last space, library deleted, member who is also the library owner) with assertions on the audit table state after each operation.
- **`ACCESSIBLE_LIBRARIES` drift**: the subquery is used by multiple sync classes. Any divergence between copies is a silent access-control bug. Mitigation: define the subquery once in a shared repository method referenced by every call site.
- **Untested sync scale at 100k+**: mitigation is the blocking scale-test deliverable on PR 2.
- **Drift migration rollback**: adding tables is forward-compatible. If a PR has to be reverted post-release, the unused tables can be dropped in a follow-up migration without data loss.
- **Upstream rebase conflicts**: new `SyncEntityType` enum values and new code in `sync.service.ts` / `sync.repository.ts` will conflict predictably on upstream rebases. Mitigation: all fork additions are placed at the end of the enum under an explicit marker comment, and new sync classes live in dedicated sections. Audit tables are isolated in `migrations-gallery/`.
- **Old mobile clients receiving new sync entity types**: the single-release assumption is enforced by convention, not mechanism. As a safety net, confirm during PR 1 review that the existing mobile sync coordinator ignores unknown `SyncEntityType` values gracefully (does not crash, simply logs and advances the ack). The album sync handler loop is the reference. If it does not handle unknowns safely, the fix is a one-line default case before PR 1 merges.

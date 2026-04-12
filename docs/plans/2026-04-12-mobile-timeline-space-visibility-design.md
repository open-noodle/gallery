# Mobile timeline space visibility — design

**Date:** 2026-04-12
**Status:** Approved, pending implementation plan

## Problem

Four mobile Drift queries don't honor shared-space visibility rules, so viewers either miss assets they should see or see assets they shouldn't:

| Method                            | File:line                      | Current filter           | Bug                                                                                                                                                                      |
| --------------------------------- | ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DriftTimelineRepository.video()` | `timeline.repository.dart:482` | `ownerId.equals(userId)` | Misses videos in shared spaces where the viewer is a member with `showInTimeline=true`. Also misses partner videos.                                                      |
| `DriftTimelineRepository.map()`   | `timeline.repository.dart:640` | `ownerId.isIn(userIds)`  | Feeds the map bottom sheet's thumbnail bucket. Misses shared-space photos.                                                                                               |
| `DriftTimelineRepository.place()` | `timeline.repository.dart:492` | (none)                   | No ownership filter at all — silently leaks any asset in the local DB whose exif city matches, including partner and shared-space assets regardless of `showInTimeline`. |
| `DriftMapRepository.remote()`     | `map.repository.dart:16`       | `ownerId.isIn(ownerIds)` | Map marker pin query (parallel bug to `map()` above). Misses shared-space photos.                                                                                        |

The main mobile timeline already handles these cases correctly in `mobile/lib/infrastructure/entities/merged_asset.drift`, whose comment states: _"mirrors the server's TimeBucket query which OR-joins ownerId with timelineSpaceIds."_ This design brings the four broken queries to parity with the main timeline.

## Visibility rule

```
visible(asset, viewer) =
     asset.ownerId IN timelineUserIds(viewer)         -- self + partners with inTimeline=true
  OR EXISTS shared_space_asset WHERE asset_id = asset.id
       AND member(space_id, viewer).showInTimeline = true
  OR EXISTS shared_space_library WHERE library_id = asset.libraryId
       AND member(space_id, viewer).showInTimeline = true
```

This matches the server's `TimelineService.getTimeBucketOptions` path with `withPartners=true` and `withSharedSpaces=true`, and matches `merged_asset.drift`'s `mergedAsset` / `mergedBucket` queries exactly.

## Shared helper

New file: `mobile/lib/infrastructure/repositories/viewer_visibility.dart`.

Drift has a documented reactivity trap: `.watch()` streams only subscribe to tables reached through real `FROM` / `JOIN` clauses. Tables reached via `isInQuery` subqueries are invisible to `readsFrom`, so streams go stale. The existing `sharedSpace()` method in `timeline.repository.dart` works around this by using `LEFT OUTER JOIN` for its bucket path and `isInQuery` for its asset-list path (which is one-shot `.get()`, so reactivity doesn't apply). We mirror that split.

### (1) `applyViewerVisibilityJoins` — for bucket queries (`.watch()`)

```dart
typedef ViewerVisibilityJoin = ({
  $SharedSpaceMemberEntityTable assetMember,
  $SharedSpaceMemberEntityTable libraryMember,
});

ViewerVisibilityJoin applyViewerVisibilityJoins(
  Drift db,
  JoinedSelectStatement query,
  $RemoteAssetEntityTable assetTable,
  String currentUserId,
);
```

Mutates `query` by adding four `LEFT OUTER JOIN`s:

1. `shared_space_asset ssa ON ssa.asset_id = assetTable.id`
2. `shared_space_member ssm_asset ON ssm_asset.space_id = ssa.space_id AND ssm_asset.user_id = :currentUserId AND ssm_asset.show_in_timeline = true`
3. `shared_space_library ssl ON ssl.library_id = assetTable.library_id`
4. `shared_space_member ssm_lib ON ssm_lib.space_id = ssl.space_id AND ssm_lib.user_id = :currentUserId AND ssm_lib.show_in_timeline = true`

Returns the two aliased `shared_space_member` tables so the caller writes the WHERE predicate:

```dart
final viz = applyViewerVisibilityJoins(_db, query, _db.remoteAssetEntity, currentUserId);
query.where(
  _db.remoteAssetEntity.deletedAt.isNull() &
  _db.remoteAssetEntity.type.equalsValue(AssetType.video) &
  _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
  (_db.remoteAssetEntity.ownerId.isIn(userIds) |
      viz.assetMember.userId.isNotNull() |
      viz.libraryMember.userId.isNotNull()),
);
```

Bucket counts use `COUNT(DISTINCT remoteAssetEntity.id)` because an asset in multiple spaces produces multiple JOIN rows. Same pattern already in `_watchSharedSpaceBucket`.

### (2) `viewerVisibilityPredicate` — for asset-list and marker queries (`.get()`)

```dart
Expression<bool> viewerVisibilityPredicate(
  Drift db,
  $RemoteAssetEntityTable assetTable,
  List<String> userIds,
  String currentUserId,
);
```

Returns an `Expression<bool>` composed from two `isInQuery` subqueries (one for `shared_space_asset + member`, one for `shared_space_library + member`), OR-ed with `assetTable.ownerId.isIn(userIds)`. Caller ANDs it into their `.where()` clause.

Because `isInQuery` is set-membership (`rae.id IN (SELECT ...)`), it naturally deduplicates — no `GROUP BY` dance needed. This matches the existing `_getSharedSpaceBucketAssets` pattern, and sidesteps an unverified Drift codegen pattern (`GROUP BY primary_key` on a `.select()..join()..readTable(...)` query).

Both functions are public so `DriftMapRepository` can import them from `DriftTimelineRepository`'s sibling file.

## Per-method changes

### `DriftTimelineRepository.video()`

```dart
TimelineQuery video(List<String> userIds, String currentUserId, GroupAssetsBy groupBy)
```

- Stops using `_remoteQueryBuilder` (its filter-lambda API can't compose external joins).
- New dedicated `_watchVideoBucket(userIds, currentUserId, groupBy)`:
  - `selectOnly()` on `remoteAssetEntity`, call `applyViewerVisibilityJoins`, add count + date expressions
  - WHERE: `deletedAt.isNull() & type=video & visibility=timeline & viewerVisible`
  - `COUNT(DISTINCT rae.id)`, `GROUP BY dateExp`, `ORDER BY dateExp DESC`
- New dedicated `_getVideoBucketAssets(userIds, currentUserId, offset, count)`:
  - Typed `.select()` with WHERE including `& viewerVisibilityPredicate(...)`
  - `ORDER BY createdAt DESC`, `LIMIT count OFFSET offset`

### `DriftTimelineRepository.place()`

```dart
TimelineQuery place(String place, List<String> userIds, String currentUserId, GroupAssetsBy groupBy)
```

- `_watchPlaceBucket(place, userIds, currentUserId, groupBy)`:
  - Keeps the `INNER JOIN remoteExifEntity ON exif.assetId = rae.id` for the city filter
  - Calls `applyViewerVisibilityJoins` to add the 4 visibility joins
  - WHERE: `city = :place & deletedAt.isNull() & visibility=timeline & viewerVisible`
  - `COUNT(DISTINCT rae.id)`
- `_getPlaceBucketAssets(place, userIds, currentUserId, offset, count)`:
  - Keeps the exif join for city filter
  - WHERE adds `& viewerVisibilityPredicate(...)`

**Behavior change:** `place()` currently has no ownership scoping at all. Any asset with a matching exif city in the local DB appears. After this fix, `place()` narrows to `owner + partners + shared-space`. Assets the viewer shouldn't have seen will no longer appear. The commit message will call this out explicitly so it's not filed as a regression.

### `DriftTimelineRepository.map()` (bucket sheet)

```dart
TimelineQuery map(List<String> userIds, String currentUserId, TimelineMapOptions options, GroupAssetsBy groupBy)
```

- `_watchMapBucket(userIds, currentUserId, options, groupBy)`:
  - Keeps the `INNER JOIN remoteExifEntity` for `inBounds`
  - Calls `applyViewerVisibilityJoins`
  - WHERE: `inBounds & visibility IN (timeline [, archive]) & deletedAt.isNull() & viewerVisible`
  - Dynamic filters (`onlyFavorites`, `relativeDays`) stay as additional `.where()` calls
  - `COUNT(DISTINCT rae.id)`
- `_getMapBucketAssets(userIds, currentUserId, options, offset, count)`:
  - Exif join + bounds
  - WHERE includes `& viewerVisibilityPredicate(...)`
  - Existing dynamic filters preserved

### `DriftMapRepository.remote()` (map marker pins)

```dart
MapQuery remote(List<String> userIds, String currentUserId, TimelineMapOptions options)
```

- Pure `.get()` path (the method name `_watchMapMarker` is misleading — it's `async` + `.get()`, not a stream).
- Swap `row.ownerId.isIn(ownerIds)` in the filter lambda for `viewerVisibilityPredicate(db, row, userIds, currentUserId)`, AND-ed with the existing visibility / `onlyFavorites` / `relativeDays` clauses.
- No new joins, no GROUP BY, no reactivity concern.

## Call sites

| Call site                         | Change                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `drift_video.page.dart:24`        | Watch `currentUserProvider` + `timelineUsersProvider`, pass `(users, user.id)`      |
| `drift_place_detail.page.dart:19` | Add `currentUserProvider` + `timelineUsersProvider`, pass `(place, users, user.id)` |
| `map_bottom_sheet.widget.dart:47` | Already has `users`, add `user.id`                                                  |
| `map.provider.dart:22`            | Already has `users`, add `user.id`                                                  |

Loading fallback everywhere: `ref.watch(timelineUsersProvider).valueOrNull ?? [user.id]`. On first build, while partners are still loading, the viewer sees only their own + shared-space assets; once the stream emits, partners join and the query re-runs. Standard Riverpod flow, matches existing main-timeline behavior.

### Service-layer wrappers

Three methods in `mobile/lib/domain/services/timeline.service.dart` get extended signatures:

- `TimelineFactory.video(String userId)` → `video(List<String> userIds, String currentUserId)`
- `TimelineFactory.place(String place)` → `place(String place, List<String> userIds, String currentUserId)`
- `TimelineFactory.map(List<String> userIds, TimelineMapOptions options)` → `map(List<String> userIds, String currentUserId, TimelineMapOptions options)`

`MapFactory.remote()` in `mobile/lib/domain/services/map.service.dart` gets the same treatment.

## Testing

Extend `mobile/test/infrastructure/repositories/timeline_repository_test.dart` (already uses `NativeDatabase.memory()` with real tables).

### Full helper matrix via `video()` — 10 tests

1. Owner asset → visible
2. Partner asset (owner in `userIds`) → visible
3. Unrelated user asset → hidden
4. Space asset, viewer member, `showInTimeline=true` → visible
5. Space asset, viewer member, `showInTimeline=false` → hidden
6. Space asset, viewer NOT a member → hidden
7. Library-in-space, `showInTimeline=true` → visible
8. Library-in-space, `showInTimeline=false` → hidden
9. Asset in 2 spaces → counted once in bucket, returned once in asset list
10. Image asset reachable via space → hidden (type filter still applies)

### Method-specific tests

**`place()` (3):** wrong-city hidden; right-city via space visible; reactivity (delete `shared_space_asset` row, assert bucket stream re-emits).

**`map()` (4):** out-of-bounds hidden; in-bounds via space visible; `relativeDays` cutoff interaction; reactivity.

**`DriftMapRepository.remote()` (2):** owner marker; space-visible marker. No reactivity test — `Future`, not `Stream`.

**`video()` reactivity (1):** bucket stream re-emits on `shared_space_asset` delete.

**Total: ~20 tests.**

## Out of scope

- **Stack primary-asset filter.** `merged_asset.drift:73-76` excludes non-primary stack assets. None of `video`/`map`/`place` currently do this; it's a pre-existing inconsistency and orthogonal to shared-space visibility.
- **Favorites/archive + partners/spaces interaction.** Server forbids `withPartners`+`withSharedSpaces` when `isFavorite` or `visibility=archive`. Mobile `map()` already allows all combinations. This fix preserves the mobile-specific divergence and adds a doc comment on `_watchMapBucket` flagging it for a future alignment pass.
- **Viewer-specific favorites on foreign assets.** `isFavorite` on a shared-space asset reflects the owner's flag, not the viewer's — pre-existing limitation shared with the server.

## Rollout

- Single PR, mobile-only.
- No server changes, no OpenAPI regen, no Dart codegen, no migration.
- Verification: `cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart` + `flutter analyze`.
- Manual smoke test: create a shared space, toggle `showInTimeline`, verify video / place / map bucket / map marker views all update.

## Risks

| Risk                                                                                                      | Mitigation                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Drift aliased-join reactivity doesn't propagate to the base `shared_space_member` table's `readsFrom` set | Reactivity tests (one per `.watch()` method) delete a row and assert the stream re-emits                       |
| `isInQuery` in `.get()` paths silently introduces a reactivity bug                                        | `.get()` paths don't use `.watch()` — reactivity doesn't apply. Bucket paths use real LEFT JOINs where it does |
| `place()` visibility narrowing surprises users who relied on the leak                                     | Commit message calls out the visibility tightening explicitly                                                  |

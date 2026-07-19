# Stacked Photos in Spaces — Slice S3 Implementation Plan (Mobile: collapse the aggregated-Space timeline)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The mobile aggregated-Space timeline collapses a stack to its cover (one tile, correct count), exactly like the main timeline. The space-**album** detail timeline is intentionally left uncollapsed (parity with web/albums).

**Architecture:** Add a `LEFT OUTER JOIN stack_entity` + the collapse predicate `(stack_id IS NULL OR remote_asset.id = stack.primary_asset_id)` to the three Drift query builders that serve the aggregated-Space timeline. Mirrors the raw-SQL collapse in `merged_asset.drift`. No schema change, no codegen.

**Tech Stack:** Flutter 3.44.1 (pinned), Drift (in-memory Postgres-less SQLite for tests), `flutter_test`.

Spec: `docs/superpowers/specs/2026-07-06-spaces-stacked-photos-design.md` (Slice S3; edge cases E20–E23).

## Global Constraints

- Flutter **3.44.1** via mise. Run mobile commands from `mobile/` as `mise exec -- flutter <...>`.
- These DB-layer tests need only `flutter pub get` + `flutter test <path>` — NO `easy_localization:generate` / `generate_keys.dart` (the timeline/DB import graph never touches `lib/generated/`). Drift generated code is committed.
- Modify ONLY the two aggregated-Space builders (`_watchSharedSpaceBucket` — both its `groupBy == none` count query AND its grouped query — and `_getSharedSpaceBucketAssets`). Do NOT touch `_watchSpaceAlbumBucket` / `_getSpaceAlbumBucketAssets` (the album-detail path must stay uncollapsed).
- Collapse semantics (from `merged_asset.drift:74-77`): keep an asset iff `stack_id IS NULL OR remote_asset.id = stack_entity.primary_asset_id`.
- Drift column accessors: `_db.remoteAssetEntity.stackId` (SQL `stack_id`, nullable), `_db.stackEntity.id`, `_db.stackEntity.primaryAssetId`.

---

### Task 1: Add stack-collapse to the aggregated-Space builders (test-first)

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart` (three query builders inside `_watchSharedSpaceBucket` and `_getSharedSpaceBucketAssets`).
- Modify: `mobile/test/medium/repositories/timeline_repository_test.dart` (add a `group` of tests).

**Interfaces:** none new — behavior change to existing `sut.sharedSpace(...)` queries.

- [ ] **Step 1: Write the failing tests**

Add these imports at the top of `mobile/test/medium/repositories/timeline_repository_test.dart` (alongside the existing imports):

```dart
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/infrastructure/entities/stack.entity.drift.dart';
```

Add this `group` inside `main()` (after the existing tests). It uses the existing `MediumRepositoryContext` helpers `ctx.newUser()`, `ctx.newSharedSpace(createdById:)`, `ctx.newRemoteAsset(ownerId:, stackId:, createdAt:)`, `ctx.insertSharedSpaceAsset(spaceId:, assetId:)`, and (for E21) `ctx.newSharedSpaceAlbum()`, `ctx.insertSharedSpaceAlbumLink(spaceId:, albumId:, showInTimeline:)`, `ctx.insertSharedSpaceAlbumAsset(albumId:, assetId:)`. There is no stack-row helper, so the `stack_entity` row is inserted directly.

```dart
  group('aggregated-space stack collapse (S3)', () {
    const stackId = 'stack-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    Future<void> insertStack(String id, String ownerId, String primaryAssetId) => ctx.db
        .into(ctx.db.stackEntity)
        .insert(StackEntityCompanion.insert(id: id, ownerId: ownerId, primaryAssetId: primaryAssetId));

    test('collapses a 3-frame stack to its cover in assetSource + bucket count (E20/E23)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child1 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child2 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      await insertStack(stackId, user.id, primary.id);
      for (final a in [primary, child1, child2]) {
        await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: a.id);
      }

      // asset query: only the cover survives
      final assets = await sut.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(assets.map((a) => (a as RemoteAsset).id).toList(), [primary.id]);

      // bucket-count query agrees: one day bucket with count 1
      final buckets = await sut.sharedSpace(space.id, GroupAssetsBy.day).bucketSource().first;
      expect(buckets, hasLength(1));
      expect((buckets.single as TimeBucket).assetCount, 1);
    });

    test('does NOT collapse the space-album detail timeline (E21)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child1 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child2 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      await insertStack(stackId, user.id, primary.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      for (final a in [primary, child1, child2]) {
        await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: a.id);
      }

      final assets = await sut.spaceAlbum(space.id, album.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(assets.map((a) => (a as RemoteAsset).id).toSet(), {primary.id, child1.id, child2.id});
    });

    test('legacy partial stack (only non-primary frames are members) yields zero (E22)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child1 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child2 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      await insertStack(stackId, user.id, primary.id);
      // Only the NON-primary frames are direct members; the primary is absent.
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: child1.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: child2.id);

      final assets = await sut.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      // non-primary frames are collapsed out; the primary isn't a member → nothing shows
      // (consistent with server/web timeline; documented limitation).
      expect(assets, isEmpty);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run (from `mobile/`): `mise exec -- flutter test test/medium/repositories/timeline_repository_test.dart`
(If deps aren't fetched: `mise exec -- flutter pub get` first.)
Expected: the E20/E23 test FAILS (assetSource returns all 3 → `[primary, child1, child2]` ≠ `[primary]`; bucket count is 3 not 1) and the E22 test FAILS (returns child1/child2 → not empty). The E21 test PASSES already (album path untouched). This is the correct red — the collapse isn't implemented yet.

- [ ] **Step 3: Implement collapse — three query builders in `timeline.repository.dart`**

**(a) `_watchSharedSpaceBucket`, the `groupBy == GroupAssetsBy.none` count query** — in its `..join([ ... ])` list (currently ending with the `sharedSpaceAlbumLinkEntity` leftOuterJoin), add a fifth join as the last element:

```dart
          leftOuterJoin(
            _db.stackEntity,
            _db.stackEntity.id.equalsExp(_db.remoteAssetEntity.stackId),
            useColumns: false,
          ),
```

and extend that query's `..where( ... )` by ANDing the collapse predicate as the final conjunct:

```dart
        ..where(
          _db.remoteAssetEntity.deletedAt.isNull() &
              _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
              _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
              (_db.sharedSpaceAssetEntity.assetId.isNotNull() |
                  _db.sharedSpaceLibraryEntity.libraryId.isNotNull() |
                  _db.sharedSpaceAlbumLinkEntity.albumId.isNotNull()) &
              (_db.remoteAssetEntity.stackId.isNull() |
                  _db.remoteAssetEntity.id.equalsExp(_db.stackEntity.primaryAssetId)),
        );
```

**(b) `_watchSharedSpaceBucket`, the grouped query** (the `final query = _db.remoteAssetEntity.selectOnly()...` block) — add the same fifth `leftOuterJoin(_db.stackEntity, ...)` to its `..join([ ... ])` list, and AND the same collapse predicate onto its `..where( ... )` (which ends with the same three-way membership OR):

```dart
      ..where(
        _db.remoteAssetEntity.deletedAt.isNull() &
            _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            (_db.sharedSpaceAssetEntity.assetId.isNotNull() |
                _db.sharedSpaceLibraryEntity.libraryId.isNotNull() |
                _db.sharedSpaceAlbumLinkEntity.albumId.isNotNull()) &
            (_db.remoteAssetEntity.stackId.isNull() |
                _db.remoteAssetEntity.id.equalsExp(_db.stackEntity.primaryAssetId)),
      )
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);
```

**(c) `_getSharedSpaceBucketAssets`** — its `.join([ ... ])` currently contains only the `localAssetEntity` leftOuterJoin. Add the stack join to that list:

```dart
        _db.remoteAssetEntity.select().addColumns([_db.localAssetEntity.id]).join([
            leftOuterJoin(
              _db.localAssetEntity,
              _db.remoteAssetEntity.checksum.equalsExp(_db.localAssetEntity.checksum),
              useColumns: false,
            ),
            leftOuterJoin(
              _db.stackEntity,
              _db.stackEntity.id.equalsExp(_db.remoteAssetEntity.stackId),
              useColumns: false,
            ),
          ])
```

and AND the collapse predicate onto its `..where( ... )` (which currently ends with `membership`):

```dart
          ..where(
            _db.remoteAssetEntity.deletedAt.isNull() &
                _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
                _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
                membership &
                (_db.remoteAssetEntity.stackId.isNull() |
                    _db.remoteAssetEntity.id.equalsExp(_db.stackEntity.primaryAssetId)),
          )
```

- [ ] **Step 4: Run to verify pass**

Run (from `mobile/`): `mise exec -- flutter test test/medium/repositories/timeline_repository_test.dart`
Expected: PASS — all tests in the file, including the new group (E20/E23, E21, E22) and the pre-existing shared-space tests.

- [ ] **Step 5: Analyze / lint / commit**

Run (from `mobile/`): `mise exec -- dart analyze lib/infrastructure/repositories/timeline.repository.dart test/medium/repositories/timeline_repository_test.dart`
Expected: no errors/warnings on the touched files. (CI runs `dart analyze --fatal-infos` over the whole package; keep the touched files clean.)

```bash
git add mobile/lib/infrastructure/repositories/timeline.repository.dart \
        mobile/test/medium/repositories/timeline_repository_test.dart
git commit -m "feat(spaces): collapse stacks in the mobile aggregated-space timeline (#751)"
```

## Slice S3 Verification Gate

- [ ] `mise exec -- flutter test test/medium/repositories/timeline_repository_test.dart` — all green (new group + pre-existing)
- [ ] `mise exec -- dart analyze lib test` clean on touched files (CI uses `--fatal-infos` over the package)
- [ ] Confirmed `_watchSpaceAlbumBucket` / `_getSpaceAlbumBucketAssets` are unchanged (E21 test guards this)

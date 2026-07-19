# Phase 2B Slice B0 — Mobile Drift Schema + Queries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the mobile Drift schema (three space-album entities), DAOs, a Drift migration, the `spaceAlbum()` detail query, and the third album branch of the `sharedSpace()` timeline union — the data foundation the rest of Phase 2B builds on.

**Architecture:** Three Drift tables mirroring the `shared_space_library`/`shared_space_asset` entities — `shared_space_album` (metadata, keyed by `albumId`), `shared_space_album_link` (link, keyed `(spaceId, albumId)`, carries `showInTimeline`), `shared_space_album_asset` (membership, keyed `(albumId, assetId)`). No FK on the loose ids (the referenced row may not be synced yet); `spaceId` keeps its cascade FK. A `SpaceAlbumRepository` provides the data-layer ops (incl. the metadata-delete membership **sweep**). The timeline `sharedSpace()` union gains a third **reactive two-table join** (membership → link, filtered on `showInTimeline = true`), and a new `spaceAlbum()` query returns one album's assets.

**Tech Stack:** Flutter/Dart, Drift (codegen via `mise codegen`), Drift step-migrations (`mise migration`), Riverpod, vitest-equivalent `flutter_test` (run via `mise test`), `dart analyze` (via `mise analyze`).

**Spec:** `docs/superpowers/specs/2026-06-16-space-albums-phase2b-mobile-impl-design.md` (§4, §6, §10.1).

**Commands (run from repo root):**

- Codegen (build_runner): `mise codegen`
- Drift migration snapshot + steps: `mise migration`
- Tests: `mise test` (or a single file: `cd mobile && flutter test test/medium/repositories/space_album_repository_test.dart`)
- Analyze: `mise analyze`

---

## File Structure

**Create:**

- `mobile/lib/infrastructure/entities/shared_space_album.entity.dart` — metadata table (keyed `albumId`).
- `mobile/lib/infrastructure/entities/shared_space_album_link.entity.dart` — link table (keyed `(spaceId, albumId)`).
- `mobile/lib/infrastructure/entities/shared_space_album_asset.entity.dart` — membership table (keyed `(albumId, assetId)`).
- `mobile/lib/infrastructure/repositories/space_album.repository.dart` — `SpaceAlbumRepository` (data ops + sweep) + its Riverpod provider.
- `mobile/test/medium/repositories/space_album_repository_test.dart` — DAO/sweep medium tests.

**Modify:**

- `mobile/lib/infrastructure/repositories/db.repository.dart` — register the three tables in `@DriftDatabase`, bump `schemaVersion` 34→35, add the `from34To35` migration step.
- `mobile/lib/infrastructure/repositories/timeline.repository.dart` — extend `_watchSharedSpaceBucket` (both branches) and `_getSharedSpaceBucketAssets` with the album branch; add `spaceAlbum()` + `_watchSpaceAlbumBucket` + `_getSpaceAlbumBucketAssets`.
- `mobile/lib/domain/services/timeline.service.dart` — add `TimelineFactory.spaceAlbum(spaceId, albumId, …)`.
- `mobile/test/medium/repository_context.dart` — add `newSharedSpaceAlbum` / `insertSharedSpaceAlbumLink` / `insertSharedSpaceAlbumAsset` helpers.
- `mobile/test/medium/repositories/timeline_repository_test.dart` — add the `sharedSpace` album-branch + `spaceAlbum` tests.

**Generated (do not hand-edit; produced by `mise codegen` / `mise migration`):** the `*.entity.drift.dart` files, `db.repository.steps.dart`, and `mobile/drift_schemas/main/drift_schema_v35.json`.

---

## Task 1: Define the three Drift entities

**Files:**

- Create: `mobile/lib/infrastructure/entities/shared_space_album.entity.dart`
- Create: `mobile/lib/infrastructure/entities/shared_space_album_link.entity.dart`
- Create: `mobile/lib/infrastructure/entities/shared_space_album_asset.entity.dart`

- [ ] **Step 1: Write `shared_space_album.entity.dart` (metadata, keyed by albumId)**

```dart
import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Space-album METADATA, keyed by albumId (fed by the SharedSpaceAlbumV1 wire
// stream → SyncAlbumV2). Mirrors the wire entity family, NOT the server's
// physical shared_space_album table (which is the link). See the Phase 2B spec
// §4 naming note. No FK on albumId/thumbnailAssetId — the rows may arrive before
// the referenced album/asset is synced.
class SharedSpaceAlbumEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumEntity();

  TextColumn get id => text()(); // the albumId
  TextColumn get name => text()();
  TextColumn get description => text().nullable()();
  TextColumn get thumbnailAssetId => text().nullable()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();
  BoolColumn get isActivityEnabled => boolean().withDefault(const Constant(true))();
  // SyncAlbumV2.order is an AssetOrder enum on the wire; store its index. The
  // executor MUST confirm the exact generated Dart type of SyncAlbumV2.order
  // during B1 and align the column (intColumn index vs textEnum) — see Open
  // Items. Defaulting to an int index column here.
  IntColumn get order => integer().withDefault(const Constant(0))();

  @override
  Set<Column> get primaryKey => {id};
}
```

- [ ] **Step 2: Write `shared_space_album_link.entity.dart` (link, keyed (spaceId, albumId))**

```dart
import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Space↔album LINK row (fed by SharedSpaceAlbumLinkV1). spaceId has a cascade FK
// to SharedSpaceEntity. albumId is a loose reference (no FK) — the album
// metadata row may not be synced yet. Carries the per-space showInTimeline.
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_link_space ON shared_space_album_link_entity (space_id)',
)
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_link_album_space ON shared_space_album_link_entity (album_id, space_id)',
)
class SharedSpaceAlbumLinkEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumLinkEntity();

  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();

  // No FK — the album metadata row may not be synced yet.
  TextColumn get albumId => text()();

  BoolColumn get showInTimeline => boolean().withDefault(const Constant(true))();
  TextColumn get addedById => text().nullable()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {spaceId, albumId};
}
```

- [ ] **Step 3: Write `shared_space_album_asset.entity.dart` (membership, keyed (albumId, assetId))**

```dart
import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Album↔asset MEMBERSHIP (fed by SharedSpaceAlbumToAssetV1 {albumId, assetId}).
// Keyed (albumId, assetId) — per-album, so an album linked to two spaces dedupes
// here. No FK on either id (loose refs; ordering between streams not guaranteed).
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_asset_album ON shared_space_album_asset_entity (album_id)',
)
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_asset_asset_album ON shared_space_album_asset_entity (asset_id, album_id)',
)
class SharedSpaceAlbumAssetEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumAssetEntity();

  TextColumn get albumId => text()();
  TextColumn get assetId => text()();

  @override
  Set<Column> get primaryKey => {albumId, assetId};
}
```

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/infrastructure/entities/shared_space_album.entity.dart \
        mobile/lib/infrastructure/entities/shared_space_album_link.entity.dart \
        mobile/lib/infrastructure/entities/shared_space_album_asset.entity.dart
git commit -m "feat(mobile): add space-album Drift entities (metadata/link/membership)"
```

---

## Task 2: Register tables + migration + codegen

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/db.repository.dart` (imports ~30-33; `@DriftDatabase` table list 51-80; `schemaVersion` 133; migration steps ~270-290)

- [ ] **Step 1: Add the three `.drift.dart` imports** (next to the existing shared_space imports, ~line 33)

```dart
import 'package:immich_mobile/infrastructure/entities/shared_space_album.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_album_link.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_album_asset.entity.drift.dart';
```

- [ ] **Step 2: Register the three tables** in `@DriftDatabase(tables: [ … ])` (after `SharedSpaceLibraryEntity,` on line 69)

```dart
    SharedSpaceLibraryEntity,
    SharedSpaceAlbumEntity,
    SharedSpaceAlbumLinkEntity,
    SharedSpaceAlbumAssetEntity,
```

- [ ] **Step 3: Bump the schema version** (line 133)

```dart
  @override
  int get schemaVersion => 35;
```

- [ ] **Step 4: Run codegen + migration to materialize the generated files**

Run: `mise codegen` (generates the three `*.entity.drift.dart` files), then `mise migration` (dumps `drift_schemas/main/drift_schema_v35.json` and regenerates `db.repository.steps.dart` with the `v35` schema helpers).
Expected: both commands exit 0; new generated files appear; `db.repository.steps.dart` now exposes `v35.sharedSpaceAlbumEntity`, `v35.sharedSpaceAlbumLinkEntity`, `v35.sharedSpaceAlbumAssetEntity`, and the new index getters.

> If `mise migration` reports the schema is ahead/behind, it is because Step 5's `from34To35` callback does not yet exist — that is expected; add it in Step 5 then re-run `mise migration` / `mise codegen` until clean.

- [ ] **Step 5: Add the `from34To35` migration step** (in the step list, after `from33To34` — find the highest existing `fromNToM`; mirror the `from23To24` library pattern at line 281)

```dart
          from34To35: (m, v35) async {
            await m.createTable(v35.sharedSpaceAlbumEntity);
            await m.createTable(v35.sharedSpaceAlbumLinkEntity);
            await m.createTable(v35.sharedSpaceAlbumAssetEntity);
            await m.createIndex(v35.idxSharedSpaceAlbumLinkSpace);
            await m.createIndex(v35.idxSharedSpaceAlbumLinkAlbumSpace);
            await m.createIndex(v35.idxSharedSpaceAlbumAssetAlbum);
            await m.createIndex(v35.idxSharedSpaceAlbumAssetAssetAlbum);
          },
```

> The exact generated index getter names (`idxSharedSpaceAlbumLinkSpace`, etc.) come from the `@TableIndex.sql` names in Task 1 as transformed by drift codegen — confirm the precise names in the regenerated `db.repository.steps.dart` (`v35.idx…`) and use those verbatim.

- [ ] **Step 6: Re-run codegen + migration; verify clean**

Run: `mise codegen && mise migration`
Expected: exit 0, no diffs pending, `db.repository.steps.dart` migration is consistent (v34→v35 step recognized).

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/infrastructure/repositories/db.repository.dart \
        mobile/lib/infrastructure/entities/*.drift.dart \
        mobile/lib/infrastructure/repositories/db.repository.steps.dart \
        mobile/drift_schemas/
git commit -m "feat(mobile): register space-album tables + v35 Drift migration"
```

---

## Task 3: Test harness helpers

**Files:**

- Modify: `mobile/test/medium/repository_context.dart` (add imports + three helpers after `insertSharedSpaceLibrary`, line 406)

- [ ] **Step 1: Add the `.drift.dart` imports** (next to the shared_space imports, ~line 22)

```dart
import 'package:immich_mobile/infrastructure/entities/shared_space_album.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_album_link.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_album_asset.entity.drift.dart';
```

- [ ] **Step 2: Add the three helpers** (before the closing brace of `MediumRepositoryContext`, after line 406)

```dart
  Future<SharedSpaceAlbumEntityData> newSharedSpaceAlbum({
    String? id,
    String? name,
    String? thumbnailAssetId,
    bool? isActivityEnabled,
    int? order,
  }) async {
    id ??= TestUtils.uuid();
    return db
        .into(db.sharedSpaceAlbumEntity)
        .insertReturning(
          SharedSpaceAlbumEntityCompanion(
            id: .new(id),
            name: .new(name ?? 'space_album_$id'),
            thumbnailAssetId: .new(thumbnailAssetId),
            isActivityEnabled: .new(isActivityEnabled ?? true),
            order: .new(order ?? 0),
          ),
        );
  }

  Future<void> insertSharedSpaceAlbumLink({
    required String spaceId,
    required String albumId,
    bool? showInTimeline,
    String? addedById,
  }) {
    return db
        .into(db.sharedSpaceAlbumLinkEntity)
        .insert(
          SharedSpaceAlbumLinkEntityCompanion(
            spaceId: .new(spaceId),
            albumId: .new(albumId),
            showInTimeline: .new(showInTimeline ?? true),
            addedById: .new(addedById),
          ),
        );
  }

  Future<void> insertSharedSpaceAlbumAsset({required String albumId, required String assetId}) {
    return db
        .into(db.sharedSpaceAlbumAssetEntity)
        .insert(SharedSpaceAlbumAssetEntityCompanion(albumId: .new(albumId), assetId: .new(assetId)));
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `cd mobile && flutter test test/medium/repository_context.dart 2>&1 | tail -5` (no tests run, but the file must compile against the generated companions).
Expected: no compile errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/test/medium/repository_context.dart
git commit -m "test(mobile): space-album medium test harness helpers"
```

---

## Task 4: `sharedSpace()` timeline union — album branch (TDD)

The album branch is a **two-table reactive join** (membership → link). It MUST be real `leftOuterJoin`s in `_watchSharedSpaceBucket` (Drift `.watch()` ignores `isInQuery` subqueries — see the regression comment at `timeline.repository.dart:457-471`), and the `WHERE` adds `| shared_space_album_link.albumId.isNotNull()`.

**Files:**

- Test: `mobile/test/medium/repositories/timeline_repository_test.dart`
- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart:452-580`

- [ ] **Step 1: Write the failing tests** (add a `group('sharedSpace album branch', …)` to the test file; the existing file already constructs a `MediumRepositoryContext` + `DriftTimelineRepository` — mirror the existing `remoteAlbum`/`sharedSpace` setup in that file)

```dart
  group('sharedSpace album branch', () {
    test('includes an album asset when its link showInTimeline = true', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

      final assets = await repo.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(assets.map((a) => a.id), contains(asset.id));
    });

    test('excludes an album asset when its link showInTimeline = false', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: false);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

      final assets = await repo.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(assets.map((a) => a.id), isNot(contains(asset.id)));
    });

    test('counts an asset once when it is both album-linked and direct-added', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      final assets = await repo.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(assets.where((a) => a.id == asset.id), hasLength(1));
    });

    test('an album in two spaces shows its asset in each space timeline', () async {
      final user = await ctx.newUser();
      final s1 = await ctx.newSharedSpace(createdById: user.id);
      final s2 = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: s1.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumLink(spaceId: s2.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

      final a1 = await repo.sharedSpace(s1.id, GroupAssetsBy.none).assetSource(0, 100);
      final a2 = await repo.sharedSpace(s2.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(a1.map((a) => a.id), contains(asset.id));
      expect(a2.map((a) => a.id), contains(asset.id));
    });
  });
```

- [ ] **Step 2: Run the tests; verify they FAIL**

Run: `cd mobile && flutter test test/medium/repositories/timeline_repository_test.dart -p vm 2>&1 | tail -20`
Expected: the four new tests FAIL (album asset not found / wrongly excluded), the existing tests still pass.

- [ ] **Step 3: Add the album branch to `_getSharedSpaceBucketAssets`** (the asset fetch, `timeline.repository.dart:548-558`). Extend the `membership` expression with a third OR branch:

```dart
    final membership =
        _db.remoteAssetEntity.id.isInQuery(
          _db.sharedSpaceAssetEntity.selectOnly()
            ..addColumns([_db.sharedSpaceAssetEntity.assetId])
            ..where(_db.sharedSpaceAssetEntity.spaceId.equals(spaceId)),
        ) |
        _db.remoteAssetEntity.libraryId.isInQuery(
          _db.sharedSpaceLibraryEntity.selectOnly()
            ..addColumns([_db.sharedSpaceLibraryEntity.libraryId])
            ..where(_db.sharedSpaceLibraryEntity.spaceId.equals(spaceId)),
        ) |
        _db.remoteAssetEntity.id.isInQuery(
          _db.sharedSpaceAlbumAssetEntity.selectOnly()
            ..addColumns([_db.sharedSpaceAlbumAssetEntity.assetId])
            ..join([
              innerJoin(
                _db.sharedSpaceAlbumLinkEntity,
                _db.sharedSpaceAlbumLinkEntity.albumId.equalsExp(_db.sharedSpaceAlbumAssetEntity.albumId) &
                    _db.sharedSpaceAlbumLinkEntity.spaceId.equals(spaceId) &
                    _db.sharedSpaceAlbumLinkEntity.showInTimeline.equals(true),
                useColumns: false,
              ),
            ]),
        );
```

- [ ] **Step 4: Add the album branch to BOTH `_watchSharedSpaceBucket` query builders** (the `groupBy == none` count query at lines 477-496 AND the grouped query at 509-528). For each, add two `leftOuterJoin`s after the `shared_space_library` join, and extend the `WHERE` `isNotNull` OR-group. The join block becomes:

```dart
          leftOuterJoin(
            _db.sharedSpaceLibraryEntity,
            _db.sharedSpaceLibraryEntity.libraryId.equalsExp(_db.remoteAssetEntity.libraryId) &
                _db.sharedSpaceLibraryEntity.spaceId.equals(spaceId),
            useColumns: false,
          ),
          leftOuterJoin(
            _db.sharedSpaceAlbumAssetEntity,
            _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
            useColumns: false,
          ),
          leftOuterJoin(
            _db.sharedSpaceAlbumLinkEntity,
            _db.sharedSpaceAlbumLinkEntity.albumId.equalsExp(_db.sharedSpaceAlbumAssetEntity.albumId) &
                _db.sharedSpaceAlbumLinkEntity.spaceId.equals(spaceId) &
                _db.sharedSpaceAlbumLinkEntity.showInTimeline.equals(true),
            useColumns: false,
          ),
```

…and the `WHERE` membership OR-group (both query builders) becomes:

```dart
              (_db.sharedSpaceAssetEntity.assetId.isNotNull() |
                  _db.sharedSpaceLibraryEntity.libraryId.isNotNull() |
                  _db.sharedSpaceAlbumLinkEntity.albumId.isNotNull()),
```

> Because the count uses `COUNT(DISTINCT remote_asset.id)`, the extra LEFT JOINs cannot inflate the count for a multi-path asset — the dedup test (Step 1) pins this.

- [ ] **Step 5: Run the tests; verify they PASS**

Run: `cd mobile && flutter test test/medium/repositories/timeline_repository_test.dart -p vm 2>&1 | tail -20`
Expected: all tests PASS (the four new + the existing union/regression tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/infrastructure/repositories/timeline.repository.dart \
        mobile/test/medium/repositories/timeline_repository_test.dart
git commit -m "feat(mobile): add album branch to sharedSpace() timeline union (showInTimeline)"
```

---

## Task 5: `spaceAlbum()` detail query + TimelineFactory (TDD)

**Files:**

- Test: `mobile/test/medium/repositories/timeline_repository_test.dart`
- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart` (add `spaceAlbum` + helpers after `_getSharedSpaceBucketAssets`, ~line 580)
- Modify: `mobile/lib/domain/services/timeline.service.dart` (add `spaceAlbum` factory method next to `sharedSpace`/`remoteAlbum`)

- [ ] **Step 1: Write the failing test**

```dart
  group('spaceAlbum query', () {
    test('returns exactly the album assets regardless of showInTimeline', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final inAlbum = await ctx.newRemoteAsset(ownerId: user.id);
      final notInAlbum = await ctx.newRemoteAsset(ownerId: user.id);
      // off-timeline link → still returned by the detail query
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: false);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: inAlbum.id);

      final assets = await repo.spaceAlbum(space.id, album.id, GroupAssetsBy.none).assetSource(0, 100);
      final ids = assets.map((a) => a.id);
      expect(ids, contains(inAlbum.id));
      expect(ids, isNot(contains(notInAlbum.id)));
    });
  });
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd mobile && flutter test test/medium/repositories/timeline_repository_test.dart -p vm 2>&1 | tail -10`
Expected: FAIL with `repo.spaceAlbum` undefined (method does not exist).

- [ ] **Step 3: Add `spaceAlbum()` + helpers to `timeline.repository.dart`** (mirror `sharedSpace`; membership = `shared_space_album_asset WHERE albumId`, no `showInTimeline` filter; `spaceId` accepted for parity/origin but the asset set is album-scoped)

```dart
  // Detail query for one linked album inside a space. Scopes by album membership
  // only (no showInTimeline filter — the detail page shows all the album's
  // photos). spaceId is carried for the origin/header.
  TimelineQuery spaceAlbum(
    String spaceId,
    String albumId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _watchSpaceAlbumBucket(albumId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) =>
        _getSpaceAlbumBucketAssets(albumId, offset: offset, count: count, temporalScope: temporalScope),
    origin: TimelineOrigin.remoteSpace,
  );

  Stream<List<Bucket>> _watchSpaceAlbumBucket(
    String albumId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      final countExp = _db.remoteAssetEntity.id.count(distinct: true);
      final countQuery = _db.remoteAssetEntity.selectOnly()
        ..addColumns([countExp])
        ..join([
          leftOuterJoin(
            _db.sharedSpaceAlbumAssetEntity,
            _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id) &
                _db.sharedSpaceAlbumAssetEntity.albumId.equals(albumId),
            useColumns: false,
          ),
        ])
        ..where(
          _db.remoteAssetEntity.deletedAt.isNull() &
              _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
              _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
              _db.sharedSpaceAlbumAssetEntity.assetId.isNotNull(),
        );
      return countQuery
          .map((row) => row.read(countExp) ?? 0)
          .watchSingle()
          .map(_generateBuckets)
          .handleError((error) => const <Bucket>[]);
    }

    final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
    final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);
    final query = _db.remoteAssetEntity.selectOnly()
      ..addColumns([assetCountExp, dateExp])
      ..join([
        leftOuterJoin(
          _db.sharedSpaceAlbumAssetEntity,
          _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id) &
              _db.sharedSpaceAlbumAssetEntity.albumId.equals(albumId),
          useColumns: false,
        ),
      ])
      ..where(
        _db.remoteAssetEntity.deletedAt.isNull() &
            _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            _db.sharedSpaceAlbumAssetEntity.assetId.isNotNull(),
      )
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);
    return query
        .map((row) {
          final timeline = row.read(dateExp)!.truncateDate(groupBy);
          final assetCount = row.read(assetCountExp)!;
          return TimeBucket(date: timeline, assetCount: assetCount);
        })
        .watch()
        .handleError((error) => const <Bucket>[]);
  }

  Future<List<BaseAsset>> _getSpaceAlbumBucketAssets(
    String albumId, {
    required int offset,
    required int count,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) async {
    final membership = _db.remoteAssetEntity.id.isInQuery(
      _db.sharedSpaceAlbumAssetEntity.selectOnly()
        ..addColumns([_db.sharedSpaceAlbumAssetEntity.assetId])
        ..where(_db.sharedSpaceAlbumAssetEntity.albumId.equals(albumId)),
    );
    final query =
        _db.remoteAssetEntity.select().addColumns([_db.localAssetEntity.id]).join([
            leftOuterJoin(
              _db.localAssetEntity,
              _db.remoteAssetEntity.checksum.equalsExp(_db.localAssetEntity.checksum),
              useColumns: false,
            ),
          ])
          ..where(
            _db.remoteAssetEntity.deletedAt.isNull() &
                _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
                _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
                membership,
          )
          ..orderBy([OrderingTerm.desc(_db.remoteAssetEntity.createdAt)])
          ..limit(count, offset: offset);
    return query
        .map((row) => row.readTable(_db.remoteAssetEntity).toDto(localId: row.read(_db.localAssetEntity.id)))
        .get();
  }
```

- [ ] **Step 4: Add the `spaceAlbum` factory method to `timeline.service.dart`** (next to `sharedSpace`/`remoteAlbum`; clone their signature)

```dart
  TimelineService spaceAlbum({
    required String spaceId,
    required String albumId,
    GroupAssetsBy? groupBy,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final query = _timelineRepository.spaceAlbum(spaceId, albumId, groupBy ?? _getGroupByOption(), temporalScope: temporalScope);
    return TimelineService(timelineRepository: _timelineRepository, query: query);
  }
```

> Confirm the exact body shape against the neighboring `sharedSpace`/`remoteAlbum` factory methods (how they build `TimelineService` and resolve `groupBy`) and match them verbatim — the snippet above mirrors the documented signature but the executor must align it to the real factory body.

- [ ] **Step 5: Run; verify PASS**

Run: `cd mobile && flutter test test/medium/repositories/timeline_repository_test.dart -p vm 2>&1 | tail -10`
Expected: the `spaceAlbum query` test PASSES; all prior tests still pass.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/infrastructure/repositories/timeline.repository.dart \
        mobile/lib/domain/services/timeline.service.dart \
        mobile/test/medium/repositories/timeline_repository_test.dart
git commit -m "feat(mobile): add spaceAlbum() detail timeline query + factory"
```

---

## Task 6: `SpaceAlbumRepository` + metadata-delete sweep (TDD)

The metadata-delete **sweep** (§4.4) is the one behavior that diverges from the library blueprint: deleting a `shared_space_album` metadata row must also delete that album's `shared_space_album_asset` membership rows (no FK cascade exists between them), while leaving `remote_asset` blobs intact. It lives in a data-layer repository (the B1 sync handler will call it).

**Files:**

- Create: `mobile/lib/infrastructure/repositories/space_album.repository.dart`
- Create: `mobile/test/medium/repositories/space_album_repository_test.dart`

- [ ] **Step 1: Write the failing sweep test** (new file; mirror the setup of `timeline_repository_test.dart` — a `MediumRepositoryContext` + the repo under test built from `ctx.db`)

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/repositories/space_album.repository.dart';

import '../repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late SpaceAlbumRepository repo;

  setUp(() {
    ctx = MediumRepositoryContext();
    repo = SpaceAlbumRepository(ctx.db);
  });
  tearDown(() => ctx.dispose());

  test('deleteAlbumMetadata removes metadata + membership but keeps remote_asset', () async {
    final user = await ctx.newUser();
    final album = await ctx.newSharedSpaceAlbum();
    final asset = await ctx.newRemoteAsset(ownerId: user.id);
    await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

    await repo.deleteAlbumMetadata(album.id);

    final meta = await ctx.db.select(ctx.db.sharedSpaceAlbumEntity).get();
    final membership = await ctx.db.select(ctx.db.sharedSpaceAlbumAssetEntity).get();
    final assets = await ctx.db.select(ctx.db.remoteAssetEntity).get();
    expect(meta, isEmpty); // metadata gone
    expect(membership, isEmpty); // membership swept
    expect(assets.map((a) => a.id), contains(asset.id)); // blob retained
  });

  test('deleteLink removes only the (spaceId, albumId) row, keeps metadata + membership', () async {
    final user = await ctx.newUser();
    final space = await ctx.newSharedSpace(createdById: user.id);
    final album = await ctx.newSharedSpaceAlbum();
    final asset = await ctx.newRemoteAsset(ownerId: user.id);
    await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);
    await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

    await repo.deleteLink(spaceId: space.id, albumId: album.id);

    expect(await ctx.db.select(ctx.db.sharedSpaceAlbumLinkEntity).get(), isEmpty);
    expect(await ctx.db.select(ctx.db.sharedSpaceAlbumEntity).get(), isNotEmpty);
    expect(await ctx.db.select(ctx.db.sharedSpaceAlbumAssetEntity).get(), isNotEmpty);
  });
}
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd mobile && flutter test test/medium/repositories/space_album_repository_test.dart -p vm 2>&1 | tail -10`
Expected: FAIL — `SpaceAlbumRepository` / `space_album.repository.dart` does not exist.

- [ ] **Step 3: Implement `SpaceAlbumRepository`** (model the file on a small existing repo such as `shared_space.repository.dart`; confirm the base-class/provider convention there)

```dart
import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';

class SpaceAlbumRepository {
  final Drift _db;
  const SpaceAlbumRepository(this._db);

  // §4.4 sweep: drop metadata + its membership; remote_asset blobs untouched.
  Future<void> deleteAlbumMetadata(String albumId) async {
    await _db.transaction(() async {
      await (_db.delete(_db.sharedSpaceAlbumAssetEntity)..where((t) => t.albumId.equals(albumId))).go();
      await (_db.delete(_db.sharedSpaceAlbumEntity)..where((t) => t.id.equals(albumId))).go();
    });
  }

  Future<void> deleteLink({required String spaceId, required String albumId}) {
    return (_db.delete(_db.sharedSpaceAlbumLinkEntity)
          ..where((t) => t.spaceId.equals(spaceId) & t.albumId.equals(albumId)))
        .go();
  }
}
```

- [ ] **Step 4: Run; verify PASS**

Run: `cd mobile && flutter test test/medium/repositories/space_album_repository_test.dart -p vm 2>&1 | tail -10`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/infrastructure/repositories/space_album.repository.dart \
        mobile/test/medium/repositories/space_album_repository_test.dart
git commit -m "feat(mobile): SpaceAlbumRepository with metadata-delete sweep"
```

---

## Task 7: Slice gate — analyze + full B0 test run

- [ ] **Step 1: Run analyze**

Run: `mise analyze 2>&1 | tail -20` (or `cd mobile && dart analyze lib test`)
Expected: **no** new infos/warnings/errors in the files touched by B0 (unawaited futures, `withOpacity`, dead null-aware ops). Fix any.

- [ ] **Step 2: Run the full medium suite for the touched repos**

Run: `cd mobile && flutter test test/medium/repositories/timeline_repository_test.dart test/medium/repositories/space_album_repository_test.dart -p vm 2>&1 | tail -15`
Expected: all PASS.

- [ ] **Step 3: Final commit (if analyze required fixes)**

```bash
git add -A
git commit -m "chore(mobile): B0 analyze fixes"
```

---

## Self-Review

**Spec coverage (§10.1 B0):**

- entity upsert/delete for the three entities → exercised via the harness helpers + Task 4/5/6 tests (insert then query/delete). ✓
- metadata-delete sweep → Task 6. ✓
- link-delete drops only the link row → Task 6 (`deleteLink` test). ✓
- `spaceAlbum()` returns exactly the album assets (no showInTimeline filter) → Task 5. ✓
- `sharedSpace()` union includes iff `showInTimeline = true`, excludes when false, multi-path dedup → Task 4 (3 tests). ✓
- two-spaces dedup → Task 4 (4th test). ✓

**Placeholders:** none — every step has concrete code or an exact command. The two "confirm against the neighboring method" notes (Task 5 Step 4 factory body; Task 2 Step 5 generated index names) are codegen/clone-alignment confirmations, not deferred work.

**Type consistency:** entity names (`SharedSpaceAlbumEntity`/`…LinkEntity`/`…AssetEntity`), generated companions (`…Companion`), repo (`SpaceAlbumRepository`) and its methods (`deleteAlbumMetadata`, `deleteLink`) are used consistently across tasks. The timeline methods (`spaceAlbum`, `_watchSpaceAlbumBucket`, `_getSpaceAlbumBucketAssets`) match Task 5.

## Open items (confirm during execution; from spec §12)

- **`order` column type** (Task 1 Step 1): align with the generated `SyncAlbumV2.order` Dart type once B1 wires deserialization (int index vs enum). If `SyncAlbumV2.order` is an enum, store its `.index` and keep the column `integer()`.
- **Generated index getter names** (Task 2 Step 5): use the exact `v35.idx…` names drift codegen emits.
- **`SpaceAlbumRepository` base class / provider** (Task 6 Step 3): match the existing repository convention (e.g. a `DriftDatabaseRepository` base + a Riverpod provider) used by `shared_space.repository.dart`; add the provider if the codebase wires repos that way.
- **`TimelineFactory.spaceAlbum` body** (Task 5 Step 4): match the real neighboring factory bodies verbatim.

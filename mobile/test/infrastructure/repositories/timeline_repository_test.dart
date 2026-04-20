// Reactivity regression tests for DriftTimelineRepository.sharedSpace.
//
// The bug we're guarding against: a `.watch()` stream whose query references
// a table only via an `isInQuery` / EXISTS subquery can silently fail to
// re-emit when that table mutates, leaving the UI stale. This happened to
// `mergedBucket` in merged_asset.drift because the .drift file didn't import
// the shared_space_* entities, so Drift's generated `readsFrom` set was
// incomplete. For Dart-builder queries (like `_watchSharedSpaceBucket`)
// Drift *should* walk the expression tree and track all referenced tables —
// but we want a test that proves it, so a future refactor can't silently
// break reactivity.

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:immich_mobile/infrastructure/entities/exif.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_library.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '_shared_permission_matrix.dart';

Future<void> _waitFor(bool Function() predicate, {Duration timeout = const Duration(seconds: 2)}) async {
  final deadline = DateTime.now().add(timeout);
  while (!predicate()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Timed out after $timeout waiting for condition');
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  late Drift db;
  late DriftTimelineRepository sut;

  setUpAll(() async {
    // truncateDate() uses intl's DateFormat which requires locale data.
    await initializeDateFormatting('en_US');
  });

  setUp(() {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    sut = DriftTimelineRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  Future<void> insertUser(String id) =>
      db.into(db.userEntity).insert(UserEntityCompanion.insert(id: id, email: '$id@test', name: id));

  Future<void> insertVideo(
    String id,
    String ownerId, {
    String? libraryId,
    AssetType type = AssetType.video,
    AssetVisibility visibility = AssetVisibility.timeline,
  }) {
    final createdAt = DateTime(2024, 1, 1, 12);
    return db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: id,
            name: '$id.mp4',
            type: type,
            checksum: 'c-$id',
            ownerId: ownerId,
            visibility: visibility,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
            libraryId: Value(libraryId),
          ),
        );
  }

  Future<void> insertSpace(String id, String ownerId) =>
      db.into(db.sharedSpaceEntity).insert(SharedSpaceEntityCompanion.insert(id: id, name: id, createdById: ownerId));

  Future<void> insertMember(String spaceId, String userId, {bool showInTimeline = true}) => db
      .into(db.sharedSpaceMemberEntity)
      .insert(
        SharedSpaceMemberEntityCompanion.insert(
          spaceId: spaceId,
          userId: userId,
          role: 'viewer',
          showInTimeline: Value(showInTimeline),
        ),
      );

  Future<void> linkAssetToSpace(String spaceId, String assetId) => db
      .into(db.sharedSpaceAssetEntity)
      .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

  Future<void> linkLibraryToSpace(String spaceId, String libraryId) => db
      .into(db.sharedSpaceLibraryEntity)
      .insert(SharedSpaceLibraryEntityCompanion.insert(spaceId: spaceId, libraryId: libraryId));

  Future<int> videoBucketCount(List<String> userIds, String currentUserId) async {
    final first = await sut.video(userIds, currentUserId, GroupAssetsBy.day).bucketSource().first;
    return first.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
  }

  Future<List<BaseAsset>> videoBucketAssets(List<String> userIds, String currentUserId) {
    return sut.video(userIds, currentUserId, GroupAssetsBy.day).assetSource(0, 100);
  }

  group('DriftTimelineRepository.video() visibility matrix', () {
    test('1. owner asset visible', () async {
      await insertUser('viewer');
      await insertVideo('a1', 'viewer');
      expect(await videoBucketCount(['viewer'], 'viewer'), 1);
      expect(await videoBucketAssets(['viewer'], 'viewer'), hasLength(1));
    });

    test('2. partner asset (owner in userIds) visible', () async {
      await insertUser('viewer');
      await insertUser('partner');
      await insertVideo('a1', 'partner');
      expect(await videoBucketCount(['viewer', 'partner'], 'viewer'), 1);
    });

    test('3. unrelated user asset hidden', () async {
      await insertUser('viewer');
      await insertUser('stranger');
      await insertVideo('a1', 'stranger');
      expect(await videoBucketCount(['viewer'], 'viewer'), 0);
    });

    test('4. space asset, viewer member, showInTimeline=true → visible', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: true);
      await linkAssetToSpace('space1', 'a1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 1);
    });

    test('5. space asset, viewer member, showInTimeline=false → hidden', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: false);
      await linkAssetToSpace('space1', 'a1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 0);
    });

    test('6. space asset where partner is member but viewer is NOT → hidden', () async {
      await insertUser('viewer');
      await insertUser('partner');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'partner', showInTimeline: true);
      await linkAssetToSpace('space1', 'a1');
      expect(await videoBucketCount(['viewer', 'partner'], 'viewer'), 0);
    });

    test('7. library-in-space, showInTimeline=true → visible', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', libraryId: 'lib1');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: true);
      await linkLibraryToSpace('space1', 'lib1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 1);
    });

    test('8. library-in-space, showInTimeline=false → hidden', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', libraryId: 'lib1');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: false);
      await linkLibraryToSpace('space1', 'lib1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 0);
    });

    test('9. asset in 2 directly-linked spaces → counted once', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertSpace('space2', 'owner');
      await insertMember('space1', 'viewer');
      await insertMember('space2', 'viewer');
      await linkAssetToSpace('space1', 'a1');
      await linkAssetToSpace('space2', 'a1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 1);
      expect(await videoBucketAssets(['viewer'], 'viewer'), hasLength(1));
    });

    test('10. asset reachable via BOTH direct and library links on same space → counted once', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', libraryId: 'lib1');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');
      await linkLibraryToSpace('space1', 'lib1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 1);
      expect(await videoBucketAssets(['viewer'], 'viewer'), hasLength(1));
    });

    test('11. asset with library_id NULL reachable via shared_space_asset → visible', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 1);
    });

    test('12. asset with library_id NULL NOT in any space → hidden', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      expect(await videoBucketCount(['viewer'], 'viewer'), 0);
    });

    test('13. image asset reachable via space → hidden (type filter still applies)', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', type: AssetType.image);
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 0);
    });

    test('14. userIds = [user.id] only (loading fallback) → owner visible, space branches still work', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('owned', 'viewer');
      await insertVideo('space', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'space');
      expect(await videoBucketCount(['viewer'], 'viewer'), 2);
    });

    test('video() bucket stream re-emits when a shared_space_asset row is deleted', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final emissions = <List<Bucket>>[];
      final sub = sut.video(['viewer'], 'viewer', GroupAssetsBy.day).bucketSource().listen(emissions.add);

      await _waitFor(() => emissions.isNotEmpty);
      expect(emissions.last, hasLength(1));

      await (db.delete(
        db.sharedSpaceAssetEntity,
      )..where((t) => t.spaceId.equals('space1') & t.assetId.equals('a1'))).go();

      await _waitFor(() => emissions.length >= 2);
      expect(emissions.last, isEmpty);

      await sub.cancel();
    });

    test('video() bucket stream re-emits when shared_space_member.showInTimeline toggles', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: true);
      await linkAssetToSpace('space1', 'a1');

      final emissions = <List<Bucket>>[];
      final sub = sut.video(['viewer'], 'viewer', GroupAssetsBy.day).bucketSource().listen(emissions.add);

      await _waitFor(() => emissions.isNotEmpty);
      expect((emissions.last.single as TimeBucket).assetCount, 1);

      // Flip showInTimeline=false — asset should drop out.
      await (db.update(db.sharedSpaceMemberEntity)
            ..where((t) => t.spaceId.equals('space1') & t.userId.equals('viewer')))
          .write(const SharedSpaceMemberEntityCompanion(showInTimeline: Value(false)));

      await _waitFor(() => emissions.length >= 2);
      expect(
        emissions.last,
        isEmpty,
        reason:
            'Toggling showInTimeline=false on the viewer\'s member row must drop the space asset '
            'from the video bucket stream immediately',
      );

      // Flip it back on — verify symmetric reactivity.
      await (db.update(db.sharedSpaceMemberEntity)
            ..where((t) => t.spaceId.equals('space1') & t.userId.equals('viewer')))
          .write(const SharedSpaceMemberEntityCompanion(showInTimeline: Value(true)));

      await _waitFor(() => emissions.length >= 3);
      expect(
        (emissions.last.single as TimeBucket).assetCount,
        1,
        reason: 'Toggling showInTimeline=true must bring the space asset back into the bucket',
      );

      await sub.cancel();
    });

    test('video() bucket stream re-emits when shared_space_member row is deleted', () async {
      // Complementary to the toggle test — covers the case where the viewer is
      // removed from the space entirely (member row deleted, not updated).
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: true);
      await linkAssetToSpace('space1', 'a1');

      final emissions = <List<Bucket>>[];
      final sub = sut.video(['viewer'], 'viewer', GroupAssetsBy.day).bucketSource().listen(emissions.add);

      await _waitFor(() => emissions.isNotEmpty);
      expect((emissions.last.single as TimeBucket).assetCount, 1);

      await (db.delete(
        db.sharedSpaceMemberEntity,
      )..where((t) => t.spaceId.equals('space1') & t.userId.equals('viewer'))).go();

      await _waitFor(() => emissions.length >= 2);
      expect(
        emissions.last,
        isEmpty,
        reason:
            'Deleting the viewer\'s shared_space_member row must drop the space asset '
            'from the video bucket stream',
      );

      await sub.cancel();
    });
  });

  group('DriftTimelineRepository.place()', () {
    Future<void> insertExif(String assetId, String? city) =>
        db.into(db.remoteExifEntity).insert(RemoteExifEntityCompanion.insert(assetId: assetId, city: Value(city)));

    test('place() hides assets with wrong city even when viewer-visible', () async {
      await insertUser('viewer');
      await insertVideo('a1', 'viewer', type: AssetType.image);
      await insertExif('a1', 'Berlin');

      final buckets = await sut.place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day).bucketSource().first;
      expect(buckets, isEmpty);
    });

    test('place() shows right-city asset reachable via shared space', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', type: AssetType.image);
      await insertExif('a1', 'Paris');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final buckets = await sut.place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day).bucketSource().first;
      expect(buckets, hasLength(1));
      expect((buckets.single as TimeBucket).assetCount, 1);
    });

    test('place() bucket stream re-emits when a shared_space_asset row is deleted', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', type: AssetType.image);
      await insertExif('a1', 'Paris');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final emissions = <List<Bucket>>[];
      final sub = sut.place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day).bucketSource().listen(emissions.add);

      await _waitFor(() => emissions.isNotEmpty);
      expect(emissions.last, hasLength(1));

      await (db.delete(
        db.sharedSpaceAssetEntity,
      )..where((t) => t.spaceId.equals('space1') & t.assetId.equals('a1'))).go();

      await _waitFor(() => emissions.length >= 2);
      expect(emissions.last, isEmpty);

      await sub.cancel();
    });

    test('place() hides stranger asset with matching city (place narrowing)', () async {
      await insertUser('viewer');
      await insertUser('stranger');
      await insertVideo('a1', 'stranger', type: AssetType.image);
      await insertExif('a1', 'Paris');

      final buckets = await sut.place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day).bucketSource().first;
      expect(buckets, isEmpty, reason: 'Unowned, unshared asset must not appear on place detail');
    });

    test('place() assetSource returns space-visible asset and hides stranger asset', () async {
      // Direct regression test for the assetSource() / .get() path on place().
      // bucketSource() runs against a separate query — this proves the asset
      // list query also composes the visibility predicate with the exif join
      // correctly.
      await insertUser('viewer');
      await insertUser('owner');
      await insertUser('stranger');
      await insertVideo('a1', 'owner', type: AssetType.image);
      await insertExif('a1', 'Paris');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      // Stranger asset with matching city must not appear.
      await insertVideo('stranger1', 'stranger', type: AssetType.image);
      await insertExif('stranger1', 'Paris');

      final assets = await sut.place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day).assetSource(0, 100);
      expect(assets, hasLength(1));
      expect((assets.single as RemoteAsset).id, 'a1');
    });
  });

  group('DriftTimelineRepository.map() bucket sheet', () {
    LatLngBounds globeBounds() => LatLngBounds(southwest: const LatLng(-89, -179), northeast: const LatLng(89, 179));

    LatLngBounds europeBounds() => LatLngBounds(southwest: const LatLng(35, -10), northeast: const LatLng(70, 40));

    Future<void> insertExifAt(String assetId, double lat, double lng) => db
        .into(db.remoteExifEntity)
        .insert(RemoteExifEntityCompanion.insert(assetId: assetId, latitude: Value(lat), longitude: Value(lng)));

    test('map() hides out-of-bounds asset even when viewer-visible', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', type: AssetType.image);
      await insertExifAt('a1', 48.85, 2.35); // Paris
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final naBounds = LatLngBounds(southwest: const LatLng(20, -130), northeast: const LatLng(60, -60));

      final buckets = await sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: naBounds), GroupAssetsBy.day)
          .bucketSource()
          .first;
      expect(buckets, isEmpty);
    });

    test('map() shows in-bounds asset reachable via shared space', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', type: AssetType.image);
      await insertExifAt('a1', 48.85, 2.35);
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final buckets = await sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: europeBounds()), GroupAssetsBy.day)
          .bucketSource()
          .first;
      expect(buckets, hasLength(1));
      expect((buckets.single as TimeBucket).assetCount, 1);
    });

    test('map() relativeDays cutoff excludes older space asset', () async {
      await insertUser('viewer');
      await insertUser('owner');
      final oldDate = DateTime.now().subtract(const Duration(days: 365));
      await db
          .into(db.remoteAssetEntity)
          .insert(
            RemoteAssetEntityCompanion.insert(
              id: 'a1',
              name: 'a1.jpg',
              type: AssetType.image,
              checksum: 'c-a1',
              ownerId: 'owner',
              visibility: AssetVisibility.timeline,
              createdAt: Value(oldDate),
              updatedAt: Value(oldDate),
              localDateTime: Value(oldDate),
            ),
          );
      await insertExifAt('a1', 48.85, 2.35);
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final buckets = await sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: globeBounds(), relativeDays: 7), GroupAssetsBy.day)
          .bucketSource()
          .first;
      expect(buckets, isEmpty);
    });

    test('map() assetSource returns in-bounds space-visible asset', () async {
      // Direct regression test for the assetSource() / .get() path on map().
      // Mirrors the place() assetSource test — proves the visibility predicate
      // composes correctly with the exif inner join in the asset list query
      // (not just the bucketSource() count query).
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', type: AssetType.image);
      await insertExifAt('a1', 48.85, 2.35); // Paris, inside europeBounds
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final assets = await sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: europeBounds()), GroupAssetsBy.day)
          .assetSource(0, 100);
      expect(assets, hasLength(1));
      expect((assets.single as RemoteAsset).id, 'a1');
    });

    test('map() bucket stream re-emits when shared_space_asset row is deleted', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner', type: AssetType.image);
      await insertExifAt('a1', 48.85, 2.35);
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final emissions = <List<Bucket>>[];
      final sub = sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: europeBounds()), GroupAssetsBy.day)
          .bucketSource()
          .listen(emissions.add);

      await _waitFor(() => emissions.isNotEmpty);
      expect(emissions.last, hasLength(1));

      await (db.delete(
        db.sharedSpaceAssetEntity,
      )..where((t) => t.spaceId.equals('space1') & t.assetId.equals('a1'))).go();

      await _waitFor(() => emissions.length >= 2);
      expect(emissions.last, isEmpty);

      await sub.cancel();
    });
  });

  group('Cross-method permission matrix — video()', () {
    runPermissionMatrix(
      methodName: 'video',
      fixtures: MatrixFixtures(
        db: () => db,
        insertAsset: (assetId, ownerId) => insertVideo(assetId, ownerId, type: AssetType.video),
      ),
      count: (userIds, currentUserId) async {
        final buckets = await sut.video(userIds, currentUserId, GroupAssetsBy.day).bucketSource().first;
        return buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
      },
    );
  });

  group('Cross-method permission matrix — place()', () {
    runPermissionMatrix(
      methodName: 'place',
      fixtures: MatrixFixtures(
        db: () => db,
        insertAsset: (assetId, ownerId) async {
          await insertVideo(assetId, ownerId, type: AssetType.image);
          await db
              .into(db.remoteExifEntity)
              .insert(RemoteExifEntityCompanion.insert(assetId: assetId, city: const Value('Paris')));
        },
      ),
      count: (userIds, currentUserId) async {
        final buckets = await sut.place('Paris', userIds, currentUserId, GroupAssetsBy.day).bucketSource().first;
        return buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
      },
    );
  });

  group('Cross-method permission matrix — map()', () {
    final bounds = LatLngBounds(southwest: const LatLng(-89, -179), northeast: const LatLng(89, 179));
    runPermissionMatrix(
      methodName: 'map',
      fixtures: MatrixFixtures(
        db: () => db,
        insertAsset: (assetId, ownerId) async {
          await insertVideo(assetId, ownerId, type: AssetType.image);
          await db
              .into(db.remoteExifEntity)
              .insert(
                RemoteExifEntityCompanion.insert(
                  assetId: assetId,
                  latitude: const Value(48.85),
                  longitude: const Value(2.35),
                ),
              );
        },
      ),
      count: (userIds, currentUserId) async {
        final buckets = await sut
            .map(userIds, currentUserId, TimelineMapOptions(bounds: bounds), GroupAssetsBy.day)
            .bucketSource()
            .first;
        return buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
      },
    );
  });

  // PRE-FLIGHT: verifies Drift's reactive layer tracks tables reached via
  // aliased LEFT OUTER JOINs. The full timeline space visibility design
  // (docs/plans/2026-04-12-mobile-timeline-space-visibility-design.md) is
  // load-bearing on this behavior — if this test fails, switch the design
  // to .drift SQL files with explicit table imports.
  test('PRE-FLIGHT: aliased shared_space_member join re-emits on showInTimeline toggle', () async {
    const ownerId = 'owner-1';
    const viewerId = 'viewer-1';
    const spaceId = 'space-1';
    const assetId = 'asset-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: ownerId, email: 'o@test', name: 'O'));
    await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: viewerId, email: 'v@test', name: 'V'));
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: assetId,
            name: 'a.jpg',
            type: AssetType.image,
            checksum: 'c1',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
          ),
        );
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Space', createdById: ownerId));
    await db
        .into(db.sharedSpaceAssetEntity)
        .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(
          SharedSpaceMemberEntityCompanion.insert(
            spaceId: spaceId,
            userId: viewerId,
            role: 'viewer',
            showInTimeline: const Value(true),
          ),
        );

    final ssmAsset = db.alias(db.sharedSpaceMemberEntity, 'ssm_asset');
    final countExp = db.remoteAssetEntity.id.count(distinct: true);
    final query = db.remoteAssetEntity.selectOnly()
      ..addColumns([countExp])
      ..join([
        leftOuterJoin(
          db.sharedSpaceAssetEntity,
          db.sharedSpaceAssetEntity.assetId.equalsExp(db.remoteAssetEntity.id),
          useColumns: false,
        ),
        leftOuterJoin(
          ssmAsset,
          ssmAsset.spaceId.equalsExp(db.sharedSpaceAssetEntity.spaceId) &
              ssmAsset.userId.equals(viewerId) &
              ssmAsset.showInTimeline.equals(true),
          useColumns: false,
        ),
      ])
      ..where(
        db.remoteAssetEntity.deletedAt.isNull() &
            db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
            ssmAsset.userId.isNotNull(),
      );

    final emissions = <int>[];
    final sub = query.map((row) => row.read(countExp) ?? 0).watchSingle().listen(emissions.add);

    await _waitFor(() => emissions.isNotEmpty);
    expect(emissions.last, 1, reason: 'First emission should see the visible space asset');

    // Toggle showInTimeline=false on the member row. The aliased join's ON clause
    // requires showInTimeline=true, so the asset should drop out of the count.
    await (db.update(db.sharedSpaceMemberEntity)..where((t) => t.spaceId.equals(spaceId) & t.userId.equals(viewerId)))
        .write(const SharedSpaceMemberEntityCompanion(showInTimeline: Value(false)));

    await _waitFor(() => emissions.length >= 2);
    expect(
      emissions.last,
      0,
      reason:
          'Drift reactive layer must track shared_space_member mutations reached via aliased LEFT OUTER JOIN — '
          'if this fails, the design must switch to .drift SQL files',
    );

    await sub.cancel();
  });

  test('sharedSpace bucketSource re-emits when a shared_space_asset row is removed', () async {
    const ownerId = 'owner-1';
    const viewerId = 'viewer-1';
    const spaceId = 'space-1';
    const assetId = 'asset-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: ownerId, email: 'o@test', name: 'O'));
    await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: viewerId, email: 'v@test', name: 'V'));
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: assetId,
            name: 'a.jpg',
            type: AssetType.image,
            checksum: 'c1',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
          ),
        );
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Space', createdById: ownerId));
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(SharedSpaceMemberEntityCompanion.insert(spaceId: spaceId, userId: viewerId, role: 'viewer'));
    // Asset IS in the space at subscription time — first emission should show it.
    await db
        .into(db.sharedSpaceAssetEntity)
        .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

    final emissions = <List<Bucket>>[];
    final errors = <Object>[];
    final sub = sut.sharedSpace(spaceId, GroupAssetsBy.day).bucketSource().listen(emissions.add, onError: errors.add);

    await _waitFor(() => emissions.isNotEmpty || errors.isNotEmpty);
    if (errors.isNotEmpty) {
      fail('Stream errored: ${errors.first}');
    }
    expect(emissions.last, hasLength(1));
    expect((emissions.last.single as TimeBucket).assetCount, 1);

    // Remove the asset from the space.
    await (db.delete(
      db.sharedSpaceAssetEntity,
    )..where((t) => t.spaceId.equals(spaceId) & t.assetId.equals(assetId))).go();

    // The watch stream MUST re-emit with zero buckets.
    await _waitFor(() => emissions.length >= 2);
    expect(emissions.last, isEmpty);

    await sub.cancel();
  });

  test('sharedSpace bucketSource re-emits when a shared_space_library link is removed', () async {
    const ownerId = 'owner-1';
    const viewerId = 'viewer-1';
    const spaceId = 'space-1';
    const libraryId = 'library-1';
    const assetId = 'asset-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: ownerId, email: 'o@test', name: 'O'));
    await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: viewerId, email: 'v@test', name: 'V'));
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: assetId,
            name: 'lib.jpg',
            type: AssetType.image,
            checksum: 'c1',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
            libraryId: const Value(libraryId),
          ),
        );
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Space', createdById: ownerId));
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(SharedSpaceMemberEntityCompanion.insert(spaceId: spaceId, userId: viewerId, role: 'viewer'));
    // Library IS linked at subscription time.
    await db
        .into(db.sharedSpaceLibraryEntity)
        .insert(SharedSpaceLibraryEntityCompanion.insert(spaceId: spaceId, libraryId: libraryId));

    final emissions = <List<Bucket>>[];
    final sub = sut.sharedSpace(spaceId, GroupAssetsBy.day).bucketSource().listen(emissions.add);

    await _waitFor(() => emissions.isNotEmpty);
    expect(emissions.last, hasLength(1));
    expect((emissions.last.single as TimeBucket).assetCount, 1);

    // Remove the library link.
    await (db.delete(
      db.sharedSpaceLibraryEntity,
    )..where((t) => t.spaceId.equals(spaceId) & t.libraryId.equals(libraryId))).go();

    await _waitFor(() => emissions.length >= 2);
    expect(emissions.last, isEmpty);

    await sub.cancel();
  });
}

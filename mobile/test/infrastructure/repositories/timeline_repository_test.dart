// Reactivity regression tests for TimelineRepository.sharedSpace.
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

import 'dart:async';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/map.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/entities/exif.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_album_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_album_link.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_library.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';
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
  late TimelineRepository sut;

  setUpAll(() async {
    // truncateDate() uses intl's DateFormat which requires locale data.
    await initializeDateFormatting('en_US');
  });

  setUp(() {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    sut = TimelineRepository(db);
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

  // Links an album into a space (shared_space_album_link) and adds an asset to that
  // album (shared_space_album_asset) — the M4 "space-ALBUM arm".
  Future<void> linkAlbumToSpace(String spaceId, String albumId, String assetId, {bool showInTimeline = true}) async {
    await db
        .into(db.sharedSpaceAlbumLinkEntity)
        .insert(
          SharedSpaceAlbumLinkEntityCompanion.insert(
            spaceId: spaceId,
            albumId: albumId,
            showInTimeline: Value(showInTimeline),
          ),
        );
    await db
        .into(db.sharedSpaceAlbumAssetEntity)
        .insert(SharedSpaceAlbumAssetEntityCompanion.insert(albumId: albumId, assetId: assetId));
  }

  Future<int> videoBucketCount(List<String> userIds, String currentUserId) async {
    final first = await sut.video(userIds, currentUserId, GroupAssetsBy.day).bucketSource().first;
    return first.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
  }

  Future<List<BaseAsset>> videoBucketAssets(List<String> userIds, String currentUserId) {
    return sut.video(userIds, currentUserId, GroupAssetsBy.day).assetSource(0, 100);
  }

  group('TimelineRepository.video() visibility matrix', () {
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

    // M4: the space-ALBUM arm. An asset reachable ONLY via an album linked into a
    // space (no direct shared_space_asset row, no shared_space_library row) must
    // still show up on the personal timeline — gated on BOTH the per-album link's
    // showInTimeline and the viewer's own member showInTimeline.
    test('15. album-linked asset, link + member showInTimeline=true → visible', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: true);
      await linkAlbumToSpace('space1', 'album1', 'a1', showInTimeline: true);
      expect(await videoBucketCount(['viewer'], 'viewer'), 1);
      expect(await videoBucketAssets(['viewer'], 'viewer'), hasLength(1));
    });

    test('16. album-linked asset, album LINK showInTimeline=false → hidden', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: true);
      await linkAlbumToSpace('space1', 'album1', 'a1', showInTimeline: false);
      expect(await videoBucketCount(['viewer'], 'viewer'), 0);
      expect(await videoBucketAssets(['viewer'], 'viewer'), isEmpty);
    });

    test('17. album-linked asset, MEMBER showInTimeline=false → hidden', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: false);
      await linkAlbumToSpace('space1', 'album1', 'a1', showInTimeline: true);
      expect(await videoBucketCount(['viewer'], 'viewer'), 0);
      expect(await videoBucketAssets(['viewer'], 'viewer'), isEmpty);
    });

    test('18. asset reachable via BOTH the album arm and a direct link → counted once', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: true);
      await linkAlbumToSpace('space1', 'album1', 'a1', showInTimeline: true);
      await linkAssetToSpace('space1', 'a1');
      expect(await videoBucketCount(['viewer'], 'viewer'), 1);
      expect(await videoBucketAssets(['viewer'], 'viewer'), hasLength(1));
    });

    test('video() bucket stream re-emits when the album link showInTimeline toggles', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertVideo('a1', 'owner');
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer', showInTimeline: true);
      await linkAlbumToSpace('space1', 'album1', 'a1', showInTimeline: true);

      final emissions = <List<Bucket>>[];
      final sub = sut.video(['viewer'], 'viewer', GroupAssetsBy.day).bucketSource().listen(emissions.add);

      await _waitFor(() => emissions.isNotEmpty);
      expect(emissions.last, hasLength(1));

      await (db.update(db.sharedSpaceAlbumLinkEntity)
            ..where((t) => t.spaceId.equals('space1') & t.albumId.equals('album1')))
          .write(const SharedSpaceAlbumLinkEntityCompanion(showInTimeline: Value(false)));

      await _waitFor(() => emissions.length >= 2);
      expect(emissions.last, isEmpty);

      await sub.cancel();
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

  group('TimelineRepository.place()', () {
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

  group('TimelineRepository.map() bucket sheet', () {
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
          .geographicMap(
            ['viewer'],
            'viewer',
            () => TimelineMapOptions(bounds: naBounds),
            const Stream<TimelineMapOptions>.empty(),
            GroupAssetsBy.day,
          )
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
          .geographicMap(
            ['viewer'],
            'viewer',
            () => TimelineMapOptions(bounds: europeBounds()),
            const Stream<TimelineMapOptions>.empty(),
            GroupAssetsBy.day,
          )
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

    Future<void> insertImageAt(String id, String ownerId, DateTime createdAt) => db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: id,
            name: '$id.jpg',
            type: AssetType.image,
            checksum: 'c-$id',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
          ),
        );

    test('map() groups buckets by month and year', () async {
      await insertUser('viewer');
      // Mid-day times: drift stores DateTimes as UTC text and the bucketing
      // strftime sees the UTC representation, so naive midnight values shift
      // into the previous month/year in non-UTC zones (same precedent as
      // shared_space_repository_test.dart).
      await insertImageAt('jan1', 'viewer', DateTime(2024, 1, 10, 12));
      await insertImageAt('jan2', 'viewer', DateTime(2024, 1, 20, 12));
      await insertImageAt('mar1', 'viewer', DateTime(2024, 3, 5, 12));
      await insertImageAt('prev1', 'viewer', DateTime(2023, 7, 1, 12));
      for (final id in ['jan1', 'jan2', 'mar1', 'prev1']) {
        await insertExifAt(id, 48.85, 2.35); // Paris — inside europeBounds()
      }

      final monthBuckets = await sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: europeBounds()), GroupAssetsBy.month)
          .bucketSource()
          .first;
      expect(monthBuckets, [
        TimeBucket(date: DateTime(2024, 3), assetCount: 1),
        TimeBucket(date: DateTime(2024, 1), assetCount: 2),
        TimeBucket(date: DateTime(2023, 7), assetCount: 1),
      ]);

      final yearBuckets = await sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: europeBounds()), GroupAssetsBy.year)
          .bucketSource()
          .first;
      expect(yearBuckets, [
        TimeBucket(date: DateTime(2024), assetCount: 3),
        TimeBucket(date: DateTime(2023), assetCount: 1),
      ]);
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
            .geographicMap(
              userIds,
              currentUserId,
              () => TimelineMapOptions(bounds: bounds),
              const Stream<TimelineMapOptions>.empty(),
              GroupAssetsBy.day,
            )
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

  // ---------------------------------------------------------------------------
  // fromAssetStream grouped buckets (Slice 1 — data layer)
  // ---------------------------------------------------------------------------

  /// Builds a [RemoteAsset] with a specific [createdAt]; all other fields are
  /// fixed to valid defaults so the constructor is satisfied.
  RemoteAsset makeTestAsset(String id, DateTime createdAt) => RemoteAsset(
    id: id,
    checksum: 'cs-$id',
    ownerId: 'owner',
    name: '$id.jpg',
    type: AssetType.image,
    createdAt: createdAt,
    updatedAt: createdAt,
    durationMs: 0,
    isFavorite: false,
    isEdited: false,
  );

  group('TimelineRepository.fromAssetStream() grouped buckets', () {
    // Four test assets spanning three months / two years (all in local time).
    late List<BaseAsset> assets;

    setUp(() {
      assets = [
        makeTestAsset('a1', DateTime(2024, 3, 20)),
        makeTestAsset('a2', DateTime(2024, 3, 5)),
        makeTestAsset('a3', DateTime(2024, 1, 15)),
        makeTestAsset('a4', DateTime(2023, 12, 31)),
      ];
    });

    test('groupBy month → TimeBuckets newest-first', () async {
      final query = sut.fromAssetStream(
        () => assets,
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.month,
      );
      final buckets = await query.bucketSource().first;
      expect(buckets, [
        TimeBucket(date: DateTime(2024, 3), assetCount: 2),
        TimeBucket(date: DateTime(2024, 1), assetCount: 1),
        TimeBucket(date: DateTime(2023, 12), assetCount: 1),
      ]);
    });

    test('groupBy year → TimeBuckets newest-first', () async {
      final query = sut.fromAssetStream(
        () => assets,
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.year,
      );
      final buckets = await query.bucketSource().first;
      expect(buckets, [
        TimeBucket(date: DateTime(2024), assetCount: 3),
        TimeBucket(date: DateTime(2023), assetCount: 1),
      ]);
    });

    test('groupBy day → day TimeBuckets newest-first', () async {
      final query = sut.fromAssetStream(
        () => assets,
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.day,
      );
      final buckets = await query.bucketSource().first;
      expect(buckets, [
        TimeBucket(date: DateTime(2024, 3, 20), assetCount: 1),
        TimeBucket(date: DateTime(2024, 3, 5), assetCount: 1),
        TimeBucket(date: DateTime(2024, 1, 15), assetCount: 1),
        TimeBucket(date: DateTime(2023, 12, 31), assetCount: 1),
      ]);
    });

    test('groupBy month, descending false → buckets ascending and assets oldest-first', () async {
      final query = sut.fromAssetStream(
        () => assets,
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.month,
        descending: false,
      );
      final buckets = await query.bucketSource().first;
      expect(buckets, [
        TimeBucket(date: DateTime(2023, 12), assetCount: 1),
        TimeBucket(date: DateTime(2024, 1), assetCount: 1),
        TimeBucket(date: DateTime(2024, 3), assetCount: 2),
      ]);
      final fetchedAssets = await query.assetSource(0, assets.length);
      // Oldest-first: 2023-12-31, 2024-01-15, 2024-03-05, 2024-03-20
      expect(fetchedAssets.map((a) => a.createdAt), [
        DateTime(2023, 12, 31),
        DateTime(2024, 1, 15),
        DateTime(2024, 3, 5),
        DateTime(2024, 3, 20),
      ]);
    });

    test('groupBy month, descending → assetSource is date-desc and bucket firstAssetIndex is consistent', () async {
      final query = sut.fromAssetStream(
        () => assets,
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.month,
      );
      final buckets = await query.bucketSource().first;
      final fetchedAssets = await query.assetSource(0, assets.length);
      // Assets should be date-desc: 2024-03-20, 2024-03-05, 2024-01-15, 2023-12-31
      expect(fetchedAssets.map((a) => a.createdAt), [
        DateTime(2024, 3, 20),
        DateTime(2024, 3, 5),
        DateTime(2024, 1, 15),
        DateTime(2023, 12, 31),
      ]);
      // Verify each bucket's firstAssetIndex (cumulative) lands in the right bucket.
      int offset = 0;
      for (final bucket in buckets) {
        final tb = bucket as TimeBucket;
        final rep = fetchedAssets[offset];
        final repDate = rep.createdAt.toLocal();
        expect(repDate.year, tb.date.year, reason: 'Year mismatch at offset $offset');
        expect(repDate.month, tb.date.month, reason: 'Month mismatch at offset $offset');
        offset += bucket.assetCount;
      }
    });

    test(
      'groupBy none (default) → date-less Bucket segments unchanged and assetSource preserves input order',
      () async {
        final query = sut.fromAssetStream(() => assets, const Stream<int>.empty(), TimelineOrigin.search);
        final buckets = await query.bucketSource().first;
        // none uses _generateBuckets: date-less Bucket(assetCount: ≤200 per segment)
        for (final bucket in buckets) {
          expect(bucket, isA<Bucket>());
          expect(bucket, isNot(isA<TimeBucket>()));
        }
        expect(buckets.fold<int>(0, (sum, b) => sum + b.assetCount), assets.length);
        // assetSource preserves the original input order (no sorting for none)
        final fetched = await query.assetSource(0, assets.length);
        expect(fetched.map((a) => a.name), assets.map((a) => a.name));
      },
    );

    test('empty asset list → bucketSource emits empty list; no throw', () async {
      final query = sut.fromAssetStream(
        () => [],
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.month,
      );
      final buckets = await query.bucketSource().first;
      expect(buckets, isEmpty);
    });

    test('single bucket: all assets in one month → one TimeBucket', () async {
      final singleMonth = [
        makeTestAsset('s1', DateTime(2024, 5, 1)),
        makeTestAsset('s2', DateTime(2024, 5, 15)),
        makeTestAsset('s3', DateTime(2024, 5, 31)),
      ];
      final query = sut.fromAssetStream(
        () => singleMonth,
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.month,
      );
      final buckets = await query.bucketSource().first;
      expect(buckets, [TimeBucket(date: DateTime(2024, 5), assetCount: 3)]);
    });

    test('year boundary: 2023-12-31 and 2024-01-01 → correct month and year buckets', () async {
      final boundary = [makeTestAsset('b1', DateTime(2023, 12, 31)), makeTestAsset('b2', DateTime(2024, 1, 1))];
      // month grouping: two separate months (newest-first)
      final monthQuery = sut.fromAssetStream(
        () => boundary,
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.month,
      );
      final monthBuckets = await monthQuery.bucketSource().first;
      expect(monthBuckets, [
        TimeBucket(date: DateTime(2024, 1), assetCount: 1),
        TimeBucket(date: DateTime(2023, 12), assetCount: 1),
      ]);
      // year grouping: two separate years (newest-first)
      final yearQuery = sut.fromAssetStream(
        () => boundary,
        const Stream<int>.empty(),
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.year,
      );
      final yearBuckets = await yearQuery.bucketSource().first;
      expect(yearBuckets, [
        TimeBucket(date: DateTime(2024), assetCount: 1),
        TimeBucket(date: DateTime(2023), assetCount: 1),
      ]);
    });

    test('re-emission: appending an asset triggers re-bucketing', () async {
      final mutableAssets = <BaseAsset>[
        makeTestAsset('r1', DateTime(2024, 3, 20)),
        makeTestAsset('r2', DateTime(2024, 3, 5)),
        makeTestAsset('r3', DateTime(2024, 1, 15)),
        makeTestAsset('r4', DateTime(2023, 12, 31)),
      ];
      final controller = StreamController<int>();
      final query = sut.fromAssetStream(
        () => mutableAssets,
        controller.stream,
        TimelineOrigin.search,
        groupBy: GroupAssetsBy.month,
      );

      final emissions = <List<Bucket>>[];
      final sub = query.bucketSource().listen(emissions.add);

      // First emission: 3 buckets
      await Future<void>.delayed(Duration.zero);
      expect(emissions, hasLength(1));
      expect(emissions.first, hasLength(3));

      // Add a new asset in a new month and signal via the stream
      mutableAssets.add(makeTestAsset('r5', DateTime(2024, 6, 1)));
      controller.add(mutableAssets.length);

      await Future<void>.delayed(Duration.zero);
      expect(emissions, hasLength(2));
      expect(emissions.last, hasLength(4)); // new 2024-06 bucket added
      expect(
        emissions.last.first,
        TimeBucket(date: DateTime(2024, 6), assetCount: 1),
        reason: 'Newest bucket should be 2024-06',
      );

      await sub.cancel();
      await controller.close();
    });
  });

  group('TimelineRepository.sharedSpacePerson()', () {
    // Parity gap sibling of #727 (per-photo faces) and #737 (People page): a Space-shared
    // person's DETAIL timeline.
    //
    // A Space-shared person's photos are owned by another user but sync into the viewer's
    // local DB as Space assets. The face→person links, however, are owner-scoped and never
    // sync to the viewer, so the owner-scoped person() timeline is empty for a person the
    // viewer doesn't own — the "0 items" bug. The server resolves the person's asset ids
    // (GET /shared-spaces/{id}/people/{id}/assets); sharedSpacePerson() renders a timeline
    // restricted to those ids from the locally-synced Space assets, matching the web person
    // detail page.

    setUp(() async {
      await insertUser('admin');
      await insertUser('viewer');
      // Two Space-shared photos owned by admin; only a1 contains the Space person.
      await insertVideo('a1', 'admin', type: AssetType.image);
      await insertVideo('a2', 'admin', type: AssetType.image);
      await insertSpace('s1', 'admin');
      await insertMember('s1', 'viewer', showInTimeline: true);
      await linkAssetToSpace('s1', 'a1');
      await linkAssetToSpace('s1', 'a2');
    });

    test('renders the resolved asset ids even though the viewer does not own them', () async {
      final assets = await sut.sharedSpacePerson(['a1'], GroupAssetsBy.day).assetSource(0, 100);
      expect(assets.map((a) => (a as RemoteAsset).id), ['a1']);

      final buckets = await sut.sharedSpacePerson(['a1'], GroupAssetsBy.day).bucketSource().first;
      final total = buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
      expect(total, 1);
    });

    test('restricts the timeline to the resolved ids, not the whole space', () async {
      final assets = await sut.sharedSpacePerson(['a1'], GroupAssetsBy.day).assetSource(0, 100);
      expect(assets.map((a) => (a as RemoteAsset).id), ['a1']);
      expect(assets.map((a) => (a as RemoteAsset).id), isNot(contains('a2')));
    });

    test('empty resolved id list → no assets and no buckets', () async {
      final assets = await sut.sharedSpacePerson(const [], GroupAssetsBy.day).assetSource(0, 100);
      expect(assets, isEmpty);

      final buckets = await sut.sharedSpacePerson(const [], GroupAssetsBy.day).bucketSource().first;
      final total = buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
      expect(total, 0);
    });

    test('owner-scoped person() is empty for a non-owned Space person (the gap this closes)', () async {
      // No face rows sync for the viewer and the assets are owned by admin, so the existing
      // owner-scoped person timeline returns nothing — the "0 items" bug on the detail page.
      final assets = await sut.person('viewer', 'space-person-1', GroupAssetsBy.day).assetSource(0, 100);
      expect(assets, isEmpty);
    });
  });

  group('TimelineRepository.sharedSpacePerson() archive inclusion (L12)', () {
    // The space-person timeline's visibility filter historically allowed only
    // AssetVisibility.timeline, the 7th site commit 9185ff58e2 missed when it fixed the
    // other 6 (video/place/map/sharedSpace watch+get). The server (getPersonAssetIds)
    // resolves both Timeline and Archive assets for a space person, so mobile was
    // silently dropping the person's archived photos.
    test('archived space-person asset is returned', () async {
      await insertUser('admin');
      await insertUser('viewer');
      await insertVideo('a1', 'admin', type: AssetType.image, visibility: AssetVisibility.archive);
      await insertSpace('s1', 'admin');
      await insertMember('s1', 'viewer', showInTimeline: true);
      await linkAssetToSpace('s1', 'a1');

      final assets = await sut.sharedSpacePerson(['a1'], GroupAssetsBy.day).assetSource(0, 100);
      expect(assets.map((a) => (a as RemoteAsset).id), ['a1']);

      final buckets = await sut.sharedSpacePerson(['a1'], GroupAssetsBy.day).bucketSource().first;
      final total = buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
      expect(total, 1);
    });

    test('positive control: Hidden space-person asset stays excluded', () async {
      await insertUser('admin');
      await insertUser('viewer');
      await insertVideo('a1', 'admin', type: AssetType.image, visibility: AssetVisibility.hidden);
      await insertSpace('s1', 'admin');
      await insertMember('s1', 'viewer', showInTimeline: true);
      await linkAssetToSpace('s1', 'a1');

      final assets = await sut.sharedSpacePerson(['a1'], GroupAssetsBy.day).assetSource(0, 100);
      expect(assets, isEmpty);
    });

    test('positive control: Locked space-person asset stays excluded', () async {
      await insertUser('admin');
      await insertUser('viewer');
      await insertVideo('a1', 'admin', type: AssetType.image, visibility: AssetVisibility.locked);
      await insertSpace('s1', 'admin');
      await insertMember('s1', 'viewer', showInTimeline: true);
      await linkAssetToSpace('s1', 'a1');

      final assets = await sut.sharedSpacePerson(['a1'], GroupAssetsBy.day).assetSource(0, 100);
      expect(assets, isEmpty);
    });
  });
}

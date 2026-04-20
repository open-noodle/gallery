// Visibility regression tests for DriftMapRepository.remote().
//
// The bug we're guarding against: marker queries scoped only by `ownerId IN
// userIds` hide assets that the viewer can legitimately see via shared spaces
// where `showInTimeline=true`. These tests pin the new contract — markers
// follow the same visibility rules as the timeline buckets.

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/infrastructure/entities/exif.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/map.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '_shared_permission_matrix.dart';

void main() {
  late Drift db;
  late DriftMapRepository sut;

  setUpAll(() async {
    await initializeDateFormatting('en_US');
  });

  setUp(() {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    sut = DriftMapRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  // Shared fixture helpers — duplicated from timeline_repository_test.dart
  // because each test file is independent (no cross-file imports of test
  // helpers).
  Future<void> insertUser(String id) =>
      db.into(db.userEntity).insert(UserEntityCompanion.insert(id: id, email: '$id@test', name: id));

  Future<void> insertImage(String id, String ownerId) {
    final createdAt = DateTime(2024, 1, 1, 12);
    return db
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
  }

  Future<void> insertExifAt(String assetId, double lat, double lng) => db
      .into(db.remoteExifEntity)
      .insert(RemoteExifEntityCompanion.insert(assetId: assetId, latitude: Value(lat), longitude: Value(lng)));

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

  LatLngBounds globeBounds() => LatLngBounds(southwest: const LatLng(-89, -179), northeast: const LatLng(89, 179));

  group('DriftMapRepository.remote()', () {
    test('owner marker returned', () async {
      await insertUser('viewer');
      await insertImage('a1', 'viewer');
      await insertExifAt('a1', 48.85, 2.35);

      final markers = await sut
          .remote(['viewer'], 'viewer', TimelineMapOptions(bounds: globeBounds()))
          .markerSource(globeBounds());
      expect(markers, hasLength(1));
    });

    test('space-visible marker returned', () async {
      await insertUser('viewer');
      await insertUser('owner');
      await insertImage('a1', 'owner');
      await insertExifAt('a1', 48.85, 2.35);
      await insertSpace('space1', 'owner');
      await insertMember('space1', 'viewer');
      await linkAssetToSpace('space1', 'a1');

      final markers = await sut
          .remote(['viewer'], 'viewer', TimelineMapOptions(bounds: globeBounds()))
          .markerSource(globeBounds());
      expect(markers, hasLength(1));
    });
  });

  group('Cross-method permission matrix — DriftMapRepository.remote() markers', () {
    final bounds = LatLngBounds(southwest: const LatLng(-89, -179), northeast: const LatLng(89, 179));
    runPermissionMatrix(
      methodName: 'marker',
      fixtures: MatrixFixtures(
        db: () => db,
        insertAsset: (assetId, ownerId) async {
          await insertImage(assetId, ownerId);
          await insertExifAt(assetId, 48.85, 2.35);
        },
      ),
      count: (userIds, currentUserId) async {
        final markers = await sut
            .remote(userIds, currentUserId, TimelineMapOptions(bounds: bounds))
            .markerSource(bounds);
        return markers.length;
      },
    );
  });
}

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
import 'package:immich_mobile/infrastructure/entities/shared_space_library.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/map.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

typedef MatrixCase = ({
  String name,
  Future<void> Function() setup,
  int expectedCount,
  List<String> userIds,
  String currentUserId,
});

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

  Future<void> insertExifAt(String assetId, double lat, double lng) =>
      db.into(db.remoteExifEntity).insert(
            RemoteExifEntityCompanion.insert(
              assetId: assetId,
              latitude: Value(lat),
              longitude: Value(lng),
            ),
          );

  Future<void> insertSpace(String id, String ownerId) => db
      .into(db.sharedSpaceEntity)
      .insert(SharedSpaceEntityCompanion.insert(id: id, name: id, createdById: ownerId));

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

  LatLngBounds globeBounds() =>
      LatLngBounds(southwest: const LatLng(-89, -179), northeast: const LatLng(89, 179));

  // ---------------------------------------------------------------------------
  // Permission matrix helper — Task 14.5
  // ---------------------------------------------------------------------------
  // Duplicated from timeline_repository_test.dart because each test file is
  // independent and runs against its own Drift in-memory instance.

  List<MatrixCase> permissionMatrixCases({
    required Future<void> Function(String assetId, String ownerId) insertAsset,
  }) {
    Future<void> single(
      String ownerId,
      Future<void> Function(String assetId) extra,
    ) async {
      await insertUser(ownerId);
      await insertAsset('asset-1', ownerId);
      await extra('asset-1');
    }

    return <MatrixCase>[
      (
        name: 'M1: owner asset visible',
        setup: () async {
          await insertUser('viewer');
          await insertAsset('asset-1', 'viewer');
        },
        expectedCount: 1,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M2: partner asset visible',
        setup: () async {
          await insertUser('viewer');
          await single('partner', (_) async {});
        },
        expectedCount: 1,
        userIds: const ['viewer', 'partner'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M3: unrelated user hidden',
        setup: () async {
          await insertUser('viewer');
          await single('stranger', (_) async {});
        },
        expectedCount: 0,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M4: space member showInTimeline=true visible',
        setup: () async {
          await insertUser('viewer');
          await single('owner', (a) async {
            await insertSpace('sp1', 'owner');
            await insertMember('sp1', 'viewer', showInTimeline: true);
            await linkAssetToSpace('sp1', a);
          });
        },
        expectedCount: 1,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M5: space member showInTimeline=false hidden',
        setup: () async {
          await insertUser('viewer');
          await single('owner', (a) async {
            await insertSpace('sp1', 'owner');
            await insertMember('sp1', 'viewer', showInTimeline: false);
            await linkAssetToSpace('sp1', a);
          });
        },
        expectedCount: 0,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M6: partner is member, viewer is NOT -> hidden',
        setup: () async {
          await insertUser('viewer');
          await insertUser('partner');
          await single('owner', (a) async {
            await insertSpace('sp1', 'owner');
            await insertMember('sp1', 'partner', showInTimeline: true);
            await linkAssetToSpace('sp1', a);
          });
        },
        expectedCount: 0,
        userIds: const ['viewer', 'partner'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M7: library-in-space showInTimeline=true visible',
        setup: () async {
          await insertUser('viewer');
          await insertUser('owner');
          await insertAsset('asset-1', 'owner');
          await (db.update(db.remoteAssetEntity)..where((t) => t.id.equals('asset-1')))
              .write(const RemoteAssetEntityCompanion(libraryId: Value('lib-1')));
          await insertSpace('sp1', 'owner');
          await insertMember('sp1', 'viewer', showInTimeline: true);
          await linkLibraryToSpace('sp1', 'lib-1');
        },
        expectedCount: 1,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M8: library-in-space showInTimeline=false hidden',
        setup: () async {
          await insertUser('viewer');
          await insertUser('owner');
          await insertAsset('asset-1', 'owner');
          await (db.update(db.remoteAssetEntity)..where((t) => t.id.equals('asset-1')))
              .write(const RemoteAssetEntityCompanion(libraryId: Value('lib-1')));
          await insertSpace('sp1', 'owner');
          await insertMember('sp1', 'viewer', showInTimeline: false);
          await linkLibraryToSpace('sp1', 'lib-1');
        },
        expectedCount: 0,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M9: asset in 2 direct spaces counted once',
        setup: () async {
          await insertUser('viewer');
          await single('owner', (a) async {
            await insertSpace('sp1', 'owner');
            await insertSpace('sp2', 'owner');
            await insertMember('sp1', 'viewer');
            await insertMember('sp2', 'viewer');
            await linkAssetToSpace('sp1', a);
            await linkAssetToSpace('sp2', a);
          });
        },
        expectedCount: 1,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M10: direct + library link on same space counted once',
        setup: () async {
          await insertUser('viewer');
          await insertUser('owner');
          await insertAsset('asset-1', 'owner');
          await (db.update(db.remoteAssetEntity)..where((t) => t.id.equals('asset-1')))
              .write(const RemoteAssetEntityCompanion(libraryId: Value('lib-1')));
          await insertSpace('sp1', 'owner');
          await insertMember('sp1', 'viewer');
          await linkAssetToSpace('sp1', 'asset-1');
          await linkLibraryToSpace('sp1', 'lib-1');
        },
        expectedCount: 1,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M11: opposite showInTimeline across two spaces -> visible via true branch',
        setup: () async {
          await insertUser('viewer');
          await insertUser('owner');
          await insertAsset('asset-1', 'owner');
          await (db.update(db.remoteAssetEntity)..where((t) => t.id.equals('asset-1')))
              .write(const RemoteAssetEntityCompanion(libraryId: Value('lib-1')));
          await insertSpace('sp_a', 'owner');
          await insertSpace('sp_b', 'owner');
          await insertMember('sp_a', 'viewer', showInTimeline: true);
          await insertMember('sp_b', 'viewer', showInTimeline: false);
          await linkAssetToSpace('sp_a', 'asset-1');
          await linkLibraryToSpace('sp_b', 'lib-1');
        },
        expectedCount: 1,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M12: role=admin sees same as role=viewer',
        setup: () async {
          await insertUser('viewer');
          await single('owner', (a) async {
            await insertSpace('sp1', 'owner');
            await db.into(db.sharedSpaceMemberEntity).insert(
                  SharedSpaceMemberEntityCompanion.insert(
                    spaceId: 'sp1',
                    userId: 'viewer',
                    role: 'admin',
                    showInTimeline: const Value(true),
                  ),
                );
            await linkAssetToSpace('sp1', a);
          });
        },
        expectedCount: 1,
        userIds: const ['viewer'],
        currentUserId: 'viewer',
      ),
      (
        name: 'M13: viewer + partner both members of same space -> visible once',
        setup: () async {
          await insertUser('viewer');
          await insertUser('partner');
          await single('owner', (a) async {
            await insertSpace('sp1', 'owner');
            await insertMember('sp1', 'viewer', showInTimeline: true);
            await insertMember('sp1', 'partner', showInTimeline: true);
            await linkAssetToSpace('sp1', a);
          });
        },
        expectedCount: 1,
        userIds: const ['viewer', 'partner'],
        currentUserId: 'viewer',
      ),
    ];
  }

  void runPermissionMatrix({
    required String methodName,
    required Future<void> Function(String assetId, String ownerId) insertAsset,
    required Future<int> Function(List<String> userIds, String currentUserId) count,
  }) {
    for (final tc in permissionMatrixCases(insertAsset: insertAsset)) {
      test('$methodName — ${tc.name}', () async {
        await tc.setup();
        final got = await count(tc.userIds, tc.currentUserId);
        expect(got, tc.expectedCount, reason: 'matrix case: ${tc.name}');
      });
    }
  }

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
    final bounds = LatLngBounds(
      southwest: const LatLng(-89, -179),
      northeast: const LatLng(89, 179),
    );
    runPermissionMatrix(
      methodName: 'marker',
      insertAsset: (assetId, ownerId) async {
        await insertImage(assetId, ownerId);
        await insertExifAt(assetId, 48.85, 2.35);
      },
      count: (userIds, currentUserId) async {
        final markers = await sut
            .remote(userIds, currentUserId, TimelineMapOptions(bounds: bounds))
            .markerSource(bounds);
        return markers.length;
      },
    );
  });
}

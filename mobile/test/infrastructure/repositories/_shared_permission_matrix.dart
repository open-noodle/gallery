// Shared permission matrix fixture for visibility-aware repository methods.
//
// `MatrixCase`, `permissionMatrixCases`, and `runPermissionMatrix` are
// duplicated across timeline_repository_test.dart and map_repository_test.dart
// without this helper. Each test file constructs a `MatrixFixtures` instance
// with its own Drift in-memory database and a method-specific `insertAsset`
// closure (which handles per-method prereqs like exif city or lat/lng), then
// reuses the 13 cross-cutting permission cases.
//
// The leading underscore on the filename is a Dart convention for
// "package-private" test helpers — other test files import this directly,
// they should not re-export it.

import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_library.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';

typedef MatrixCase = ({
  String name,
  Future<void> Function() setup,
  int expectedCount,
  List<String> userIds,
  String currentUserId,
});

/// Encapsulates the fixture helpers needed by the permission matrix. Each
/// test file constructs one of these with a lazy [db] provider and a
/// method-specific [insertAsset] closure, then passes it to
/// [permissionMatrixCases] / [runPermissionMatrix].
///
/// IMPORTANT: [db] is a getter (not a value) because each test re-creates the
/// [Drift] instance in `setUp()`. Capturing the reference at registration
/// time would pin to a stale instance — every helper must dereference the
/// getter at call time so it sees the current setUp's database.
class MatrixFixtures {
  MatrixFixtures({required Drift Function() db, required this.insertAsset}) : _db = db;

  final Drift Function() _db;
  Drift get db => _db();

  /// Inserts a row in `remote_asset_entity` with any method-specific prereqs
  /// (e.g. exif city for `place()`, lat/lng for `map()` / marker).
  final Future<void> Function(String assetId, String ownerId) insertAsset;

  Future<void> insertUser(String id) =>
      db.into(db.userEntity).insert(UserEntityCompanion.insert(id: id, email: '$id@test', name: id));

  Future<void> insertSpace(String id, String ownerId) =>
      db.into(db.sharedSpaceEntity).insert(SharedSpaceEntityCompanion.insert(id: id, name: id, createdById: ownerId));

  Future<void> insertMember(String spaceId, String userId, {bool showInTimeline = true, String role = 'viewer'}) => db
      .into(db.sharedSpaceMemberEntity)
      .insert(
        SharedSpaceMemberEntityCompanion.insert(
          spaceId: spaceId,
          userId: userId,
          role: role,
          showInTimeline: Value(showInTimeline),
        ),
      );

  Future<void> linkAssetToSpace(String spaceId, String assetId) => db
      .into(db.sharedSpaceAssetEntity)
      .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

  Future<void> linkLibraryToSpace(String spaceId, String libraryId) => db
      .into(db.sharedSpaceLibraryEntity)
      .insert(SharedSpaceLibraryEntityCompanion.insert(spaceId: spaceId, libraryId: libraryId));

  Future<void> setLibraryId(String assetId, String libraryId) => (db.update(
    db.remoteAssetEntity,
  )..where((t) => t.id.equals(assetId))).write(RemoteAssetEntityCompanion(libraryId: Value(libraryId)));
}

/// Returns the 13 cross-cutting permission cases. Each case's `setup` uses
/// the supplied [f] fixtures so the same matrix can be exercised against any
/// visibility-aware method.
List<MatrixCase> permissionMatrixCases(MatrixFixtures f) {
  Future<void> single(String ownerId, Future<void> Function(String assetId) extra) async {
    await f.insertUser(ownerId);
    await f.insertAsset('asset-1', ownerId);
    await extra('asset-1');
  }

  return <MatrixCase>[
    (
      name: 'M1: owner asset visible',
      setup: () async {
        await f.insertUser('viewer');
        await f.insertAsset('asset-1', 'viewer');
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M2: partner asset visible',
      setup: () async {
        await f.insertUser('viewer');
        await single('partner', (_) async {});
      },
      expectedCount: 1,
      userIds: const ['viewer', 'partner'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M3: unrelated user hidden',
      setup: () async {
        await f.insertUser('viewer');
        await single('stranger', (_) async {});
      },
      expectedCount: 0,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M4: space member showInTimeline=true visible',
      setup: () async {
        await f.insertUser('viewer');
        await single('owner', (a) async {
          await f.insertSpace('sp1', 'owner');
          await f.insertMember('sp1', 'viewer', showInTimeline: true);
          await f.linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M5: space member showInTimeline=false hidden',
      setup: () async {
        await f.insertUser('viewer');
        await single('owner', (a) async {
          await f.insertSpace('sp1', 'owner');
          await f.insertMember('sp1', 'viewer', showInTimeline: false);
          await f.linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 0,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M6: partner is member, viewer is NOT -> hidden',
      setup: () async {
        await f.insertUser('viewer');
        await f.insertUser('partner');
        await single('owner', (a) async {
          await f.insertSpace('sp1', 'owner');
          await f.insertMember('sp1', 'partner', showInTimeline: true);
          await f.linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 0,
      userIds: const ['viewer', 'partner'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M7: library-in-space showInTimeline=true visible',
      setup: () async {
        await f.insertUser('viewer');
        await f.insertUser('owner');
        await f.insertAsset('asset-1', 'owner');
        await f.setLibraryId('asset-1', 'lib-1');
        await f.insertSpace('sp1', 'owner');
        await f.insertMember('sp1', 'viewer', showInTimeline: true);
        await f.linkLibraryToSpace('sp1', 'lib-1');
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M8: library-in-space showInTimeline=false hidden',
      setup: () async {
        await f.insertUser('viewer');
        await f.insertUser('owner');
        await f.insertAsset('asset-1', 'owner');
        await f.setLibraryId('asset-1', 'lib-1');
        await f.insertSpace('sp1', 'owner');
        await f.insertMember('sp1', 'viewer', showInTimeline: false);
        await f.linkLibraryToSpace('sp1', 'lib-1');
      },
      expectedCount: 0,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M9: asset in 2 direct spaces counted once',
      setup: () async {
        await f.insertUser('viewer');
        await single('owner', (a) async {
          await f.insertSpace('sp1', 'owner');
          await f.insertSpace('sp2', 'owner');
          await f.insertMember('sp1', 'viewer');
          await f.insertMember('sp2', 'viewer');
          await f.linkAssetToSpace('sp1', a);
          await f.linkAssetToSpace('sp2', a);
        });
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M10: direct + library link on same space counted once',
      setup: () async {
        await f.insertUser('viewer');
        await f.insertUser('owner');
        await f.insertAsset('asset-1', 'owner');
        await f.setLibraryId('asset-1', 'lib-1');
        await f.insertSpace('sp1', 'owner');
        await f.insertMember('sp1', 'viewer');
        await f.linkAssetToSpace('sp1', 'asset-1');
        await f.linkLibraryToSpace('sp1', 'lib-1');
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M11: opposite showInTimeline across two spaces -> visible via true branch',
      setup: () async {
        await f.insertUser('viewer');
        await f.insertUser('owner');
        await f.insertAsset('asset-1', 'owner');
        await f.setLibraryId('asset-1', 'lib-1');
        await f.insertSpace('sp_a', 'owner');
        await f.insertSpace('sp_b', 'owner');
        await f.insertMember('sp_a', 'viewer', showInTimeline: true);
        await f.insertMember('sp_b', 'viewer', showInTimeline: false);
        await f.linkAssetToSpace('sp_a', 'asset-1');
        await f.linkLibraryToSpace('sp_b', 'lib-1');
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M12: role=admin sees same as role=viewer',
      setup: () async {
        await f.insertUser('viewer');
        await single('owner', (a) async {
          await f.insertSpace('sp1', 'owner');
          await f.insertMember('sp1', 'viewer', role: 'admin', showInTimeline: true);
          await f.linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M13: viewer + partner both members of same space -> visible once',
      setup: () async {
        await f.insertUser('viewer');
        await f.insertUser('partner');
        await single('owner', (a) async {
          await f.insertSpace('sp1', 'owner');
          await f.insertMember('sp1', 'viewer', showInTimeline: true);
          await f.insertMember('sp1', 'partner', showInTimeline: true);
          await f.linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 1,
      userIds: const ['viewer', 'partner'],
      currentUserId: 'viewer',
    ),
  ];
}

/// Registers one [test] per matrix case under [methodName], invoking [count]
/// to count visible assets after the case's setup runs.
void runPermissionMatrix({
  required String methodName,
  required MatrixFixtures fixtures,
  required Future<int> Function(List<String> userIds, String currentUserId) count,
}) {
  for (final tc in permissionMatrixCases(fixtures)) {
    test('$methodName — ${tc.name}', () async {
      await tc.setup();
      final got = await count(tc.userIds, tc.currentUserId);
      expect(got, tc.expectedCount, reason: 'matrix case: ${tc.name}');
    });
  }
}

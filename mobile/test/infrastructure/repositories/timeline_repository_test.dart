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
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_library.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';

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
    await (db.update(db.sharedSpaceMemberEntity)
          ..where((t) => t.spaceId.equals(spaceId) & t.userId.equals(viewerId)))
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
        .insert(
          SharedSpaceMemberEntityCompanion.insert(spaceId: spaceId, userId: viewerId, role: 'viewer'),
        );
    // Asset IS in the space at subscription time — first emission should show it.
    await db
        .into(db.sharedSpaceAssetEntity)
        .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

    final emissions = <List<Bucket>>[];
    final errors = <Object>[];
    final sub = sut
        .sharedSpace(spaceId, GroupAssetsBy.day)
        .bucketSource()
        .listen(emissions.add, onError: errors.add);

    await _waitFor(() => emissions.isNotEmpty || errors.isNotEmpty);
    if (errors.isNotEmpty) {
      fail('Stream errored: ${errors.first}');
    }
    expect(emissions.last, hasLength(1));
    expect((emissions.last.single as TimeBucket).assetCount, 1);

    // Remove the asset from the space.
    await (db.delete(db.sharedSpaceAssetEntity)
          ..where((t) => t.spaceId.equals(spaceId) & t.assetId.equals(assetId)))
        .go();

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
        .insert(
          SharedSpaceMemberEntityCompanion.insert(spaceId: spaceId, userId: viewerId, role: 'viewer'),
        );
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
    await (db.delete(db.sharedSpaceLibraryEntity)
          ..where((t) => t.spaceId.equals(spaceId) & t.libraryId.equals(libraryId)))
        .go();

    await _waitFor(() => emissions.length >= 2);
    expect(emissions.last, isEmpty);

    await sub.cancel();
  });
}

@Tags(['scale'])
library;

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_stream.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:openapi/api.dart';

// Compile-time gate. Without `--dart-define=RUN_SCALE=true` this resolves to
// false and main() returns early so no test is registered (the file is still
// discovered, but it contributes zero tests). The @Tags above keeps the
// runner from accidentally running it via tag-based selection.
const bool _kRunScaleTest = bool.fromEnvironment('RUN_SCALE');

// Scale test for the library backfill hot path.
//
// Validates that sync_stream.repository.dart's batched insert strategy holds
// at 100k assets and that the Drift sharedSpace() bucket query stays well
// under the 200ms target on a populated DB.
//
// **Run manually**:
//
//     cd mobile && flutter test test/infrastructure/repositories/shared_space_scale_test.dart --tags=scale --reporter expanded
//
// Expected output is recorded in
// docs/plans/2026-04-08-mobile-shared-space-drift-sync-scale-notes.md.
//
// Important: this test exercises the SAME code path that runs during a real
// backfill (sync_stream handler → Drift batch insert), NOT a synthetic raw
// insert. The point is to surface memory pressure or insert latency exactly
// where it would surface in production.

void main() {
  if (!_kRunScaleTest) {
    // Skipped by default — register no tests so the file contributes zero
    // overhead to regular test runs. Run manually via:
    //   flutter test test/infrastructure/repositories/shared_space_scale_test.dart \
    //     --dart-define=RUN_SCALE=true --reporter expanded
    return;
  }

  late Drift db;
  late SyncStreamRepository sut;

  setUpAll(() async {
    // The sharedSpace() bucket query uses locale-aware date formatting — the
    // default 'en' locale must be initialized or the query hangs forever.
    await initializeDateFormatting('en');
  });

  setUp(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    sut = SyncStreamRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  test('backfills 100k-asset library through the sync handler without OOM', timeout: const Timeout(Duration(minutes: 15)), () async {
    const int assetCount = 100000;
    const String userId = 'user-1';
    const String libraryId = 'library-scale-test';
    const String spaceId = 'space-scale-test';

    // Pre-seed the user, the library, the space, and the link row so the
    // backfill stream has somewhere to land.
    await sut.updateUsersV1([
      SyncUserV1(
        id: userId,
        name: 'Scale Test User',
        email: 'scale@scale.test',
        deletedAt: null,
        avatarColor: null,
        hasProfileImage: false,
        profileChangedAt: DateTime(2024, 1, 1),
      ),
    ]);
    await sut.updateLibrariesV1([
      SyncLibraryV1(
        id: libraryId,
        name: 'Scale Test Library',
        ownerId: userId,
        createdAt: DateTime(2024, 1, 1),
        updatedAt: DateTime(2024, 1, 1),
      ),
    ]);
    await sut.updateSharedSpacesV1([
      SyncSharedSpaceV1(
        id: spaceId,
        name: 'Scale Test Space',
        description: null,
        color: null,
        createdById: userId,
        thumbnailAssetId: null,
        thumbnailCropY: null,
        faceRecognitionEnabled: true,
        petsEnabled: false,
        lastActivityAt: null,
        createdAt: DateTime(2024, 1, 1),
        updatedAt: DateTime(2024, 1, 1),
      ),
    ]);
    await sut.updateSharedSpaceLibrariesV1([
      SyncSharedSpaceLibraryV1(
        spaceId: spaceId,
        libraryId: libraryId,
        addedById: userId,
        createdAt: DateTime(2024, 1, 1),
        updatedAt: DateTime(2024, 1, 1),
      ),
    ]);

    // Build 100k synthetic asset DTOs. Spreading createdAt across one minute
    // increments so the bucket query has a realistic distribution to walk.
    final base = DateTime(2024, 1, 1);
    final dtos = List<SyncAssetV1>.generate(
      assetCount,
      (i) => SyncAssetV1(
        id: 'scale-asset-$i',
        checksum: 'scale-checksum-$i',
        originalFileName: 'scale-$i.jpg',
        type: AssetTypeEnum.IMAGE,
        ownerId: userId,
        isFavorite: false,
        fileCreatedAt: base.subtract(Duration(minutes: i)),
        fileModifiedAt: base.subtract(Duration(minutes: i)),
        localDateTime: base.subtract(Duration(minutes: i)),
        visibility: AssetVisibility.timeline,
        width: 100,
        height: 100,
        deletedAt: null,
        duration: null,
        libraryId: libraryId,
        livePhotoVideoId: null,
        stackId: null,
        thumbhash: null,
        isEdited: false,
      ),
    );

    // Time the actual handler path — this is the production hot path for a
    // backfill. If memory pressure surfaces it shows up here.
    final insertStart = DateTime.now();
    await sut.updateLibraryAssetsV1(dtos);
    final insertMs = DateTime.now().difference(insertStart).inMilliseconds;

    // Verify all rows landed.
    final rowCount = (await db.remoteAssetEntity.select().get()).length;
    expect(rowCount, assetCount);

    // Time the bucket query — the hot path when a user opens the space on
    // mobile. Target is 200ms; we assert <500ms with noise tolerance.
    final timelineRepo = DriftTimelineRepository(db);
    final query = timelineRepo.sharedSpace(spaceId, GroupAssetsBy.day);

    final queryStart = DateTime.now();
    final buckets = await query.bucketSource().first;
    final queryMs = DateTime.now().difference(queryStart).inMilliseconds;

    // Time fetching the first page of assets (offset 0, count 100) — what the
    // mobile UI actually requests on first render.
    final pageStart = DateTime.now();
    final firstPage = await query.assetSource(0, 100);
    final pageMs = DateTime.now().difference(pageStart).inMilliseconds;

    // Print numbers for the manual run; record them in the scale-notes file.
    // ignore: avoid_print
    print(
      '\n[scale-test] Insert ${insertMs}ms · Bucket query ${queryMs}ms · '
      'First page (100 assets) ${pageMs}ms · Buckets ${buckets.length} · '
      'Rows $rowCount · First page rows ${firstPage.length}',
    );

    // Loose sanity check on the bucket query — the real target is 200ms, this
    // gives generous noise tolerance for varied developer hardware.
    expect(queryMs, lessThan(500), reason: 'sharedSpace() bucket query should stay well under 500ms at 100k assets');

    // First page should return exactly min(100, assetCount) assets.
    expect(firstPage, hasLength(assetCount < 100 ? assetCount : 100));
  });

  // --- gallery-fork: additional scale scenarios ---
  //
  // These three tests exercise the other scale-critical hot paths that the
  // single 100k backfill test above does not cover:
  //
  // 1. Mixed workload: a space that has 50k direct-add assets AND 50k
  //    library-linked assets. Exercises the UNION query under a realistic
  //    bimodal load — some users upload directly to a space, others link
  //    their external libraries.
  //
  // 2. Incremental sync at scale: a 100k backfill followed by a 1k delta
  //    batch. Tests the hot path a user hits when they reopen the app
  //    after it has been suspended — a large local dataset and a small
  //    incoming batch.
  //
  // 3. Sweep at scale: 100k assets spread across 200 libraries, then
  //    DELETE 100 libraries. Stresses the orphan sweep's chunk loop under
  //    a realistic multi-library revocation.

  test(
    'mixed backfill: 50k direct-add + 50k library-linked through the sync handler',
    timeout: const Timeout(Duration(minutes: 15)),
    () async {
      const int halfCount = 50000;
      const String userId = 'user-1';
      const String libraryId = 'mixed-lib';
      const String spaceId = 'mixed-space';

      await sut.updateUsersV1([
        SyncUserV1(
          id: userId,
          name: 'Mixed Scale User',
          email: 'mixed@scale.test',
          deletedAt: null,
          avatarColor: null,
          hasProfileImage: false,
          profileChangedAt: DateTime(2024, 1, 1),
        ),
      ]);
      await sut.updateLibrariesV1([
        SyncLibraryV1(
          id: libraryId,
          name: 'Mixed Scale Library',
          ownerId: userId,
          createdAt: DateTime(2024, 1, 1),
          updatedAt: DateTime(2024, 1, 1),
        ),
      ]);
      await sut.updateSharedSpacesV1([
        SyncSharedSpaceV1(
          id: spaceId,
          name: 'Mixed Scale Space',
          description: null,
          color: null,
          createdById: userId,
          thumbnailAssetId: null,
          thumbnailCropY: null,
          faceRecognitionEnabled: true,
          petsEnabled: false,
          lastActivityAt: null,
          createdAt: DateTime(2024, 1, 1),
          updatedAt: DateTime(2024, 1, 1),
        ),
      ]);
      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: spaceId,
          libraryId: libraryId,
          addedById: userId,
          createdAt: DateTime(2024, 1, 1),
          updatedAt: DateTime(2024, 1, 1),
        ),
      ]);

      SyncAssetV1 makeAsset(int i, {String? libId}) {
        final base = DateTime(2024, 1, 1);
        return SyncAssetV1(
          id: 'mixed-asset-$i',
          checksum: 'mixed-checksum-$i',
          originalFileName: 'mixed-$i.jpg',
          type: AssetTypeEnum.IMAGE,
          ownerId: userId,
          isFavorite: false,
          fileCreatedAt: base.subtract(Duration(minutes: i)),
          fileModifiedAt: base.subtract(Duration(minutes: i)),
          localDateTime: base.subtract(Duration(minutes: i)),
          visibility: AssetVisibility.timeline,
          width: 100,
          height: 100,
          deletedAt: null,
          duration: null,
          libraryId: libId,
          livePhotoVideoId: null,
          stackId: null,
          thumbhash: null,
          isEdited: false,
        );
      }

      // 50k library-linked assets.
      final libraryAssetDtos = List<SyncAssetV1>.generate(halfCount, (i) => makeAsset(i, libId: libraryId));
      // 50k direct-add assets (no libraryId).
      final directAssetDtos = List<SyncAssetV1>.generate(halfCount, (i) => makeAsset(halfCount + i));

      final insertStart = DateTime.now();
      await sut.updateLibraryAssetsV1(libraryAssetDtos);
      await sut.updateSharedSpaceAssetsV1(directAssetDtos);
      // Wire each direct-add asset into the shared_space_asset join table.
      await sut.updateSharedSpaceToAssetsV1([
        for (final dto in directAssetDtos) SyncSharedSpaceToAssetV1(spaceId: spaceId, assetId: dto.id),
      ]);
      final insertMs = DateTime.now().difference(insertStart).inMilliseconds;

      // Verify both sides landed.
      final rowCount = (await db.remoteAssetEntity.select().get()).length;
      expect(rowCount, halfCount * 2);

      // Time the UNION bucket query across both sources.
      final timelineRepo = DriftTimelineRepository(db);
      final query = timelineRepo.sharedSpace(spaceId, GroupAssetsBy.day);

      final queryStart = DateTime.now();
      final buckets = await query.bucketSource().first;
      final queryMs = DateTime.now().difference(queryStart).inMilliseconds;

      final pageStart = DateTime.now();
      final firstPage = await query.assetSource(0, 100);
      final pageMs = DateTime.now().difference(pageStart).inMilliseconds;

      // ignore: avoid_print
      print(
        '\n[scale-test] mixed backfill · Insert ${insertMs}ms · Bucket query ${queryMs}ms · '
        'First page (100 assets) ${pageMs}ms · Buckets ${buckets.length} · '
        'Rows $rowCount · First page rows ${firstPage.length}',
      );

      // UNION on 100k rows must still be reasonable.
      expect(queryMs, lessThan(1000), reason: 'UNION bucket query at 100k mixed assets should stay under 1s');
      expect(firstPage, hasLength(100));
    },
  );

  test(
    'incremental sync at scale: 100k initial backfill + 1k delta batch',
    timeout: const Timeout(Duration(minutes: 15)),
    () async {
      const int initialCount = 100000;
      const int deltaCount = 1000;
      const String userId = 'user-1';
      const String libraryId = 'delta-lib';

      await sut.updateUsersV1([
        SyncUserV1(
          id: userId,
          name: 'Delta User',
          email: 'delta@scale.test',
          deletedAt: null,
          avatarColor: null,
          hasProfileImage: false,
          profileChangedAt: DateTime(2024, 1, 1),
        ),
      ]);
      await sut.updateLibrariesV1([
        SyncLibraryV1(
          id: libraryId,
          name: 'Delta Library',
          ownerId: userId,
          createdAt: DateTime(2024, 1, 1),
          updatedAt: DateTime(2024, 1, 1),
        ),
      ]);

      SyncAssetV1 makeAsset(int i) {
        final base = DateTime(2024, 1, 1);
        return SyncAssetV1(
          id: 'delta-asset-$i',
          checksum: 'delta-checksum-$i',
          originalFileName: 'delta-$i.jpg',
          type: AssetTypeEnum.IMAGE,
          ownerId: userId,
          isFavorite: false,
          fileCreatedAt: base.subtract(Duration(minutes: i)),
          fileModifiedAt: base.subtract(Duration(minutes: i)),
          localDateTime: base.subtract(Duration(minutes: i)),
          visibility: AssetVisibility.timeline,
          width: 100,
          height: 100,
          deletedAt: null,
          duration: null,
          libraryId: libraryId,
          livePhotoVideoId: null,
          stackId: null,
          thumbhash: null,
          isEdited: false,
        );
      }

      // Backfill.
      final initialStart = DateTime.now();
      await sut.updateLibraryAssetsV1(List.generate(initialCount, makeAsset));
      final initialMs = DateTime.now().difference(initialStart).inMilliseconds;

      // Delta batch — typical "user reopens app and has 1k new photos".
      final deltaStart = DateTime.now();
      await sut.updateLibraryAssetsV1(
        List.generate(deltaCount, (i) => makeAsset(initialCount + i)),
      );
      final deltaMs = DateTime.now().difference(deltaStart).inMilliseconds;

      final finalCount = (await db.remoteAssetEntity.select().get()).length;
      expect(finalCount, initialCount + deltaCount);

      // ignore: avoid_print
      print(
        '\n[scale-test] incremental · Initial $initialCount in ${initialMs}ms · '
        'Delta $deltaCount in ${deltaMs}ms',
      );

      // Delta insert should be much faster than initial — the test is
      // whether it stays proportional (~1% of initial time) or whether
      // something in the batch path scales with total db size.
      expect(
        deltaMs,
        lessThan(initialMs),
        reason: '1k delta must be faster than 100k initial',
      );
    },
  );

  test(
    'sweep at scale: 100k assets across 200 libraries, delete 100 libraries',
    timeout: const Timeout(Duration(minutes: 15)),
    () async {
      const int libraryCount = 200;
      const int assetsPerLibrary = 500; // → 100k total
      const int librariesToDelete = 100;
      const String userId = 'user-1';
      const String foreignUserId = 'user-foreign';

      await sut.updateUsersV1([
        SyncUserV1(
          id: userId,
          name: 'Sweep User',
          email: 'sweep@scale.test',
          deletedAt: null,
          avatarColor: null,
          hasProfileImage: false,
          profileChangedAt: DateTime(2024, 1, 1),
        ),
        SyncUserV1(
          id: foreignUserId,
          name: 'Foreign User',
          email: 'foreign@scale.test',
          deletedAt: null,
          avatarColor: null,
          hasProfileImage: false,
          profileChangedAt: DateTime(2024, 1, 1),
        ),
      ]);

      // Create 200 libraries — all owned by the foreign user so their
      // assets are orphan candidates on sweep.
      await sut.updateLibrariesV1([
        for (int i = 0; i < libraryCount; i++)
          SyncLibraryV1(
            id: 'sweep-lib-$i',
            name: 'Sweep Library $i',
            ownerId: foreignUserId,
            createdAt: DateTime(2024, 1, 1),
            updatedAt: DateTime(2024, 1, 1),
          ),
      ]);

      final base = DateTime(2024, 1, 1);
      SyncAssetV1 makeAsset(int libIdx, int assetIdx) {
        final flatIdx = libIdx * assetsPerLibrary + assetIdx;
        return SyncAssetV1(
          id: 'sweep-asset-$flatIdx',
          checksum: 'sweep-checksum-$flatIdx',
          originalFileName: 'sweep-$flatIdx.jpg',
          type: AssetTypeEnum.IMAGE,
          ownerId: foreignUserId,
          isFavorite: false,
          fileCreatedAt: base.subtract(Duration(minutes: flatIdx)),
          fileModifiedAt: base.subtract(Duration(minutes: flatIdx)),
          localDateTime: base.subtract(Duration(minutes: flatIdx)),
          visibility: AssetVisibility.timeline,
          width: 100,
          height: 100,
          deletedAt: null,
          duration: null,
          libraryId: 'sweep-lib-$libIdx',
          livePhotoVideoId: null,
          stackId: null,
          thumbhash: null,
          isEdited: false,
        );
      }

      // Batch-insert 100k assets.
      final insertStart = DateTime.now();
      await sut.updateLibraryAssetsV1([
        for (int l = 0; l < libraryCount; l++)
          for (int a = 0; a < assetsPerLibrary; a++) makeAsset(l, a),
      ]);
      final insertMs = DateTime.now().difference(insertStart).inMilliseconds;

      expect(await db.remoteAssetEntity.select().get(), hasLength(libraryCount * assetsPerLibrary));

      // Delete the first 100 libraries — 50k orphan assets must be swept.
      final sweepStart = DateTime.now();
      await sut.deleteLibrariesV1(
        [for (int i = 0; i < librariesToDelete; i++) SyncLibraryDeleteV1(libraryId: 'sweep-lib-$i')],
        currentUserId: userId,
      );
      final sweepMs = DateTime.now().difference(sweepStart).inMilliseconds;

      // 100 libraries gone, 100 remain.
      expect(await db.libraryEntity.select().get(), hasLength(libraryCount - librariesToDelete));
      // 50k assets gone, 50k remain.
      final remainingAssets = (await db.remoteAssetEntity.select().get()).length;
      expect(remainingAssets, (libraryCount - librariesToDelete) * assetsPerLibrary);

      // ignore: avoid_print
      print(
        '\n[scale-test] sweep · Insert ${libraryCount * assetsPerLibrary} in ${insertMs}ms · '
        'Sweep $librariesToDelete libraries (~${librariesToDelete * assetsPerLibrary} orphans) in ${sweepMs}ms',
      );

      // Sweep of 50k orphans across chunked DELETE ... IN (...) statements
      // should complete well under the bucket query target. Loose bound:
      // 30 seconds is well beyond any realistic production hit.
      expect(sweepMs, lessThan(30000), reason: 'sweep of 50k orphans should complete in seconds');
    },
  );
}

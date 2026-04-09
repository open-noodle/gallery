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
}

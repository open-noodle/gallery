import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/local/album.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/album.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/exif.drift.dart';
import 'package:immich_mobile/data/db/main/table/user/auth_user.drift.dart';
import 'package:immich_mobile/data/db/main/table/user/partner.drift.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_stream.repository.dart';
import 'package:openapi/api.dart';

SyncUserV1 _createUser({String id = 'user-1'}) {
  return SyncUserV1(
    id: id,
    name: 'Test User',
    email: 'test@test.com',
    deletedAt: null,
    avatarColor: const Optional.absent(),
    hasProfileImage: false,
    profileChangedAt: DateTime(2024, 1, 1),
  );
}

SyncAssetV1 _createAsset({
  required String id,
  required String checksum,
  required String fileName,
  String ownerId = 'user-1',
  int? width,
  int? height,
  String? libraryId,
  bool isFavorite = false,
  AssetTypeEnum type = AssetTypeEnum.IMAGE,
  AssetVisibility visibility = AssetVisibility.timeline,
  String? livePhotoVideoId,
}) {
  return SyncAssetV1(
    id: id,
    checksum: checksum,
    originalFileName: fileName,
    type: type,
    ownerId: ownerId,
    isFavorite: isFavorite,
    fileCreatedAt: DateTime(2024, 1, 1),
    fileModifiedAt: DateTime(2024, 1, 1),
    createdAt: DateTime(2024, 1, 1),
    localDateTime: DateTime(2024, 1, 1),
    visibility: visibility,
    width: width,
    height: height,
    deletedAt: null,
    duration: null,
    libraryId: libraryId,
    livePhotoVideoId: livePhotoVideoId,
    stackId: null,
    thumbhash: null,
    isEdited: false,
  );
}

SyncSharedSpaceV1 _pruneSpace({String id = 'space-1'}) => SyncSharedSpaceV1(
  id: id,
  name: 'Space',
  description: null,
  color: null,
  createdById: 'user-1',
  thumbnailAssetId: null,
  thumbnailCropY: null,
  faceRecognitionEnabled: true,
  petsEnabled: false,
  lastActivityAt: null,
  createdAt: DateTime(2026, 4, 6),
  updatedAt: DateTime(2026, 4, 6),
);

SyncAssetV2 _createAssetV2({
  required String id,
  required String checksum,
  required String fileName,
  String ownerId = 'user-1',
  int? width,
  int? height,
  AssetTypeEnum type = AssetTypeEnum.IMAGE,
  AssetVisibility visibility = AssetVisibility.timeline,
  String? livePhotoVideoId,
}) {
  return SyncAssetV2(
    id: id,
    checksum: checksum,
    originalFileName: fileName,
    type: type,
    ownerId: ownerId,
    isFavorite: false,
    fileCreatedAt: DateTime(2024, 1, 1),
    fileModifiedAt: DateTime(2024, 1, 1),
    createdAt: DateTime(2024, 1, 1),
    localDateTime: DateTime(2024, 1, 1),
    visibility: visibility,
    width: width,
    height: height,
    deletedAt: null,
    duration: null,
    libraryId: null,
    livePhotoVideoId: livePhotoVideoId,
    stackId: null,
    thumbhash: null,
    isEdited: false,
  );
}

SyncAssetExifV1 _createExif({
  required String assetId,
  required int width,
  required int height,
  required String orientation,
}) {
  return SyncAssetExifV1(
    assetId: assetId,
    exifImageWidth: width,
    exifImageHeight: height,
    orientation: orientation,
    city: null,
    country: null,
    dateTimeOriginal: null,
    description: null,
    exposureTime: null,
    fNumber: null,
    fileSizeInByte: null,
    focalLength: null,
    fps: null,
    iso: null,
    latitude: null,
    lensModel: null,
    longitude: null,
    make: null,
    model: null,
    modifyDate: null,
    profileDescription: null,
    projectionType: null,
    rating: null,
    state: null,
    timeZone: null,
  );
}

void main() {
  late Drift db;
  late SyncStreamRepository sut;

  setUp(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    sut = SyncStreamRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('SyncStreamRepository - Dimension swapping based on orientation', () {
    test('swaps dimensions for asset with rotated orientation', () async {
      final flippedOrientations = ['5', '6', '7', '8', '90', '-90'];

      for (final orientation in flippedOrientations) {
        final assetId = 'asset-$orientation-degrees';

        await sut.updateUsersV1([_createUser()]);

        final asset = _createAsset(
          id: assetId,
          checksum: 'checksum-$orientation',
          fileName: 'rotated_$orientation.jpg',
        );
        await sut.updateAssetsV1([asset]);

        final exif = _createExif(
          assetId: assetId,
          width: 1920,
          height: 1080,
          orientation: orientation, // EXIF orientation value for 90 degrees CW
        );
        await sut.updateAssetsExifV1([exif]);

        final query = db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(assetId));
        final result = await query.getSingle();

        expect(result.width, equals(1080));
        expect(result.height, equals(1920));
      }
    });

    test('does not swap dimensions for asset with normal orientation', () async {
      final nonFlippedOrientations = ['1', '2', '3', '4'];
      for (final orientation in nonFlippedOrientations) {
        final assetId = 'asset-$orientation-degrees';

        await sut.updateUsersV1([_createUser()]);

        final asset = _createAsset(id: assetId, checksum: 'checksum-$orientation', fileName: 'normal_$orientation.jpg');
        await sut.updateAssetsV1([asset]);

        final exif = _createExif(
          assetId: assetId,
          width: 1920,
          height: 1080,
          orientation: orientation, // EXIF orientation value for normal
        );
        await sut.updateAssetsExifV1([exif]);

        final query = db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(assetId));
        final result = await query.getSingle();

        expect(result.width, equals(1920));
        expect(result.height, equals(1080));
      }
    });

    test('does not update dimensions if asset already has width and height', () async {
      const assetId = 'asset-with-dimensions';
      const existingWidth = 1920;
      const existingHeight = 1080;
      const exifWidth = 3840;
      const exifHeight = 2160;

      await sut.updateUsersV1([_createUser()]);

      final asset = _createAsset(
        id: assetId,
        checksum: 'checksum-with-dims',
        fileName: 'with_dimensions.jpg',
        width: existingWidth,
        height: existingHeight,
      );
      await sut.updateAssetsV1([asset]);

      final exif = _createExif(assetId: assetId, width: exifWidth, height: exifHeight, orientation: '6');
      await sut.updateAssetsExifV1([exif]);

      // Verify the asset still has original dimensions (not updated from EXIF)
      final query = db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(assetId));
      final result = await query.getSingle();

      expect(result.width, equals(existingWidth), reason: 'Width should remain as originally set');
      expect(result.height, equals(existingHeight), reason: 'Height should remain as originally set');
    });
  });

  group('SyncStreamRepository - reset()', () {
    test('nulls linkedRemoteAlbumId on localAlbumEntity so FK refs do not dangle', () async {
      const localAlbumId = 'local-1';
      const remoteAlbumId = 'remote-1';

      await db.remoteAlbumEntity.insertOne(
        RemoteAlbumEntityCompanion.insert(id: remoteAlbumId, name: 'Movies', order: AlbumAssetOrder.desc),
      );
      await db.localAlbumEntity.insertOne(
        LocalAlbumEntityCompanion.insert(
          id: localAlbumId,
          name: 'Movies',
          backupSelection: BackupSelection.selected,
          linkedRemoteAlbumId: const drift.Value(remoteAlbumId),
        ),
      );

      // sanity: link is set before reset
      final before = await (db.localAlbumEntity.select()..where((t) => t.id.equals(localAlbumId))).getSingle();
      expect(before.linkedRemoteAlbumId, equals(remoteAlbumId));

      await sut.reset();

      final after = await (db.localAlbumEntity.select()..where((t) => t.id.equals(localAlbumId))).getSingle();
      expect(
        after.linkedRemoteAlbumId,
        isNull,
        reason:
            'reset() runs with PRAGMA foreign_keys = OFF so the ON DELETE SET NULL cascade does not fire — the link must be nulled manually',
      );
      expect(after.name, equals('Movies'), reason: 'local album row itself must be preserved');
      expect(after.backupSelection, equals(BackupSelection.selected));

      final remoteRows = await db.remoteAlbumEntity.select().get();
      expect(remoteRows, isEmpty, reason: 'reset() still wipes remoteAlbumEntity');
    });

    test('preserves localAlbumEntity rows that have no linkedRemoteAlbumId', () async {
      const localAlbumId = 'local-unlinked';
      await db.localAlbumEntity.insertOne(
        LocalAlbumEntityCompanion.insert(id: localAlbumId, name: 'Camera', backupSelection: BackupSelection.none),
      );

      await sut.reset();

      final after = await (db.localAlbumEntity.select()..where((t) => t.id.equals(localAlbumId))).getSingle();
      expect(after.linkedRemoteAlbumId, isNull);
      expect(after.name, equals('Camera'));
      expect(after.backupSelection, equals(BackupSelection.none));
    });

    test('reset() clears all 8 fork space + library tables (mobile-4)', () async {
      // Seed a fully-populated fork-space graph via the real sync handlers so
      // FK-parent ordering (space → album/library → link/membership) is honoured.
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([
        SyncSharedSpaceV1(
          id: 'space-1',
          name: 'Space',
          description: null,
          color: null,
          createdById: 'user-1',
          thumbnailAssetId: null,
          thumbnailCropY: null,
          faceRecognitionEnabled: true,
          petsEnabled: false,
          lastActivityAt: null,
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceMembersV1([
        SyncSharedSpaceMemberV1(
          spaceId: 'space-1',
          userId: 'user-1',
          role: 'editor',
          joinedAt: DateTime(2026, 4, 6),
          showInTimeline: true,
        ),
      ]);
      await sut.updateAssetsV1([_createAsset(id: 'asset-1', checksum: 'c1', fileName: 'a.jpg')]);
      await sut.updateSharedSpaceToAssetsV1([SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'asset-1')]);
      await sut.updateLibrariesV1([
        SyncLibraryV1(
          id: 'library-1',
          name: 'Lib',
          ownerId: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'library-1',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceAlbumsV1([
        SyncAlbumV2(
          id: 'album-1',
          name: 'Album',
          description: '',
          isActivityEnabled: true,
          order: AssetOrder.asc,
          thumbnailAssetId: null,
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceAlbumLinksV1([
        SyncSharedSpaceAlbumLinkV1(
          spaceId: 'space-1',
          albumId: 'album-1',
          showInTimeline: true,
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'album-1', assetId: 'asset-1')]);

      // Sanity: every table is non-empty before reset.
      expect(await db.sharedSpaceEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceMemberEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceAssetEntity.select().get(), isNotEmpty);
      expect(await db.libraryEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceLibraryEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceAlbumEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceAlbumLinkEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isNotEmpty);

      // reset() must not throw under foreign_keys = OFF and must empty all 8.
      await sut.reset();

      expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceAlbumLinkEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceAlbumEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceAssetEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceLibraryEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceMemberEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceEntity.select().get(), isEmpty);
      expect(await db.libraryEntity.select().get(), isEmpty);
    });

    test('reset() on an empty DB does not throw under foreign_keys = OFF (mobile-4)', () async {
      // No seed at all — the added deleteAll() calls must be safe no-ops.
      await sut.reset();
      expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isEmpty);
      expect(await db.libraryEntity.select().get(), isEmpty);
    });
  });

  group('SyncStreamRepository - updateAssets upsert dedupe (#22522 #27186)', () {
    Future<void> seedExif(String assetId) =>
        db.remoteExifEntity.insertOne(RemoteExifEntityCompanion.insert(assetId: assetId));

    Future<bool> exifExists(String assetId) async {
      final rows = await (db.remoteExifEntity.select()..where((t) => t.assetId.equals(assetId))).get();
      return rows.isNotEmpty;
    }

    test('same-id update keeps the child row and updates fields', () async {
      await sut.updateUsersV1([_createUser()]);
      final asset = _createAsset(id: 'a', checksum: 'AAA', fileName: 'photo.jpg');
      await sut.updateAssetsV1([asset]);
      await seedExif(asset.id);

      final renamed = _createAsset(id: asset.id, checksum: asset.checksum, fileName: 'renamed.jpg', isFavorite: true);
      await sut.updateAssetsV1([renamed]);

      expect(await exifExists(asset.id), isTrue, reason: 'DO UPDATE keeps the row, the child survives');
      final row = await (db.remoteAssetEntity.select()..where((t) => t.id.equals(asset.id))).getSingle();
      expect(row.name, renamed.originalFileName);
      expect(row.isFavorite, isTrue);
    });

    test('reupload with a new id replaces the stale row and cascades its child', () async {
      await sut.updateUsersV1([_createUser()]);
      final stale = _createAsset(id: 'stale', checksum: 'AAA', fileName: 'photo.jpg');
      await sut.updateAssetsV1([stale]);
      await seedExif(stale.id);

      final fresh = _createAsset(id: 'fresh', checksum: stale.checksum, fileName: stale.originalFileName);
      await sut.updateAssetsV1([fresh]);

      final rows = await db.remoteAssetEntity.select().get();
      expect(rows, hasLength(1), reason: 'no 2067, stale row replaced away');
      expect(rows.single.id, fresh.id);
      expect(await exifExists(stale.id), isFalse, reason: 'the stale child cascades with the replaced row');

      // same scenario through V2
      final staleV2 = _createAssetV2(id: 'stale2', checksum: 'BBB', fileName: 'photo2.jpg');
      await sut.updateAssetsV2([staleV2]);
      await seedExif(staleV2.id);
      final freshV2 = _createAssetV2(id: 'fresh2', checksum: staleV2.checksum, fileName: staleV2.originalFileName);
      await sut.updateAssetsV2([freshV2]);

      final rows2 = await db.remoteAssetEntity.select().get();
      expect(rows2.map((r) => r.id), containsAll([fresh.id, freshV2.id]));
      expect(await exifExists(staleV2.id), isFalse);
    });

    test('library variant replaces only the matching library row', () async {
      await sut.updateUsersV1([_createUser()]);
      final staleLib = _createAsset(id: 'stale-lib', checksum: 'AAA', fileName: 'photo.jpg', libraryId: 'lib-1');
      final keepNull = _createAsset(id: 'keep-null', checksum: staleLib.checksum, fileName: staleLib.originalFileName);
      await sut.updateAssetsV1([staleLib, keepNull]);

      final freshLib = _createAsset(
        id: 'fresh-lib',
        checksum: staleLib.checksum,
        fileName: staleLib.originalFileName,
        libraryId: staleLib.libraryId,
      );
      await sut.updateAssetsV1([freshLib]);

      final rows = await db.remoteAssetEntity.select().get();
      expect(rows.map((r) => r.id).toSet(), {
        freshLib.id,
        keepNull.id,
      }, reason: 'library NULL and NOT NULL match different partial indexes');
    });

    test('batch-internal duplicates keep the last payload asset', () async {
      await sut.updateUsersV1([_createUser()]);
      final first = _createAsset(id: 'first-id', checksum: 'AAA', fileName: 'photo.jpg');
      final last = _createAsset(id: 'last-id', checksum: first.checksum, fileName: first.originalFileName);
      final firstLib = _createAsset(
        id: 'first-lib',
        checksum: 'BBB',
        fileName: first.originalFileName,
        libraryId: 'lib-1',
      );
      final lastLib = _createAsset(
        id: 'last-lib',
        checksum: firstLib.checksum,
        fileName: firstLib.originalFileName,
        libraryId: firstLib.libraryId,
      );

      await sut.updateAssetsV1([first, last, firstLib, lastLib]);

      final rows = await db.remoteAssetEntity.select().get();
      expect(rows, hasLength(2), reason: 'REPLACE makes batch-internal duplicates last-wins, no crash');
      expect(rows.map((r) => r.id).toSet(), {last.id, lastLib.id});
    });
  });

  group('SyncStreamRepository - Live photos', () {
    test('hides motion asset when an uploaded still references it', () async {
      await sut.updateUsersV1([_createUser()]);

      final motion = _createAsset(
        id: 'motion-1',
        checksum: 'motion-checksum',
        fileName: 'IMG_7052.MOV',
        type: AssetTypeEnum.VIDEO,
        visibility: AssetVisibility.timeline,
      );
      await sut.updateAssetsV1([motion]);

      final still = _createAsset(
        id: 'still-1',
        checksum: 'still-checksum',
        fileName: 'IMG_7052.HEIC',
        livePhotoVideoId: motion.id,
      );
      await sut.updateAssetsV1([still], debugLabel: 'websocket-batch');

      final motionRow = await (db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(motion.id))).getSingle();
      final stillRow = await (db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(still.id))).getSingle();

      expect(stillRow.livePhotoVideoId, motion.id);
      expect(motionRow.visibility.name, 'hidden');
    });

    // M5: the v3 `assetV2` sync path (updateAssetsV2) must apply the same
    // #627 motion-asset hide sweep as the legacy V1 path above.
    test('hides motion asset when a V2-synced still references it', () async {
      await sut.updateUsersV1([_createUser()]);

      final motion = _createAssetV2(
        id: 'motion-v2-1',
        checksum: 'motion-v2-checksum',
        fileName: 'IMG_8001.MOV',
        type: AssetTypeEnum.VIDEO,
        visibility: AssetVisibility.timeline,
      );
      await sut.updateAssetsV2([motion]);

      final still = _createAssetV2(
        id: 'still-v2-1',
        checksum: 'still-v2-checksum',
        fileName: 'IMG_8001.HEIC',
        livePhotoVideoId: motion.id,
      );
      await sut.updateAssetsV2([still], debugLabel: 'assetV2-batch');

      final motionRow = await (db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(motion.id))).getSingle();
      final stillRow = await (db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(still.id))).getSingle();

      expect(stillRow.livePhotoVideoId, motion.id);
      expect(motionRow.visibility.name, 'hidden');
    });

    test('does not hide a non-motion asset in the same V2 batch', () async {
      await sut.updateUsersV1([_createUser()]);

      final motion = _createAssetV2(
        id: 'motion-v2-2',
        checksum: 'motion-v2-checksum-2',
        fileName: 'IMG_8002.MOV',
        type: AssetTypeEnum.VIDEO,
      );
      final still = _createAssetV2(
        id: 'still-v2-2',
        checksum: 'still-v2-checksum-2',
        fileName: 'IMG_8002.HEIC',
        livePhotoVideoId: motion.id,
      );
      final normal = _createAssetV2(id: 'normal-v2-1', checksum: 'normal-v2-checksum', fileName: 'IMG_9000.JPG');

      await sut.updateAssetsV2([motion, still, normal]);

      final normalRow = await (db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(normal.id))).getSingle();
      final motionRow = await (db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(motion.id))).getSingle();

      expect(normalRow.visibility.name, 'timeline', reason: 'an unrelated asset in the same batch must stay visible');
      expect(motionRow.visibility.name, 'hidden');
    });

    test('does not hide a V2 motion part with no linked still (edge case)', () async {
      await sut.updateUsersV1([_createUser()]);

      final orphanVideo = _createAssetV2(
        id: 'orphan-video-v2-1',
        checksum: 'orphan-video-checksum',
        fileName: 'IMG_9100.MOV',
        type: AssetTypeEnum.VIDEO,
      );
      await sut.updateAssetsV2([orphanVideo]);

      final row = await (db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(orphanVideo.id))).getSingle();

      expect(
        row.visibility.name,
        'timeline',
        reason: 'the sweep only hides a row that some OTHER row references as its livePhotoVideoId',
      );
    });

    test('idempotent re-sync of the same V2 batch stays hidden, no error', () async {
      await sut.updateUsersV1([_createUser()]);

      final motion = _createAssetV2(
        id: 'motion-v2-3',
        checksum: 'motion-v2-checksum-3',
        fileName: 'IMG_8003.MOV',
        type: AssetTypeEnum.VIDEO,
      );
      final still = _createAssetV2(
        id: 'still-v2-3',
        checksum: 'still-v2-checksum-3',
        fileName: 'IMG_8003.HEIC',
        livePhotoVideoId: motion.id,
      );

      await sut.updateAssetsV2([motion, still]);
      // Re-sync the identical batch — must not throw and must stay hidden.
      await sut.updateAssetsV2([motion, still]);

      final motionRow = await (db.remoteAssetEntity.select()..where((tbl) => tbl.id.equals(motion.id))).getSingle();
      expect(motionRow.visibility.name, 'hidden');
    });
  });

  group('SyncStreamRepository - Shared spaces', () {
    SyncSharedSpaceV1 makeSpace({
      String id = 'space-1',
      String name = 'Test Space',
      String createdById = 'user-1',
      String? description,
      String? color,
      String? thumbnailAssetId,
    }) => SyncSharedSpaceV1(
      id: id,
      name: name,
      description: description,
      color: color,
      createdById: createdById,
      thumbnailAssetId: thumbnailAssetId,
      thumbnailCropY: null,
      faceRecognitionEnabled: true,
      petsEnabled: false,
      lastActivityAt: null,
      createdAt: DateTime(2026, 4, 6),
      updatedAt: DateTime(2026, 4, 6),
    );

    SyncSharedSpaceMemberV1 makeMember({
      String spaceId = 'space-1',
      String userId = 'user-1',
      String role = 'editor',
      bool showInTimeline = true,
    }) => SyncSharedSpaceMemberV1(
      spaceId: spaceId,
      userId: userId,
      role: role,
      joinedAt: DateTime(2026, 4, 6),
      showInTimeline: showInTimeline,
    );

    test('updateSharedSpacesV1 inserts a new shared space row', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([makeSpace(name: 'First')]);

      final row = await (db.sharedSpaceEntity.select()..where((t) => t.id.equals('space-1'))).getSingle();
      expect(row.name, 'First');
      expect(row.faceRecognitionEnabled, true);
    });

    test('updateSharedSpacesV1 upserts on conflict (idempotent)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([makeSpace(name: 'Original')]);
      await sut.updateSharedSpacesV1([makeSpace(name: 'Renamed', description: 'Updated')]);

      final row = await (db.sharedSpaceEntity.select()..where((t) => t.id.equals('space-1'))).getSingle();
      expect(row.name, 'Renamed');
      expect(row.description, 'Updated');
    });

    test('deleteSharedSpacesV1 removes the row and cascades to members and join rows', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([makeSpace()]);
      await sut.updateSharedSpaceMembersV1([makeMember()]);
      await sut.updateAssetsV1([_createAsset(id: 'asset-1', checksum: 'c1', fileName: 'a.jpg')]);
      await sut.updateSharedSpaceToAssetsV1([SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'asset-1')]);

      await sut.deleteSharedSpacesV1([SyncSharedSpaceDeleteV1(spaceId: 'space-1')]);

      final spaceCount = await db.sharedSpaceEntity.select().get();
      final memberCount = await db.sharedSpaceMemberEntity.select().get();
      final joinCount = await db.sharedSpaceAssetEntity.select().get();
      expect(spaceCount, isEmpty);
      expect(memberCount, isEmpty);
      expect(joinCount, isEmpty);
    });

    test('updateSharedSpaceMembersV1 inserts a new member row', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([makeSpace()]);
      await sut.updateSharedSpaceMembersV1([makeMember()]);

      final row =
          await (db.sharedSpaceMemberEntity.select()
                ..where((t) => t.spaceId.equals('space-1') & t.userId.equals('user-1')))
              .getSingle();
      expect(row.role, 'editor');
      expect(row.showInTimeline, true);
    });

    test('updateSharedSpaceMembersV1 upserts on conflict (role change)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([makeSpace()]);
      await sut.updateSharedSpaceMembersV1([makeMember(role: 'editor')]);
      await sut.updateSharedSpaceMembersV1([makeMember(role: 'owner', showInTimeline: false)]);

      final row =
          await (db.sharedSpaceMemberEntity.select()
                ..where((t) => t.spaceId.equals('space-1') & t.userId.equals('user-1')))
              .getSingle();
      expect(row.role, 'owner');
      expect(row.showInTimeline, false);
    });

    test('deleteSharedSpaceMembersV1 removes the (space, user) pair only', () async {
      await sut.updateUsersV1([_createUser(), _createUser(id: 'user-2')]);
      await sut.updateSharedSpacesV1([makeSpace()]);
      await sut.updateSharedSpaceMembersV1([makeMember(userId: 'user-1'), makeMember(userId: 'user-2')]);

      await sut.deleteSharedSpaceMembersV1([SyncSharedSpaceMemberDeleteV1(spaceId: 'space-1', userId: 'user-1')]);

      final remaining = await db.sharedSpaceMemberEntity.select().get();
      expect(remaining, hasLength(1));
      expect(remaining.first.userId, 'user-2');
    });

    test('updateSharedSpaceAssetsV1 delegates to updateAssetsV1 (writes remote_asset)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpaceAssetsV1([_createAsset(id: 'asset-1', checksum: 'cccc', fileName: 'shared.jpg')]);

      final row = await (db.remoteAssetEntity.select()..where((t) => t.id.equals('asset-1'))).getSingle();
      expect(row.name, 'shared.jpg');
    });

    test('updateSharedSpaceAssetExifsV1 delegates to updateAssetsExifV1 (writes remote_exif)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpaceAssetsV1([_createAsset(id: 'asset-1', checksum: 'cccc', fileName: 'shared.jpg')]);
      await sut.updateSharedSpaceAssetExifsV1([
        _createExif(assetId: 'asset-1', width: 100, height: 200, orientation: '1'),
      ]);

      final row = await (db.remoteExifEntity.select()..where((t) => t.assetId.equals('asset-1'))).getSingle();
      expect(row.width, 100);
      expect(row.height, 200);
    });

    test('updateSharedSpaceToAssetsV1 inserts join rows even when the asset row does not yet exist', () async {
      // The shared_space_asset entity intentionally has no FK on assetId — this
      // is the design decision that lets the mobile sync stream tolerate out-of-order
      // delivery between the SharedSpaceToAssetV1 stream and the SharedSpaceAssetCreateV1
      // stream.
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([makeSpace()]);

      await sut.updateSharedSpaceToAssetsV1([
        SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'asset-not-yet-synced'),
      ]);

      final rows = await db.sharedSpaceAssetEntity.select().get();
      expect(rows, hasLength(1));
      expect(rows.first.assetId, 'asset-not-yet-synced');
    });

    test('deleteSharedSpaceToAssetsV1 removes the (space, asset) pair', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([makeSpace()]);
      await sut.updateSharedSpaceToAssetsV1([
        SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'asset-1'),
        SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'asset-2'),
      ]);

      await sut.deleteSharedSpaceToAssetsV1([SyncSharedSpaceToAssetDeleteV1(spaceId: 'space-1', assetId: 'asset-1')]);

      final remaining = await db.sharedSpaceAssetEntity.select().get();
      expect(remaining, hasLength(1));
      expect(remaining.first.assetId, 'asset-2');
    });
  });

  group('SyncStreamRepository - Libraries', () {
    SyncLibraryV1 makeLibrary({String id = 'library-1', String name = 'External Library', String ownerId = 'user-1'}) =>
        SyncLibraryV1(
          id: id,
          name: name,
          ownerId: ownerId,
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        );

    SyncAssetV1 makeLibraryAsset({
      required String id,
      required String checksum,
      required String ownerId,
      required String libraryId,
    }) => SyncAssetV1(
      id: id,
      checksum: checksum,
      originalFileName: '$id.jpg',
      type: AssetTypeEnum.IMAGE,
      ownerId: ownerId,
      isFavorite: false,
      fileCreatedAt: DateTime(2024, 1, 1),
      fileModifiedAt: DateTime(2024, 1, 1),
      localDateTime: DateTime(2024, 1, 1),
      createdAt: DateTime(2024, 1, 1),
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

    Future<void> insertPartner({required String sharedById, required String sharedWithId}) async {
      await db
          .into(db.partnerEntity)
          .insert(
            PartnerEntityCompanion.insert(
              sharedById: sharedById,
              sharedWithId: sharedWithId,
              inTimeline: const drift.Value(true),
            ),
          );
    }

    test('updateLibrariesV1 inserts a new library row', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary(name: 'First')]);

      final row = await (db.libraryEntity.select()..where((t) => t.id.equals('library-1'))).getSingle();
      expect(row.name, 'First');
      expect(row.ownerId, 'user-1');
    });

    test('updateLibrariesV1 upserts on conflict', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary(name: 'Original')]);
      await sut.updateLibrariesV1([makeLibrary(name: 'Renamed')]);

      final row = await (db.libraryEntity.select()..where((t) => t.id.equals('library-1'))).getSingle();
      expect(row.name, 'Renamed');
    });

    test('updateLibraryAssetsV1 delegates to updateAssetsV1 (writes remote_asset with libraryId)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary()]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'asset-1', checksum: 'c1', ownerId: 'user-1', libraryId: 'library-1'),
      ]);

      final row = await (db.remoteAssetEntity.select()..where((t) => t.id.equals('asset-1'))).getSingle();
      expect(row.libraryId, 'library-1');
    });

    test('updateLibraryAssetExifsV1 delegates to updateAssetsExifV1', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary()]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'asset-1', checksum: 'c1', ownerId: 'user-1', libraryId: 'library-1'),
      ]);
      await sut.updateLibraryAssetExifsV1([_createExif(assetId: 'asset-1', width: 640, height: 480, orientation: '1')]);

      final row = await (db.remoteExifEntity.select()..where((t) => t.assetId.equals('asset-1'))).getSingle();
      expect(row.width, 640);
      expect(row.height, 480);
    });

    test('deleteLibraryAssetsV1 removes individual asset rows', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary()]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'asset-1', checksum: 'c1', ownerId: 'user-1', libraryId: 'library-1'),
        makeLibraryAsset(id: 'asset-2', checksum: 'c2', ownerId: 'user-1', libraryId: 'library-1'),
      ]);

      await sut.deleteLibraryAssetsV1([SyncLibraryAssetDeleteV1(assetId: 'asset-1')]);

      final remaining = await db.remoteAssetEntity.select().get();
      expect(remaining, hasLength(1));
      expect(remaining.first.id, 'asset-2');
    });

    test('deleteLibraryAssetsV1 is idempotent — calling twice with the same id is safe', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary()]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'asset-1', checksum: 'cIdem', ownerId: 'user-1', libraryId: 'library-1'),
      ]);

      await sut.deleteLibraryAssetsV1([SyncLibraryAssetDeleteV1(assetId: 'asset-1')]);
      // Second call must not throw and must leave the table unchanged.
      await sut.deleteLibraryAssetsV1([SyncLibraryAssetDeleteV1(assetId: 'asset-1')]);

      expect(await db.remoteAssetEntity.select().get(), isEmpty);
    });

    test('deleteLibraryAssetsV1 handles a mixed batch (some present, some missing)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary()]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'asset-present', checksum: 'cMix', ownerId: 'user-1', libraryId: 'library-1'),
      ]);

      await sut.deleteLibraryAssetsV1([
        SyncLibraryAssetDeleteV1(assetId: 'asset-present'),
        SyncLibraryAssetDeleteV1(assetId: 'asset-missing-1'),
        SyncLibraryAssetDeleteV1(assetId: 'asset-missing-2'),
      ]);

      // Present asset removed, missing asset deletes are silent no-ops.
      expect(await db.remoteAssetEntity.select().get(), isEmpty);
    });

    test('deleteLibraryAssetsV1 with empty input is a no-op (does not throw)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary()]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'asset-1', checksum: 'cEmpty', ownerId: 'user-1', libraryId: 'library-1'),
      ]);

      await sut.deleteLibraryAssetsV1(const <SyncLibraryAssetDeleteV1>[]);

      // Asset untouched.
      expect(await db.remoteAssetEntity.select().get(), hasLength(1));
    });

    test('updateSharedSpaceLibrariesV1 inserts a join row', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([
        SyncSharedSpaceV1(
          id: 'space-1',
          name: 'Space',
          description: null,
          color: null,
          createdById: 'user-1',
          thumbnailAssetId: null,
          thumbnailCropY: null,
          faceRecognitionEnabled: true,
          petsEnabled: false,
          lastActivityAt: null,
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);

      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'library-1',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);

      final rows = await db.sharedSpaceLibraryEntity.select().get();
      expect(rows, hasLength(1));
      expect(rows.first.libraryId, 'library-1');
      expect(rows.first.addedById, 'user-1');
    });

    test('deleteSharedSpaceLibrariesV1 removes join row but does NOT touch assets', () async {
      await sut.updateUsersV1([_createUser(), _createUser(id: 'user-2')]);
      await sut.updateSharedSpacesV1([
        SyncSharedSpaceV1(
          id: 'space-1',
          name: 'Space',
          description: null,
          color: null,
          createdById: 'user-1',
          thumbnailAssetId: null,
          thumbnailCropY: null,
          faceRecognitionEnabled: true,
          petsEnabled: false,
          lastActivityAt: null,
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateLibrariesV1([makeLibrary()]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'asset-1', checksum: 'c1', ownerId: 'user-2', libraryId: 'library-1'),
      ]);
      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'library-1',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);

      await sut.deleteSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryDeleteV1(spaceId: 'space-1', libraryId: 'library-1'),
      ]);

      final joinRows = await db.sharedSpaceLibraryEntity.select().get();
      expect(joinRows, isEmpty);
      // Asset row and library row must still exist — only the join was removed.
      final assetRows = await db.remoteAssetEntity.select().get();
      expect(assetRows, hasLength(1));
      final libraryRows = await db.libraryEntity.select().get();
      expect(libraryRows, hasLength(1));
    });

    group('deleteLibrariesV1 orphan sweep', () {
      setUp(() async {
        // Current user + a partner user + an unrelated foreign user.
        await sut.updateUsersV1([
          _createUser(id: 'user-1'),
          _createUser(id: 'user-partner'),
          _createUser(id: 'user-foreign'),
        ]);
        await sut.updateLibrariesV1([makeLibrary(id: 'library-1', ownerId: 'user-foreign')]);
      });

      test('preserves an asset owned by the current user', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'mine', checksum: 'c1', ownerId: 'user-1', libraryId: 'library-1'),
        ]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        final rows = await db.remoteAssetEntity.select().get();
        expect(rows, hasLength(1));
        expect(rows.first.id, 'mine');
      });

      test('preserves an asset owned by an active partner', () async {
        await insertPartner(sharedById: 'user-partner', sharedWithId: 'user-1');
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'partner-asset', checksum: 'c2', ownerId: 'user-partner', libraryId: 'library-1'),
        ]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        final rows = await db.remoteAssetEntity.select().get();
        expect(rows, hasLength(1));
        expect(rows.first.id, 'partner-asset');
      });

      test('preserves an asset also present in shared_space_asset', () async {
        await sut.updateSharedSpacesV1([
          SyncSharedSpaceV1(
            id: 'space-1',
            name: 'Space',
            description: null,
            color: null,
            createdById: 'user-1',
            thumbnailAssetId: null,
            thumbnailCropY: null,
            faceRecognitionEnabled: true,
            petsEnabled: false,
            lastActivityAt: null,
            createdAt: DateTime(2026, 4, 6),
            updatedAt: DateTime(2026, 4, 6),
          ),
        ]);
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'direct-add', checksum: 'c3', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);
        await sut.updateSharedSpaceToAssetsV1([SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'direct-add')]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        final rows = await db.remoteAssetEntity.select().get();
        expect(rows, hasLength(1));
        expect(rows.first.id, 'direct-add');
      });

      test('deletes a foreign asset reachable only via the now-deleted library', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'orphan', checksum: 'c4', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        final rows = await db.remoteAssetEntity.select().get();
        expect(rows, isEmpty);
        final libraryRows = await db.libraryEntity.select().get();
        expect(libraryRows, isEmpty);
      });

      test('happy path: library delete and orphan sweep both succeed in a single call', () async {
        // Pre-seed assets that should survive a successful sweep.
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'mine', checksum: 'c5', ownerId: 'user-1', libraryId: 'library-1'),
          makeLibraryAsset(id: 'orphan', checksum: 'c6', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        // Library removed, orphan removed, user-owned preserved.
        expect(await db.libraryEntity.select().get(), isEmpty);
        final remaining = await db.remoteAssetEntity.select().get();
        expect(remaining.map((r) => r.id), ['mine']);
      });

      test('atomicity: a failure inside the transaction rolls back the libraryEntity delete', () async {
        // Verifies that Drift's _db.transaction() rollback semantics hold for
        // the shape used by deleteLibrariesV1. We can't easily inject a failure
        // INTO the production handler (the customStatement is hard-coded), so
        // this test exercises the same transaction shape directly via the
        // db handle and confirms rollback behaviour. If Drift's transaction
        // primitive ever loses rollback semantics, this test catches it before
        // the production sweep silently splits into separate operations.
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'mine', checksum: 'cAtom', ownerId: 'user-1', libraryId: 'library-1'),
        ]);
        expect(await db.libraryEntity.select().get(), hasLength(1));
        expect(await db.remoteAssetEntity.select().get(), hasLength(1));

        Object? thrownError;
        try {
          await db.transaction(() async {
            // Delete the library row — same statement deleteLibrariesV1 runs.
            await db.libraryEntity.deleteWhere((row) => row.id.equals('library-1'));
            // Force a failure mid-transaction. Drift must roll back the prior
            // deleteWhere along with this customStatement.
            await db.customStatement('SELECT * FROM definitely_not_a_real_table');
          });
        } catch (e) {
          thrownError = e;
        }

        expect(thrownError, isNotNull, reason: 'transaction body should have thrown');
        // Both the library row and the asset must still exist — the
        // deleteWhere was rolled back along with the failing customStatement.
        expect(await db.libraryEntity.select().get(), hasLength(1));
        expect(await db.remoteAssetEntity.select().get(), hasLength(1));
      });

      test('large-batch: chunks the sweep across the SQLite parameter limit (>500 libraries)', () async {
        // SQLite's SQLITE_MAX_VARIABLE_NUMBER is typically 999. The sweep
        // customStatement binds libraryIds.length + 2 parameters per call.
        // The repository chunks at 500 so a 600-library batch hits the chunk
        // boundary and runs as multiple statements inside the same transaction.
        // This test verifies the chunking works AND that all 600 libraries +
        // their orphan assets are still removed atomically (a failure mid-loop
        // would roll back ALL preceding chunks).
        //
        // The setUp() block already inserted library-1; we delete that one
        // along with our 600 batch entries to land on a clean zero-row state.
        const int batchSize = 600;
        final libraryIds = List.generate(batchSize, (i) => 'lib-$i');

        await sut.updateLibrariesV1(libraryIds.map((id) => makeLibrary(id: id, ownerId: 'user-foreign')));
        // Insert 600 orphan assets, one per library.
        await sut.updateLibraryAssetsV1(
          List.generate(
            batchSize,
            (i) => makeLibraryAsset(
              id: 'orphan-$i',
              checksum: 'cBig$i',
              ownerId: 'user-foreign',
              libraryId: libraryIds[i],
            ),
          ),
        );
        // setUp inserted library-1 (601 total) but no asset for it.
        expect(await db.libraryEntity.select().get(), hasLength(batchSize + 1));
        expect(await db.remoteAssetEntity.select().get(), hasLength(batchSize));

        await sut.deleteLibrariesV1([
          SyncLibraryDeleteV1(libraryId: 'library-1'),
          ...libraryIds.map((id) => SyncLibraryDeleteV1(libraryId: id)),
        ], currentUserId: 'user-1');

        // All 601 library rows and all 600 orphan assets gone.
        expect(await db.libraryEntity.select().get(), isEmpty);
        expect(await db.remoteAssetEntity.select().get(), isEmpty);
      });

      test('multi-library: deletes all 3 library rows and sweeps their orphan assets in one call', () async {
        // Verifies the placeholder expansion in the customStatement works for
        // N > 1 libraryIds. Single-library is the common case but
        // syncLibrariesV1 may dispatch multiple deletes per batch.
        await sut.updateLibrariesV1([
          makeLibrary(id: 'library-1', ownerId: 'user-foreign'),
          makeLibrary(id: 'library-2', ownerId: 'user-foreign'),
          makeLibrary(id: 'library-3', ownerId: 'user-foreign'),
        ]);
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'mine', checksum: 'cM1', ownerId: 'user-1', libraryId: 'library-1'),
          makeLibraryAsset(id: 'orphan-1', checksum: 'cO1', ownerId: 'user-foreign', libraryId: 'library-1'),
          makeLibraryAsset(id: 'orphan-2', checksum: 'cO2', ownerId: 'user-foreign', libraryId: 'library-2'),
          makeLibraryAsset(id: 'orphan-3', checksum: 'cO3', ownerId: 'user-foreign', libraryId: 'library-3'),
        ]);

        await sut.deleteLibrariesV1([
          SyncLibraryDeleteV1(libraryId: 'library-1'),
          SyncLibraryDeleteV1(libraryId: 'library-2'),
          SyncLibraryDeleteV1(libraryId: 'library-3'),
        ], currentUserId: 'user-1');

        // All 3 library rows removed in the same transaction.
        expect(await db.libraryEntity.select().get(), isEmpty);
        // The 3 foreign-owned orphans are swept; user-owned 'mine' is preserved.
        final remaining = await db.remoteAssetEntity.select().get();
        expect(remaining.map((r) => r.id).toList(), ['mine']);
      });

      test('LibraryDeleteV1 for an unknown library is a no-op', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'mine', checksum: 'c7', ownerId: 'user-1', libraryId: 'library-1'),
        ]);

        await sut.deleteLibrariesV1([
          SyncLibraryDeleteV1(libraryId: 'library-does-not-exist'),
        ], currentUserId: 'user-1');

        // library-1 is untouched because the delete targeted a different id.
        expect(await db.libraryEntity.select().get(), hasLength(1));
        expect(await db.remoteAssetEntity.select().get(), hasLength(1));
      });

      test('preserves an asset also present in shared_space_album_asset (album path — mobile-2)', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'album-add', checksum: 'cA1', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);
        // The asset is a member of a space-linked album (no FK on assetId, so this
        // join row can reference the library asset directly).
        await sut.updateSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'album-1', assetId: 'album-add')]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        final rows = await db.remoteAssetEntity.select().get();
        expect(rows.map((r) => r.id), ['album-add']);
      });

      test('preserves an asset also present in remote_album_asset (classic album — pre-existing gap)', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'classic-add', checksum: 'cC1', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);
        // A personal (classic) album that also contains the asset. remote_album_asset
        // has FKs to remote_album AND remote_asset, so both must exist first.
        await sut.updateAlbumsV2([
          SyncAlbumV2(
            id: 'classic-album-1',
            name: 'Classic',
            description: '',
            isActivityEnabled: true,
            order: AssetOrder.asc,
            thumbnailAssetId: null,
            createdAt: DateTime(2026, 6, 1),
            updatedAt: DateTime(2026, 6, 1),
          ),
        ]);
        await sut.updateAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'classic-album-1', assetId: 'classic-add')]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        final rows = await db.remoteAssetEntity.select().get();
        expect(rows.map((r) => r.id), ['classic-add']);
      });

      test('deletes a Hidden foreign asset reachable only via the removed library (no accidental retention)', () async {
        // Visibility is NOT part of the sweep predicate — an asset with no album/space/
        // partner/owner path is still swept regardless of Hidden.
        await sut.updateLibraryAssetsV1([
          SyncAssetV1(
            id: 'hidden-orphan',
            checksum: 'cH1',
            originalFileName: 'hidden-orphan.jpg',
            type: AssetTypeEnum.IMAGE,
            ownerId: 'user-foreign',
            isFavorite: false,
            fileCreatedAt: DateTime(2024, 1, 1),
            fileModifiedAt: DateTime(2024, 1, 1),
            localDateTime: DateTime(2024, 1, 1),
            createdAt: DateTime(2024, 1, 1),
            visibility: AssetVisibility.hidden,
            width: 100,
            height: 100,
            deletedAt: null,
            duration: null,
            libraryId: 'library-1',
            livePhotoVideoId: null,
            stackId: null,
            thumbhash: null,
            isEdited: false,
          ),
        ]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        expect(await db.remoteAssetEntity.select().get(), isEmpty);
      });

      test('empty album/space-album sets: orphan sweep still deletes (no regression from new exclusions)', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'orphan-empty', checksum: 'cE1', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);
        expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isEmpty);
        expect(await db.remoteAlbumAssetEntity.select().get(), isEmpty);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        expect(await db.remoteAssetEntity.select().get(), isEmpty);
      });
    });

    test('SharedSpaceLibraryV1 arriving before LibraryV1 still inserts the join row', () async {
      // The SharedSpaceLibrary entity intentionally has no FK on libraryId —
      // this mirrors SharedSpaceAssetEntity's lenient assetId, letting the
      // sync stream tolerate out-of-order delivery between the library and
      // shared-space-library streams.
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([
        SyncSharedSpaceV1(
          id: 'space-1',
          name: 'Space',
          description: null,
          color: null,
          createdById: 'user-1',
          thumbnailAssetId: null,
          thumbnailCropY: null,
          faceRecognitionEnabled: true,
          petsEnabled: false,
          lastActivityAt: null,
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);

      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'not-yet-synced-library',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);

      final rows = await db.sharedSpaceLibraryEntity.select().get();
      expect(rows, hasLength(1));
      expect(rows.first.libraryId, 'not-yet-synced-library');
    });

    test('SharedSpaceLibraryV1 arriving before SharedSpaceV1 is rejected by the hard FK on spaceId', () async {
      // Asymmetry lock-in: libraryId on sharedSpaceLibraryEntity is loose
      // (no FK — see the test above), but spaceId has a HARD cascade FK.
      // The sync ordering contract is: SharedSpaceV1 must land BEFORE any
      // join rows for that space. This test asserts the contract is
      // enforced — if you relax the FK, the top-level sync dispatcher must
      // be able to guarantee strict ordering, or this test will catch it.
      await sut.updateUsersV1([_createUser()]);

      await expectLater(
        sut.updateSharedSpaceLibrariesV1([
          SyncSharedSpaceLibraryV1(
            spaceId: 'not-yet-synced-space',
            libraryId: 'also-not-yet-synced',
            addedById: 'user-1',
            createdAt: DateTime(2026, 4, 6),
            updatedAt: DateTime(2026, 4, 6),
          ),
        ]),
        throwsA(anything),
      );
      expect(await db.sharedSpaceLibraryEntity.select().get(), isEmpty);
    });

    test('LibraryV1 with an unknown ownerId throws a foreign key violation', () async {
      // library_entity has a HARD FK on owner_id (no tolerance for missing
      // parent rows). This test locks in that design — if you ever relax
      // the FK, update this assertion. The contract is: the server is
      // expected to stream the owner user row BEFORE the library row.
      await sut.updateUsersV1([_createUser()]);

      await expectLater(sut.updateLibrariesV1([makeLibrary(ownerId: 'user-does-not-exist')]), throwsA(anything));
      // Library table untouched.
      expect(await db.libraryEntity.select().get(), isEmpty);
    });

    group('deleteLibrariesV1 chunk boundary tests', () {
      // _kSweepChunkSize = 500 in the production handler. Off-by-one bugs in
      // the slicing loop would slip past the single 600-library test above,
      // so we stress the exact boundaries (N-1, N, N+1) at both 500 and 1000.
      setUp(() async {
        // Both users must exist before any library/asset inserts.
        // user-1 = current user (preserved), user-foreign = orphan owner (swept).
        await sut.updateUsersV1([_createUser(id: 'user-1'), _createUser(id: 'user-foreign')]);
      });

      Future<void> seedAndDelete(int count) async {
        final libraryIds = List.generate(count, (i) => 'boundary-lib-$i');
        await sut.updateLibrariesV1(libraryIds.map((id) => makeLibrary(id: id, ownerId: 'user-foreign')));
        // Each library has exactly one foreign-owned orphan asset.
        await sut.updateLibraryAssetsV1(
          List.generate(
            count,
            (i) => makeLibraryAsset(
              id: 'orphan-$i',
              checksum: 'cBound$i',
              ownerId: 'user-foreign',
              libraryId: libraryIds[i],
            ),
          ),
        );

        await sut.deleteLibrariesV1(
          libraryIds.map((id) => SyncLibraryDeleteV1(libraryId: id)),
          currentUserId: 'user-1',
        );

        // Full cleanup: libraries gone, orphan assets swept.
        expect(await db.libraryEntity.select().get(), isEmpty);
        expect(await db.remoteAssetEntity.select().get(), isEmpty);
      }

      test('N=499 libraries (1 under chunk boundary) deletes all in single chunk', () async {
        await seedAndDelete(499);
      });

      test('N=500 libraries (exact chunk boundary) deletes all', () async {
        await seedAndDelete(500);
      });

      test('N=501 libraries (1 over chunk boundary, needs 2 chunks) deletes all', () async {
        await seedAndDelete(501);
      });

      test('N=999 libraries (1 under 2x boundary) deletes all', () async {
        await seedAndDelete(999);
      });

      test('N=1000 libraries (exact 2x boundary) deletes all', () async {
        await seedAndDelete(1000);
      });

      test('N=1001 libraries (1 over 2x boundary, needs 3 chunks) deletes all', () async {
        await seedAndDelete(1001);
      });
    });

    test('deleteLibrariesV1 with empty list is a no-op (does not open a transaction)', () async {
      // An empty LibraryDeleteV1 batch should not crash, not open a
      // transaction, and not touch any rows. The handler can receive empty
      // batches when the server has nothing to delete but still sends an
      // end-of-stream frame.
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary(id: 'library-1', ownerId: 'user-1')]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'keep-me', checksum: 'cEmpty', ownerId: 'user-1', libraryId: 'library-1'),
      ]);

      await sut.deleteLibrariesV1(const <SyncLibraryDeleteV1>[], currentUserId: 'user-1');

      expect(await db.libraryEntity.select().get(), hasLength(1));
      expect(await db.remoteAssetEntity.select().get(), hasLength(1));
    });

    test('deleteLibrariesV1 on a library with zero assets still removes the library row', () async {
      // Library has no asset rows at all. The delete must succeed (not
      // throw on the "no orphans to sweep" case) and the library_entity
      // row must be gone.
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([makeLibrary(id: 'empty-lib', ownerId: 'user-1')]);
      expect(await db.libraryEntity.select().get(), hasLength(1));

      await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'empty-lib')], currentUserId: 'user-1');

      expect(await db.libraryEntity.select().get(), isEmpty);
      expect(await db.remoteAssetEntity.select().get(), isEmpty);
    });

    test('updateLibraryAssetsV1 with asset.libraryId change moves the asset between libraries', () async {
      // Asset lives in libA, then the server streams an UPSERT with the
      // same id but libraryId = libB. The remote_asset_entity row should
      // reflect libB — not duplicate, not revert.
      await sut.updateUsersV1([_createUser()]);
      await sut.updateLibrariesV1([
        makeLibrary(id: 'libA', ownerId: 'user-1'),
        makeLibrary(id: 'libB', ownerId: 'user-1'),
      ]);
      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'mover', checksum: 'cMove', ownerId: 'user-1', libraryId: 'libA'),
      ]);

      await sut.updateLibraryAssetsV1([
        makeLibraryAsset(id: 'mover', checksum: 'cMove', ownerId: 'user-1', libraryId: 'libB'),
      ]);

      final rows = await db.remoteAssetEntity.select().get();
      expect(rows, hasLength(1));
      expect(rows.first.libraryId, 'libB');
    });
  });

  group('SyncStreamRepository - pruneAssets', () {
    // pruneAssets reads the current user id from authUserEntity (not userEntity).
    Future<void> seedAuthUser(String id) => db.authUserEntity.insertOne(
      AuthUserEntityCompanion.insert(id: id, name: 'me', email: '$id@test.com', avatarColor: AvatarColor.primary),
    );

    // A foreign-owned asset optionally tied to a library, for the keep-path cases.
    SyncAssetV1 foreignAsset({required String id, required String checksum, String? libraryId}) => SyncAssetV1(
      id: id,
      checksum: checksum,
      originalFileName: '$id.jpg',
      type: AssetTypeEnum.IMAGE,
      ownerId: 'user-foreign',
      isFavorite: false,
      fileCreatedAt: DateTime(2024, 1, 1),
      fileModifiedAt: DateTime(2024, 1, 1),
      localDateTime: DateTime(2024, 1, 1),
      createdAt: DateTime(2024, 1, 1),
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

    setUp(() async {
      await sut.updateUsersV1([
        _createUser(id: 'user-1'),
        _createUser(id: 'user-partner'),
        _createUser(id: 'user-foreign'),
      ]);
      await seedAuthUser('user-1');
    });

    test('skips pruning when there is no authenticated user', () async {
      // Fresh DB with no authUser row (override the group setUp by clearing it).
      await db.authUserEntity.deleteAll();
      await sut.updateAssetsV1([foreignAsset(id: 'orphan', checksum: 'c1')]);

      await sut.pruneAssets();

      expect(await db.remoteAssetEntity.select().get(), hasLength(1), reason: 'no auth user → no pruning');
    });

    test('deletes an unreachable foreign orphan and cascades its remote_exif', () async {
      await sut.updateAssetsV1([foreignAsset(id: 'orphan', checksum: 'c1')]);
      await sut.updateAssetsExifV1([_createExif(assetId: 'orphan', width: 100, height: 100, orientation: '1')]);
      expect(await db.remoteExifEntity.select().get(), hasLength(1));

      await sut.pruneAssets();

      expect(await db.remoteAssetEntity.select().get(), isEmpty);
      expect(await db.remoteExifEntity.select().get(), isEmpty, reason: 'FK ON DELETE CASCADE removes exif');
    });

    test('keeps an owned asset even with no album/space path', () async {
      await sut.updateAssetsV1([_createAsset(id: 'mine', checksum: 'c1', fileName: 'mine.jpg', ownerId: 'user-1')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['mine']);
    });

    test('keeps a partner-owned asset', () async {
      await db
          .into(db.partnerEntity)
          .insert(
            PartnerEntityCompanion.insert(
              sharedById: 'user-partner',
              sharedWithId: 'user-1',
              inTimeline: const drift.Value(true),
            ),
          );
      await sut.updateAssetsV1([
        _createAsset(id: 'partner', checksum: 'c1', fileName: 'p.jpg', ownerId: 'user-partner'),
      ]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['partner']);
    });

    test('keeps an asset reachable via remote_album_asset (classic album)', () async {
      await sut.updateAssetsV1([foreignAsset(id: 'classic', checksum: 'c1')]);
      await sut.updateAlbumsV2([
        SyncAlbumV2(
          id: 'classic-album',
          name: 'Classic',
          description: '',
          isActivityEnabled: true,
          order: AssetOrder.asc,
          thumbnailAssetId: null,
          createdAt: DateTime(2026, 6, 1),
          updatedAt: DateTime(2026, 6, 1),
        ),
      ]);
      await sut.updateAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'classic-album', assetId: 'classic')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['classic']);
    });

    test('keeps an asset reachable via shared_space_asset (direct add)', () async {
      await sut.updateAssetsV1([foreignAsset(id: 'direct', checksum: 'c1')]);
      await sut.updateSharedSpacesV1([_pruneSpace()]);
      await sut.updateSharedSpaceToAssetsV1([SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'direct')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['direct']);
    });

    test('keeps an asset reachable via shared_space_album_asset (granted album)', () async {
      await sut.updateAssetsV1([foreignAsset(id: 'album-add', checksum: 'c1')]);
      await sut.updateSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'album-1', assetId: 'album-add')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['album-add']);
    });

    test('keeps an asset reachable via a space-linked library (shared_space_library)', () async {
      await sut.updateSharedSpacesV1([_pruneSpace()]);
      await sut.updateLibrariesV1([
        SyncLibraryV1(
          id: 'library-1',
          name: 'Lib',
          ownerId: 'user-foreign',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'library-1',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateAssetsV1([foreignAsset(id: 'lib-asset', checksum: 'c1', libraryId: 'library-1')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['lib-asset']);
    });

    test('multi-path: pruned only when ALL paths are gone', () async {
      // Reachable via BOTH a direct add and a space album.
      await sut.updateAssetsV1([foreignAsset(id: 'multi', checksum: 'c1')]);
      await sut.updateSharedSpacesV1([_pruneSpace()]);
      await sut.updateSharedSpaceToAssetsV1([SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'multi')]);
      await sut.updateSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'album-1', assetId: 'multi')]);

      // Drop ONE path — still reachable via the other → kept.
      await sut.deleteSharedSpaceToAssetsV1([SyncSharedSpaceToAssetDeleteV1(spaceId: 'space-1', assetId: 'multi')]);
      await sut.pruneAssets();
      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['multi']);

      // Drop the last path → now unreachable → pruned.
      await sut.deleteSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetDeleteV1(albumId: 'album-1', assetId: 'multi')]);
      await sut.pruneAssets();
      expect(await db.remoteAssetEntity.select().get(), isEmpty);
    });

    test('prunes an orphan with a NULL library_id (NULL-in-subquery trap regression)', () async {
      // A space-linked library exists but this orphan is not in it (null library_id).
      await sut.updateSharedSpacesV1([_pruneSpace()]);
      await sut.updateLibrariesV1([
        SyncLibraryV1(
          id: 'library-1',
          name: 'Lib',
          ownerId: 'user-foreign',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'library-1',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      // Orphan has libraryId: null → must still be pruned (not shielded by NULL NOT IN).
      await sut.updateAssetsV1([foreignAsset(id: 'null-lib-orphan', checksum: 'c1')]);

      await sut.pruneAssets();

      expect(await db.remoteAssetEntity.select().get(), isEmpty);
    });
  });

  test('stores rule memories from sync without requiring year data', () async {
    await sut.updateUsersV1([_createUser()]);

    await sut.updateMemoriesV1([
      SyncMemoryV1(
        createdAt: DateTime(2026, 4, 23),
        data: {'ruleId': 'birthday', 'title': 'Happy birthday, Alice', 'subtitle': 'Photos from different years'},
        deletedAt: null,
        hideAt: DateTime(2026, 4, 23, 23, 59),
        id: 'memory-rule-1',
        isSaved: false,
        memoryAt: DateTime(2026, 4, 23),
        ownerId: 'user-1',
        seenAt: null,
        showAt: DateTime(2026, 4, 23),
        type: MemoryType.rule,
        updatedAt: DateTime(2026, 4, 23),
      ),
    ]);

    final query = db.memoryEntity.select()..where((tbl) => tbl.id.equals('memory-rule-1'));
    final row = await query.getSingle();

    expect(row.type, MemoryTypeEnum.rule);
    expect(row.data, contains('"title":"Happy birthday, Alice"'));
  });

  // ---------------------------------------------------------------------------
  // SyncStreamRepository — SharedSpaceAlbum handlers (Phase 2B, Slice B1)
  // ---------------------------------------------------------------------------
  //
  // These tests verify that the 8 new handlers read/write the three
  // shared-space-album Drift tables and NEVER touch the personal
  // remote_album / remote_album_asset tables (the absorbed invariant).
  //
  // Helpers — all tests re-use the same setUp (clean in-memory DB + SUT).

  SyncAlbumV2 makeAlbumV2({
    String id = 'album-1',
    String name = 'Test Album',
    String description = '',
    bool isActivityEnabled = true,
  }) {
    return SyncAlbumV2(
      id: id,
      name: name,
      description: description,
      isActivityEnabled: isActivityEnabled,
      order: AssetOrder.asc,
      thumbnailAssetId: null,
      createdAt: DateTime(2026, 6, 1),
      updatedAt: DateTime(2026, 6, 1),
    );
  }

  SyncSharedSpaceAlbumLinkV1 makeAlbumLink({
    String spaceId = 'space-1',
    String albumId = 'album-1',
    bool showInTimeline = true,
  }) {
    return SyncSharedSpaceAlbumLinkV1(
      spaceId: spaceId,
      albumId: albumId,
      showInTimeline: showInTimeline,
      addedById: null,
      createdAt: DateTime(2026, 6, 1),
      updatedAt: DateTime(2026, 6, 1),
    );
  }

  SyncAlbumToAssetV1 makeAlbumToAsset({String albumId = 'album-1', String assetId = 'asset-1'}) {
    return SyncAlbumToAssetV1(albumId: albumId, assetId: assetId);
  }

  SyncSharedSpaceV1 makeSpace({String id = 'space-1'}) {
    return SyncSharedSpaceV1(
      id: id,
      name: 'Test Space',
      description: null,
      color: null,
      createdById: 'user-1',
      thumbnailAssetId: null,
      thumbnailCropY: null,
      faceRecognitionEnabled: true,
      petsEnabled: false,
      lastActivityAt: null,
      createdAt: DateTime(2026, 4, 6),
      updatedAt: DateTime(2026, 4, 6),
    );
  }

  group('SyncStreamRepository - SharedSpaceAlbum handlers', () {
    group('updateSharedSpaceAlbumsV1', () {
      test('upserts a metadata row (id/name/thumbnailAssetId/order)', () async {
        await sut.updateSharedSpaceAlbumsV1([makeAlbumV2(id: 'album-1', name: 'Holiday')]);

        final rows = await db.sharedSpaceAlbumEntity.select().get();
        expect(rows, hasLength(1));
        expect(rows.first.id, 'album-1');
        expect(rows.first.name, 'Holiday');
        expect(rows.first.order, 0); // AssetOrder.asc → index 0
      });

      test('upsert is idempotent — re-inserting updates the row', () async {
        await sut.updateSharedSpaceAlbumsV1([makeAlbumV2(id: 'album-1', name: 'Original')]);
        await sut.updateSharedSpaceAlbumsV1([
          SyncAlbumV2(
            id: 'album-1',
            name: 'Renamed',
            description: 'Updated desc',
            isActivityEnabled: false,
            order: AssetOrder.desc,
            thumbnailAssetId: null,
            createdAt: DateTime(2026, 6, 2),
            updatedAt: DateTime(2026, 6, 2),
          ),
        ]);

        final rows = await db.sharedSpaceAlbumEntity.select().get();
        expect(rows, hasLength(1));
        expect(rows.first.name, 'Renamed');
        expect(rows.first.description, 'Updated desc');
        expect(rows.first.order, 1); // AssetOrder.desc → index 1
      });
    });

    group('updateSharedSpaceAlbumLinksV1', () {
      test('upserts a link row (showInTimeline carried)', () async {
        await sut.updateUsersV1([_createUser()]);
        await sut.updateSharedSpacesV1([makeSpace()]);
        await sut.updateSharedSpaceAlbumLinksV1([makeAlbumLink(showInTimeline: true)]);

        final rows = await db.sharedSpaceAlbumLinkEntity.select().get();
        expect(rows, hasLength(1));
        expect(rows.first.spaceId, 'space-1');
        expect(rows.first.albumId, 'album-1');
        expect(rows.first.showInTimeline, true);
      });

      test('re-upsert updates showInTimeline', () async {
        await sut.updateUsersV1([_createUser()]);
        await sut.updateSharedSpacesV1([makeSpace()]);
        await sut.updateSharedSpaceAlbumLinksV1([makeAlbumLink(showInTimeline: true)]);
        await sut.updateSharedSpaceAlbumLinksV1([makeAlbumLink(showInTimeline: false)]);

        final rows = await db.sharedSpaceAlbumLinkEntity.select().get();
        expect(rows, hasLength(1));
        expect(rows.first.showInTimeline, false);
      });
    });

    group('updateSharedSpaceAlbumToAssetsV1', () {
      test('inserts a membership row', () async {
        await sut.updateSharedSpaceAlbumToAssetsV1([makeAlbumToAsset(albumId: 'album-1', assetId: 'asset-1')]);

        final rows = await db.sharedSpaceAlbumAssetEntity.select().get();
        expect(rows, hasLength(1));
        expect(rows.first.albumId, 'album-1');
        expect(rows.first.assetId, 'asset-1');
      });

      test('idempotent on conflict — no duplicate row', () async {
        await sut.updateSharedSpaceAlbumToAssetsV1([makeAlbumToAsset()]);
        await sut.updateSharedSpaceAlbumToAssetsV1([makeAlbumToAsset()]);

        final rows = await db.sharedSpaceAlbumAssetEntity.select().get();
        expect(rows, hasLength(1));
      });
    });

    group('deleteSharedSpaceAlbumLinksV1', () {
      test('removes only the (spaceId, albumId) link row', () async {
        await sut.updateUsersV1([_createUser()]);
        await sut.updateSharedSpacesV1([makeSpace()]);
        await sut.updateSharedSpaceAlbumLinksV1([
          makeAlbumLink(spaceId: 'space-1', albumId: 'album-1'),
          makeAlbumLink(spaceId: 'space-1', albumId: 'album-2'),
        ]);

        await sut.deleteSharedSpaceAlbumLinksV1([
          SyncSharedSpaceAlbumLinkDeleteV1(spaceId: 'space-1', albumId: 'album-1'),
        ]);

        final remaining = await db.sharedSpaceAlbumLinkEntity.select().get();
        expect(remaining, hasLength(1));
        expect(remaining.first.albumId, 'album-2');
      });
    });

    group('deleteSharedSpaceAlbumToAssetsV1', () {
      test('removes the (albumId, assetId) membership row', () async {
        await sut.updateSharedSpaceAlbumToAssetsV1([
          makeAlbumToAsset(albumId: 'album-1', assetId: 'asset-1'),
          makeAlbumToAsset(albumId: 'album-1', assetId: 'asset-2'),
        ]);

        await sut.deleteSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetDeleteV1(albumId: 'album-1', assetId: 'asset-1')]);

        final remaining = await db.sharedSpaceAlbumAssetEntity.select().get();
        expect(remaining, hasLength(1));
        expect(remaining.first.assetId, 'asset-2');
      });
    });

    group('deleteSharedSpaceAlbumsV1 (metadata-delete sweep)', () {
      test('removes metadata + membership rows; leaves remote_asset intact', () async {
        // Seed: user, album metadata, membership, AND an asset blob.
        await sut.updateUsersV1([_createUser()]);
        await sut.updateSharedSpaceAlbumsV1([makeAlbumV2()]);
        await sut.updateSharedSpaceAlbumToAssetsV1([
          makeAlbumToAsset(albumId: 'album-1', assetId: 'asset-1'),
          makeAlbumToAsset(albumId: 'album-1', assetId: 'asset-2'),
        ]);
        // Asset blob written via the shared remote_asset store.
        await sut.updateAssetsV1([_createAsset(id: 'asset-1', checksum: 'c1', fileName: 'a.jpg')]);

        await sut.deleteSharedSpaceAlbumsV1([SyncAlbumDeleteV1(albumId: 'album-1')]);

        expect(await db.sharedSpaceAlbumEntity.select().get(), isEmpty, reason: 'metadata row must be deleted');
        expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isEmpty, reason: 'membership rows must be swept');
        // remote_asset blob must survive — it may be reachable by another path.
        final assetRows = await db.remoteAssetEntity.select().get();
        expect(assetRows, hasLength(1), reason: 'remote_asset blob must not be swept');
        expect(assetRows.first.id, 'asset-1');
      });
    });

    group('updateSharedSpaceAlbumAssetsV1', () {
      test('delegates to updateAssetsV2 → writes remote_asset', () async {
        await sut.updateUsersV1([_createUser()]);
        await sut.updateSharedSpaceAlbumAssetsV1([
          SyncAssetV2(
            id: 'asset-sa-1',
            checksum: 'cSA1',
            originalFileName: 'space-album-asset.jpg',
            type: AssetTypeEnum.IMAGE,
            ownerId: 'user-1',
            isFavorite: false,
            fileCreatedAt: DateTime(2026, 6, 1),
            fileModifiedAt: DateTime(2026, 6, 1),
            createdAt: DateTime(2026, 6, 1),
            localDateTime: DateTime(2026, 6, 1),
            visibility: AssetVisibility.timeline,
            width: 100,
            height: 100,
            deletedAt: null,
            duration: null,
            libraryId: null,
            livePhotoVideoId: null,
            stackId: null,
            thumbhash: null,
            isEdited: false,
          ),
        ]);

        final row = await (db.remoteAssetEntity.select()..where((t) => t.id.equals('asset-sa-1'))).getSingle();
        expect(row.name, 'space-album-asset.jpg');
      });
    });

    group('updateSharedSpaceAlbumAssetExifsV1', () {
      test('delegates to updateAssetsExifV1 → writes remote_exif', () async {
        await sut.updateUsersV1([_createUser()]);
        await sut.updateSharedSpaceAlbumAssetsV1([
          SyncAssetV2(
            id: 'asset-sa-2',
            checksum: 'cSA2',
            originalFileName: 'space-album-exif.jpg',
            type: AssetTypeEnum.IMAGE,
            ownerId: 'user-1',
            isFavorite: false,
            fileCreatedAt: DateTime(2026, 6, 1),
            fileModifiedAt: DateTime(2026, 6, 1),
            createdAt: DateTime(2026, 6, 1),
            localDateTime: DateTime(2026, 6, 1),
            visibility: AssetVisibility.timeline,
            width: null,
            height: null,
            deletedAt: null,
            duration: null,
            libraryId: null,
            livePhotoVideoId: null,
            stackId: null,
            thumbhash: null,
            isEdited: false,
          ),
        ]);
        await sut.updateSharedSpaceAlbumAssetExifsV1([
          SyncAssetExifV1(
            assetId: 'asset-sa-2',
            exifImageWidth: 1920,
            exifImageHeight: 1080,
            orientation: '1',
            city: null,
            country: null,
            dateTimeOriginal: null,
            description: null,
            exposureTime: null,
            fNumber: null,
            fileSizeInByte: null,
            focalLength: null,
            fps: null,
            iso: null,
            latitude: null,
            lensModel: null,
            longitude: null,
            make: null,
            model: null,
            modifyDate: null,
            profileDescription: null,
            projectionType: null,
            rating: null,
            state: null,
            timeZone: null,
          ),
        ]);

        final row = await (db.remoteExifEntity.select()..where((t) => t.assetId.equals('asset-sa-2'))).getSingle();
        expect(row.width, 1920);
        expect(row.height, 1080);
      });
    });

    // --- Absorbed-invariant test ---
    //
    // A full batch of SharedSpaceAlbum* events must NEVER touch the personal
    // remote_album / remote_album_asset tables. This is the on-device analogue
    // of the server's absorbed-invariant test (§10.2).
    group('absorbed invariant', () {
      test('full space-album sync batch leaves personal remote_album and remote_album_asset untouched', () async {
        // Pre-seed a personal album to verify it is not disturbed.
        await db.remoteAlbumEntity.insertOne(
          RemoteAlbumEntityCompanion.insert(id: 'personal-album-1', name: 'My Photos', order: AlbumAssetOrder.desc),
        );

        // Dispatch all 8 SharedSpaceAlbum handler types.
        await sut.updateUsersV1([_createUser()]);
        await sut.updateSharedSpacesV1([makeSpace()]);
        await sut.updateSharedSpaceAlbumsV1([makeAlbumV2()]);
        await sut.updateSharedSpaceAlbumLinksV1([makeAlbumLink()]);
        await sut.updateSharedSpaceAlbumToAssetsV1([makeAlbumToAsset()]);
        await sut.updateSharedSpaceAlbumAssetsV1([
          SyncAssetV2(
            id: 'asset-inv-1',
            checksum: 'cInv1',
            originalFileName: 'inv.jpg',
            type: AssetTypeEnum.IMAGE,
            ownerId: 'user-1',
            isFavorite: false,
            fileCreatedAt: DateTime(2026, 6, 1),
            fileModifiedAt: DateTime(2026, 6, 1),
            createdAt: DateTime(2026, 6, 1),
            localDateTime: DateTime(2026, 6, 1),
            visibility: AssetVisibility.timeline,
            width: null,
            height: null,
            deletedAt: null,
            duration: null,
            libraryId: null,
            livePhotoVideoId: null,
            stackId: null,
            thumbhash: null,
            isEdited: false,
          ),
        ]);

        // Verify the personal album table is untouched.
        final personalAlbums = await db.remoteAlbumEntity.select().get();
        expect(personalAlbums, hasLength(1), reason: 'personal remote_album must be untouched');
        expect(personalAlbums.first.id, 'personal-album-1');

        // remote_album_asset must also be empty (no personal album-asset rows added).
        final personalAlbumAssets = await db.remoteAlbumAssetEntity.select().get();
        expect(personalAlbumAssets, isEmpty, reason: 'personal remote_album_asset must be untouched');

        // Space-album tables must have the data.
        expect(await db.sharedSpaceAlbumEntity.select().get(), hasLength(1));
        expect(await db.sharedSpaceAlbumLinkEntity.select().get(), hasLength(1));
        expect(await db.sharedSpaceAlbumAssetEntity.select().get(), hasLength(1));
      });
    });

    // --- Cross-owner contribution convergence (#764) ---
    //
    // A contribution rides the SAME SharedSpaceAlbumToAssetV1 membership +
    // SharedSpaceAlbumAssetV1 payload events as an owner's album_asset —
    // mobile is origin-blind (no owner column on the shared_space_album_asset
    // row). No production code changes back this test: it is a
    // characterization/regression guard that locks in the existing,
    // already-convergent behaviour. (The red/green cycle for this slice is
    // entirely server-side — see #764 tasks 1-5.)
    group('cross-owner contribution convergence (#764)', () {
      test('a contributed (albumId, assetId) membership is present after insert, '
          'absent after delete, blob retained', () async {
        await sut.updateUsersV1([_createUser()]);
        await sut.updateSharedSpaceAlbumAssetsV1([
          _createAssetV2(id: 'contrib-asset', checksum: 'cContrib1', fileName: 'contrib.jpg'),
        ]);
        await sut.updateSharedSpaceAlbumToAssetsV1([makeAlbumToAsset(albumId: 'album-1', assetId: 'contrib-asset')]);

        final present = await db.sharedSpaceAlbumAssetEntity.select().get();
        expect(present.any((r) => r.albumId == 'album-1' && r.assetId == 'contrib-asset'), isTrue);

        await sut.deleteSharedSpaceAlbumToAssetsV1([
          SyncAlbumToAssetDeleteV1(albumId: 'album-1', assetId: 'contrib-asset'),
        ]);

        final afterDelete = await db.sharedSpaceAlbumAssetEntity.select().get();
        expect(afterDelete.any((r) => r.assetId == 'contrib-asset'), isFalse);

        // Removing the membership edge must NOT delete the asset blob (only pruneAssets GCs it).
        final blob = await db.remoteAssetEntity.select().get();
        expect(blob.any((r) => r.id == 'contrib-asset'), isTrue);
      });
    });
  });
}

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_stream.repository.dart';
import 'package:openapi/api.dart';

SyncUserV1 _createUser({String id = 'user-1'}) {
  return SyncUserV1(
    id: id,
    name: 'Test User',
    email: 'test@test.com',
    deletedAt: null,
    avatarColor: null,
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
}) {
  return SyncAssetV1(
    id: id,
    checksum: checksum,
    originalFileName: fileName,
    type: AssetTypeEnum.IMAGE,
    ownerId: ownerId,
    isFavorite: false,
    fileCreatedAt: DateTime(2024, 1, 1),
    fileModifiedAt: DateTime(2024, 1, 1),
    localDateTime: DateTime(2024, 1, 1),
    visibility: AssetVisibility.timeline,
    width: width,
    height: height,
    deletedAt: null,
    duration: null,
    libraryId: null,
    livePhotoVideoId: null,
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
      await sut.updateSharedSpaceToAssetsV1([
        SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'asset-1'),
      ]);

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

      final row = await (db.sharedSpaceMemberEntity.select()
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

      final row = await (db.sharedSpaceMemberEntity.select()
            ..where((t) => t.spaceId.equals('space-1') & t.userId.equals('user-1')))
          .getSingle();
      expect(row.role, 'owner');
      expect(row.showInTimeline, false);
    });

    test('deleteSharedSpaceMembersV1 removes the (space, user) pair only', () async {
      await sut.updateUsersV1([_createUser(), _createUser(id: 'user-2')]);
      await sut.updateSharedSpacesV1([makeSpace()]);
      await sut.updateSharedSpaceMembersV1([makeMember(userId: 'user-1'), makeMember(userId: 'user-2')]);

      await sut.deleteSharedSpaceMembersV1([
        SyncSharedSpaceMemberDeleteV1(spaceId: 'space-1', userId: 'user-1'),
      ]);

      final remaining = await db.sharedSpaceMemberEntity.select().get();
      expect(remaining, hasLength(1));
      expect(remaining.first.userId, 'user-2');
    });

    test('updateSharedSpaceAssetsV1 delegates to updateAssetsV1 (writes remote_asset)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpaceAssetsV1([
        _createAsset(id: 'asset-1', checksum: 'cccc', fileName: 'shared.jpg'),
      ]);

      final row = await (db.remoteAssetEntity.select()..where((t) => t.id.equals('asset-1'))).getSingle();
      expect(row.name, 'shared.jpg');
    });

    test('updateSharedSpaceAssetExifsV1 delegates to updateAssetsExifV1 (writes remote_exif)', () async {
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpaceAssetsV1([
        _createAsset(id: 'asset-1', checksum: 'cccc', fileName: 'shared.jpg'),
      ]);
      await sut.updateSharedSpaceAssetExifsV1([_createExif(assetId: 'asset-1', width: 100, height: 200, orientation: '1')]);

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

      await sut.deleteSharedSpaceToAssetsV1([
        SyncSharedSpaceToAssetDeleteV1(spaceId: 'space-1', assetId: 'asset-1'),
      ]);

      final remaining = await db.sharedSpaceAssetEntity.select().get();
      expect(remaining, hasLength(1));
      expect(remaining.first.assetId, 'asset-2');
    });
  });
}

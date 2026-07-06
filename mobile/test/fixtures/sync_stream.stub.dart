import 'package:immich_mobile/domain/models/sync_event.model.dart';
import 'package:openapi/api.dart';

abstract final class SyncStreamStub {
  static final userV1Admin = SyncEvent(
    type: SyncEntityType.userV1,
    data: SyncUserV1(
      deletedAt: DateTime(2020),
      email: "admin@admin",
      id: "1",
      name: "Admin",
      avatarColor: const Optional.absent(),
      hasProfileImage: false,
      profileChangedAt: DateTime(2025),
    ),
    ack: "1",
  );
  static final userV1User = SyncEvent(
    type: SyncEntityType.userV1,
    data: SyncUserV1(
      deletedAt: DateTime(2021),
      email: "user@user",
      id: "5",
      name: "User",
      avatarColor: const Optional.absent(),
      hasProfileImage: false,
      profileChangedAt: DateTime(2025),
    ),
    ack: "5",
  );
  static final userDeleteV1 = SyncEvent(
    type: SyncEntityType.userDeleteV1,
    data: SyncUserDeleteV1(userId: "2"),
    ack: "2",
  );

  static final partnerV1 = SyncEvent(
    type: SyncEntityType.partnerV1,
    data: SyncPartnerV1(inTimeline: true, sharedById: "1", sharedWithId: "2"),
    ack: "3",
  );
  static final partnerDeleteV1 = SyncEvent(
    type: SyncEntityType.partnerDeleteV1,
    data: SyncPartnerDeleteV1(sharedById: "3", sharedWithId: "4"),
    ack: "4",
  );

  static final memoryV1 = SyncEvent(
    type: SyncEntityType.memoryV1,
    data: SyncMemoryV1(
      createdAt: DateTime(2023, 1, 1),
      data: {"year": 2023, "title": "Test Memory"},
      deletedAt: null,
      hideAt: null,
      id: "memory-1",
      isSaved: false,
      memoryAt: DateTime(2023, 1, 1),
      ownerId: "user-1",
      seenAt: null,
      showAt: DateTime(2023, 1, 1),
      type: MemoryType.onThisDay,
      updatedAt: DateTime(2023, 1, 1),
    ),
    ack: "5",
  );

  static final memoryDeleteV1 = SyncEvent(
    type: SyncEntityType.memoryDeleteV1,
    data: SyncMemoryDeleteV1(memoryId: "memory-2"),
    ack: "6",
  );

  static final memoryToAssetV1 = SyncEvent(
    type: SyncEntityType.memoryToAssetV1,
    data: SyncMemoryAssetV1(assetId: "asset-1", memoryId: "memory-1"),
    ack: "7",
  );

  static final memoryToAssetDeleteV1 = SyncEvent(
    type: SyncEntityType.memoryToAssetDeleteV1,
    data: SyncMemoryAssetDeleteV1(assetId: "asset-2", memoryId: "memory-1"),
    ack: "8",
  );

  static final assetDeleteV1 = SyncEvent(
    type: SyncEntityType.assetDeleteV1,
    data: SyncAssetDeleteV1(assetId: "remote-asset"),
    ack: "asset-delete-ack",
  );

  static SyncEvent assetTrashed({
    required String id,
    required String checksum,
    required String ack,
    DateTime? trashedAt,
  }) {
    return _assetV1(id: id, checksum: checksum, deletedAt: trashedAt ?? DateTime(2025, 1, 1), ack: ack);
  }

  static SyncEvent assetModified({required String id, required String checksum, required String ack}) {
    return _assetV1(id: id, checksum: checksum, deletedAt: null, ack: ack);
  }

  static SyncEvent _assetV1({
    required String id,
    required String checksum,
    required DateTime? deletedAt,
    required String ack,
  }) {
    return SyncEvent(
      type: SyncEntityType.assetV1,
      data: SyncAssetV1(
        checksum: checksum,
        deletedAt: deletedAt,
        duration: '0',
        fileCreatedAt: DateTime(2025),
        fileModifiedAt: DateTime(2025, 1, 2),
        createdAt: DateTime(2025, 1, 2),
        id: id,
        isFavorite: false,
        libraryId: null,
        livePhotoVideoId: null,
        localDateTime: DateTime(2025, 1, 3),
        originalFileName: '$id.jpg',
        ownerId: 'owner',
        stackId: null,
        thumbhash: null,
        type: AssetTypeEnum.IMAGE,
        visibility: AssetVisibility.timeline,
        width: null,
        height: null,
        isEdited: false,
      ),
      ack: ack,
    );
  }

  // --- gallery-fork: library sync stubs ---

  static final libraryV1 = SyncEvent(
    type: SyncEntityType.libraryV1,
    data: SyncLibraryV1(
      id: 'library-1',
      name: 'Test Library',
      ownerId: 'owner',
      createdAt: DateTime(2026, 4, 1),
      updatedAt: DateTime(2026, 4, 1),
    ),
    ack: 'library-v1-ack',
  );

  static final libraryDeleteV1 = SyncEvent(
    type: SyncEntityType.libraryDeleteV1,
    data: SyncLibraryDeleteV1(libraryId: 'library-2'),
    ack: 'library-delete-ack',
  );

  static final libraryAssetCreateV1 = SyncEvent(
    type: SyncEntityType.libraryAssetCreateV1,
    data: SyncAssetV1(
      id: 'lib-asset-1',
      checksum: 'cLib1',
      originalFileName: 'lib-asset-1.jpg',
      type: AssetTypeEnum.IMAGE,
      ownerId: 'owner',
      isFavorite: false,
      fileCreatedAt: DateTime(2026, 4, 1),
      fileModifiedAt: DateTime(2026, 4, 1),
      localDateTime: DateTime(2026, 4, 1),
      createdAt: DateTime(2026, 4, 1),
      visibility: AssetVisibility.timeline,
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
    ack: 'lib-asset-create-ack',
  );

  static final libraryAssetBackfillV1 = SyncEvent(
    type: SyncEntityType.libraryAssetBackfillV1,
    data: SyncAssetV1(
      id: 'lib-asset-2',
      checksum: 'cLib2',
      originalFileName: 'lib-asset-2.jpg',
      type: AssetTypeEnum.IMAGE,
      ownerId: 'owner',
      isFavorite: false,
      fileCreatedAt: DateTime(2026, 4, 1),
      fileModifiedAt: DateTime(2026, 4, 1),
      localDateTime: DateTime(2026, 4, 1),
      createdAt: DateTime(2026, 4, 1),
      visibility: AssetVisibility.timeline,
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
    ack: 'lib-asset-backfill-ack',
  );

  static final libraryAssetDeleteV1 = SyncEvent(
    type: SyncEntityType.libraryAssetDeleteV1,
    data: SyncLibraryAssetDeleteV1(assetId: 'lib-asset-3'),
    ack: 'lib-asset-delete-ack',
  );

  static final libraryAssetExifCreateV1 = SyncEvent(
    type: SyncEntityType.libraryAssetExifCreateV1,
    data: SyncAssetExifV1(
      assetId: 'lib-asset-1',
      exifImageWidth: null,
      exifImageHeight: null,
      orientation: null,
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
    ack: 'lib-asset-exif-create-ack',
  );

  static final libraryAssetExifBackfillV1 = SyncEvent(
    type: SyncEntityType.libraryAssetExifBackfillV1,
    data: SyncAssetExifV1(
      assetId: 'lib-asset-2',
      exifImageWidth: null,
      exifImageHeight: null,
      orientation: null,
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
    ack: 'lib-asset-exif-backfill-ack',
  );

  static final sharedSpaceLibraryV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceLibraryV1,
    data: SyncSharedSpaceLibraryV1(
      spaceId: 'space-1',
      libraryId: 'library-1',
      addedById: 'owner',
      createdAt: DateTime(2026, 4, 1),
      updatedAt: DateTime(2026, 4, 1),
    ),
    ack: 'shared-space-library-v1-ack',
  );

  static final sharedSpaceLibraryBackfillV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceLibraryBackfillV1,
    data: SyncSharedSpaceLibraryV1(
      spaceId: 'space-2',
      libraryId: 'library-2',
      addedById: 'owner',
      createdAt: DateTime(2026, 4, 1),
      updatedAt: DateTime(2026, 4, 1),
    ),
    ack: 'shared-space-library-backfill-ack',
  );

  static final sharedSpaceLibraryDeleteV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceLibraryDeleteV1,
    data: SyncSharedSpaceLibraryDeleteV1(spaceId: 'space-3', libraryId: 'library-3'),
    ack: 'shared-space-library-delete-ack',
  );

  // --- gallery-fork: shared space sync stubs (PR 1) ---

  static final sharedSpaceV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceV1,
    data: SyncSharedSpaceV1(
      id: 'space-1',
      name: 'Test Space',
      description: null,
      color: null,
      createdById: 'owner',
      thumbnailAssetId: null,
      thumbnailCropY: null,
      faceRecognitionEnabled: true,
      petsEnabled: false,
      lastActivityAt: null,
      createdAt: DateTime(2026, 4, 1),
      updatedAt: DateTime(2026, 4, 1),
    ),
    ack: 'shared-space-v1-ack',
  );

  static final sharedSpaceDeleteV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceDeleteV1,
    data: SyncSharedSpaceDeleteV1(spaceId: 'space-2'),
    ack: 'shared-space-delete-ack',
  );

  static final sharedSpaceMemberV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceMemberV1,
    data: SyncSharedSpaceMemberV1(
      spaceId: 'space-1',
      userId: 'user-1',
      role: 'editor',
      showInTimeline: true,
      joinedAt: DateTime(2026, 4, 1),
    ),
    ack: 'shared-space-member-v1-ack',
  );

  static final sharedSpaceMemberBackfillV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceMemberBackfillV1,
    data: SyncSharedSpaceMemberV1(
      spaceId: 'space-2',
      userId: 'user-2',
      role: 'editor',
      showInTimeline: true,
      joinedAt: DateTime(2026, 4, 1),
    ),
    ack: 'shared-space-member-backfill-ack',
  );

  static final sharedSpaceMemberDeleteV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceMemberDeleteV1,
    data: SyncSharedSpaceMemberDeleteV1(spaceId: 'space-3', userId: 'user-3'),
    ack: 'shared-space-member-delete-ack',
  );

  // --- gallery-fork: shared-space album sync stubs (Phase 2B) ---

  static SyncAlbumV2 _makeAlbumV2({String id = 'album-stub-1'}) => SyncAlbumV2(
    id: id,
    name: 'Stub Album',
    description: '',
    isActivityEnabled: true,
    order: AssetOrder.asc,
    thumbnailAssetId: null,
    createdAt: DateTime(2026, 6, 1),
    updatedAt: DateTime(2026, 6, 1),
  );

  static final sharedSpaceAlbumV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumV1,
    data: _makeAlbumV2(),
    ack: 'sa-album-v1-ack',
  );

  static final sharedSpaceAlbumBackfillV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumBackfillV1,
    data: _makeAlbumV2(id: 'album-stub-2'),
    ack: 'sa-album-backfill-ack',
  );

  static final sharedSpaceAlbumDeleteV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumDeleteV1,
    data: SyncAlbumDeleteV1(albumId: 'album-stub-del'),
    ack: 'sa-album-delete-ack',
  );

  static final sharedSpaceAlbumLinkV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumLinkV1,
    data: SyncSharedSpaceAlbumLinkV1(
      spaceId: 'space-1',
      albumId: 'album-stub-1',
      showInTimeline: true,
      addedById: null,
      createdAt: DateTime(2026, 6, 1),
      updatedAt: DateTime(2026, 6, 1),
    ),
    ack: 'sa-album-link-v1-ack',
  );

  static final sharedSpaceAlbumLinkBackfillV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumLinkBackfillV1,
    data: SyncSharedSpaceAlbumLinkV1(
      spaceId: 'space-2',
      albumId: 'album-stub-2',
      showInTimeline: false,
      addedById: null,
      createdAt: DateTime(2026, 6, 1),
      updatedAt: DateTime(2026, 6, 1),
    ),
    ack: 'sa-album-link-backfill-ack',
  );

  static final sharedSpaceAlbumLinkDeleteV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumLinkDeleteV1,
    data: SyncSharedSpaceAlbumLinkDeleteV1(spaceId: 'space-3', albumId: 'album-stub-3'),
    ack: 'sa-album-link-delete-ack',
  );

  static final sharedSpaceAlbumToAssetV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumToAssetV1,
    data: SyncAlbumToAssetV1(albumId: 'album-stub-1', assetId: 'asset-stub-1'),
    ack: 'sa-album-to-asset-v1-ack',
  );

  static final sharedSpaceAlbumToAssetBackfillV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumToAssetBackfillV1,
    data: SyncAlbumToAssetV1(albumId: 'album-stub-2', assetId: 'asset-stub-2'),
    ack: 'sa-album-to-asset-backfill-ack',
  );

  static final sharedSpaceAlbumToAssetDeleteV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumToAssetDeleteV1,
    data: SyncAlbumToAssetDeleteV1(albumId: 'album-stub-3', assetId: 'asset-stub-3'),
    ack: 'sa-album-to-asset-delete-ack',
  );

  static SyncAssetV2 _makeAssetV2({String id = 'sa-asset-stub-1'}) => SyncAssetV2(
    id: id,
    checksum: 'cStub$id',
    originalFileName: '$id.jpg',
    type: AssetTypeEnum.IMAGE,
    ownerId: 'owner',
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
  );

  static final sharedSpaceAlbumAssetCreateV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumAssetCreateV1,
    data: _makeAssetV2(),
    ack: 'sa-asset-create-ack',
  );

  static final sharedSpaceAlbumAssetUpdateV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumAssetUpdateV1,
    data: _makeAssetV2(id: 'sa-asset-stub-2'),
    ack: 'sa-asset-update-ack',
  );

  static final sharedSpaceAlbumAssetBackfillV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumAssetBackfillV1,
    data: _makeAssetV2(id: 'sa-asset-stub-3'),
    ack: 'sa-asset-backfill-ack',
  );

  static SyncAssetExifV1 _makeExifV1({String assetId = 'sa-asset-stub-1'}) => SyncAssetExifV1(
    assetId: assetId,
    exifImageWidth: null,
    exifImageHeight: null,
    orientation: null,
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

  static final sharedSpaceAlbumAssetExifCreateV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumAssetExifCreateV1,
    data: _makeExifV1(),
    ack: 'sa-exif-create-ack',
  );

  static final sharedSpaceAlbumAssetExifUpdateV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumAssetExifUpdateV1,
    data: _makeExifV1(assetId: 'sa-asset-stub-2'),
    ack: 'sa-exif-update-ack',
  );

  static final sharedSpaceAlbumAssetExifBackfillV1 = SyncEvent(
    type: SyncEntityType.sharedSpaceAlbumAssetExifBackfillV1,
    data: _makeExifV1(assetId: 'sa-asset-stub-3'),
    ack: 'sa-exif-backfill-ack',
  );
}

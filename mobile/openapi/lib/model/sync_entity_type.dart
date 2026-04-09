//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Sync entity type
class SyncEntityType {
  /// Instantiate a new enum with the provided [value].
  const SyncEntityType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const authUserV1 = SyncEntityType._(r'AuthUserV1');
  static const userV1 = SyncEntityType._(r'UserV1');
  static const userDeleteV1 = SyncEntityType._(r'UserDeleteV1');
  static const assetV1 = SyncEntityType._(r'AssetV1');
  static const assetDeleteV1 = SyncEntityType._(r'AssetDeleteV1');
  static const assetExifV1 = SyncEntityType._(r'AssetExifV1');
  static const assetEditV1 = SyncEntityType._(r'AssetEditV1');
  static const assetEditDeleteV1 = SyncEntityType._(r'AssetEditDeleteV1');
  static const assetMetadataV1 = SyncEntityType._(r'AssetMetadataV1');
  static const assetMetadataDeleteV1 = SyncEntityType._(r'AssetMetadataDeleteV1');
  static const partnerV1 = SyncEntityType._(r'PartnerV1');
  static const partnerDeleteV1 = SyncEntityType._(r'PartnerDeleteV1');
  static const partnerAssetV1 = SyncEntityType._(r'PartnerAssetV1');
  static const partnerAssetBackfillV1 = SyncEntityType._(r'PartnerAssetBackfillV1');
  static const partnerAssetDeleteV1 = SyncEntityType._(r'PartnerAssetDeleteV1');
  static const partnerAssetExifV1 = SyncEntityType._(r'PartnerAssetExifV1');
  static const partnerAssetExifBackfillV1 = SyncEntityType._(r'PartnerAssetExifBackfillV1');
  static const partnerStackBackfillV1 = SyncEntityType._(r'PartnerStackBackfillV1');
  static const partnerStackDeleteV1 = SyncEntityType._(r'PartnerStackDeleteV1');
  static const partnerStackV1 = SyncEntityType._(r'PartnerStackV1');
  static const albumV1 = SyncEntityType._(r'AlbumV1');
  static const albumDeleteV1 = SyncEntityType._(r'AlbumDeleteV1');
  static const albumUserV1 = SyncEntityType._(r'AlbumUserV1');
  static const albumUserBackfillV1 = SyncEntityType._(r'AlbumUserBackfillV1');
  static const albumUserDeleteV1 = SyncEntityType._(r'AlbumUserDeleteV1');
  static const albumAssetCreateV1 = SyncEntityType._(r'AlbumAssetCreateV1');
  static const albumAssetUpdateV1 = SyncEntityType._(r'AlbumAssetUpdateV1');
  static const albumAssetBackfillV1 = SyncEntityType._(r'AlbumAssetBackfillV1');
  static const albumAssetExifCreateV1 = SyncEntityType._(r'AlbumAssetExifCreateV1');
  static const albumAssetExifUpdateV1 = SyncEntityType._(r'AlbumAssetExifUpdateV1');
  static const albumAssetExifBackfillV1 = SyncEntityType._(r'AlbumAssetExifBackfillV1');
  static const albumToAssetV1 = SyncEntityType._(r'AlbumToAssetV1');
  static const albumToAssetDeleteV1 = SyncEntityType._(r'AlbumToAssetDeleteV1');
  static const albumToAssetBackfillV1 = SyncEntityType._(r'AlbumToAssetBackfillV1');
  static const memoryV1 = SyncEntityType._(r'MemoryV1');
  static const memoryDeleteV1 = SyncEntityType._(r'MemoryDeleteV1');
  static const memoryToAssetV1 = SyncEntityType._(r'MemoryToAssetV1');
  static const memoryToAssetDeleteV1 = SyncEntityType._(r'MemoryToAssetDeleteV1');
  static const stackV1 = SyncEntityType._(r'StackV1');
  static const stackDeleteV1 = SyncEntityType._(r'StackDeleteV1');
  static const personV1 = SyncEntityType._(r'PersonV1');
  static const personDeleteV1 = SyncEntityType._(r'PersonDeleteV1');
  static const assetFaceV1 = SyncEntityType._(r'AssetFaceV1');
  static const assetFaceV2 = SyncEntityType._(r'AssetFaceV2');
  static const assetFaceDeleteV1 = SyncEntityType._(r'AssetFaceDeleteV1');
  static const userMetadataV1 = SyncEntityType._(r'UserMetadataV1');
  static const userMetadataDeleteV1 = SyncEntityType._(r'UserMetadataDeleteV1');
  static const sharedSpaceV1 = SyncEntityType._(r'SharedSpaceV1');
  static const sharedSpaceDeleteV1 = SyncEntityType._(r'SharedSpaceDeleteV1');
  static const sharedSpaceMemberV1 = SyncEntityType._(r'SharedSpaceMemberV1');
  static const sharedSpaceMemberDeleteV1 = SyncEntityType._(r'SharedSpaceMemberDeleteV1');
  static const sharedSpaceMemberBackfillV1 = SyncEntityType._(r'SharedSpaceMemberBackfillV1');
  static const sharedSpaceAssetCreateV1 = SyncEntityType._(r'SharedSpaceAssetCreateV1');
  static const sharedSpaceAssetUpdateV1 = SyncEntityType._(r'SharedSpaceAssetUpdateV1');
  static const sharedSpaceAssetBackfillV1 = SyncEntityType._(r'SharedSpaceAssetBackfillV1');
  static const sharedSpaceAssetExifCreateV1 = SyncEntityType._(r'SharedSpaceAssetExifCreateV1');
  static const sharedSpaceAssetExifUpdateV1 = SyncEntityType._(r'SharedSpaceAssetExifUpdateV1');
  static const sharedSpaceAssetExifBackfillV1 = SyncEntityType._(r'SharedSpaceAssetExifBackfillV1');
  static const sharedSpaceToAssetV1 = SyncEntityType._(r'SharedSpaceToAssetV1');
  static const sharedSpaceToAssetDeleteV1 = SyncEntityType._(r'SharedSpaceToAssetDeleteV1');
  static const sharedSpaceToAssetBackfillV1 = SyncEntityType._(r'SharedSpaceToAssetBackfillV1');
  static const libraryV1 = SyncEntityType._(r'LibraryV1');
  static const libraryDeleteV1 = SyncEntityType._(r'LibraryDeleteV1');
  static const libraryAssetCreateV1 = SyncEntityType._(r'LibraryAssetCreateV1');
  static const libraryAssetDeleteV1 = SyncEntityType._(r'LibraryAssetDeleteV1');
  static const libraryAssetBackfillV1 = SyncEntityType._(r'LibraryAssetBackfillV1');
  static const libraryAssetExifCreateV1 = SyncEntityType._(r'LibraryAssetExifCreateV1');
  static const libraryAssetExifBackfillV1 = SyncEntityType._(r'LibraryAssetExifBackfillV1');
  static const sharedSpaceLibraryV1 = SyncEntityType._(r'SharedSpaceLibraryV1');
  static const sharedSpaceLibraryDeleteV1 = SyncEntityType._(r'SharedSpaceLibraryDeleteV1');
  static const sharedSpaceLibraryBackfillV1 = SyncEntityType._(r'SharedSpaceLibraryBackfillV1');
  static const syncAckV1 = SyncEntityType._(r'SyncAckV1');
  static const syncResetV1 = SyncEntityType._(r'SyncResetV1');
  static const syncCompleteV1 = SyncEntityType._(r'SyncCompleteV1');

  /// List of all possible values in this [enum][SyncEntityType].
  static const values = <SyncEntityType>[
    authUserV1,
    userV1,
    userDeleteV1,
    assetV1,
    assetDeleteV1,
    assetExifV1,
    assetEditV1,
    assetEditDeleteV1,
    assetMetadataV1,
    assetMetadataDeleteV1,
    partnerV1,
    partnerDeleteV1,
    partnerAssetV1,
    partnerAssetBackfillV1,
    partnerAssetDeleteV1,
    partnerAssetExifV1,
    partnerAssetExifBackfillV1,
    partnerStackBackfillV1,
    partnerStackDeleteV1,
    partnerStackV1,
    albumV1,
    albumDeleteV1,
    albumUserV1,
    albumUserBackfillV1,
    albumUserDeleteV1,
    albumAssetCreateV1,
    albumAssetUpdateV1,
    albumAssetBackfillV1,
    albumAssetExifCreateV1,
    albumAssetExifUpdateV1,
    albumAssetExifBackfillV1,
    albumToAssetV1,
    albumToAssetDeleteV1,
    albumToAssetBackfillV1,
    memoryV1,
    memoryDeleteV1,
    memoryToAssetV1,
    memoryToAssetDeleteV1,
    stackV1,
    stackDeleteV1,
    personV1,
    personDeleteV1,
    assetFaceV1,
    assetFaceV2,
    assetFaceDeleteV1,
    userMetadataV1,
    userMetadataDeleteV1,
    sharedSpaceV1,
    sharedSpaceDeleteV1,
    sharedSpaceMemberV1,
    sharedSpaceMemberDeleteV1,
    sharedSpaceMemberBackfillV1,
    sharedSpaceAssetCreateV1,
    sharedSpaceAssetUpdateV1,
    sharedSpaceAssetBackfillV1,
    sharedSpaceAssetExifCreateV1,
    sharedSpaceAssetExifUpdateV1,
    sharedSpaceAssetExifBackfillV1,
    sharedSpaceToAssetV1,
    sharedSpaceToAssetDeleteV1,
    sharedSpaceToAssetBackfillV1,
    libraryV1,
    libraryDeleteV1,
    libraryAssetCreateV1,
    libraryAssetDeleteV1,
    libraryAssetBackfillV1,
    libraryAssetExifCreateV1,
    libraryAssetExifBackfillV1,
    sharedSpaceLibraryV1,
    sharedSpaceLibraryDeleteV1,
    sharedSpaceLibraryBackfillV1,
    syncAckV1,
    syncResetV1,
    syncCompleteV1,
  ];

  static SyncEntityType? fromJson(dynamic value) => SyncEntityTypeTypeTransformer().decode(value);

  static List<SyncEntityType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncEntityType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncEntityType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SyncEntityType] to String,
/// and [decode] dynamic data back to [SyncEntityType].
class SyncEntityTypeTypeTransformer {
  factory SyncEntityTypeTypeTransformer() => _instance ??= const SyncEntityTypeTypeTransformer._();

  const SyncEntityTypeTypeTransformer._();

  String encode(SyncEntityType data) => data.value;

  /// Decodes a [dynamic value][data] to a SyncEntityType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SyncEntityType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'AuthUserV1': return SyncEntityType.authUserV1;
        case r'UserV1': return SyncEntityType.userV1;
        case r'UserDeleteV1': return SyncEntityType.userDeleteV1;
        case r'AssetV1': return SyncEntityType.assetV1;
        case r'AssetDeleteV1': return SyncEntityType.assetDeleteV1;
        case r'AssetExifV1': return SyncEntityType.assetExifV1;
        case r'AssetEditV1': return SyncEntityType.assetEditV1;
        case r'AssetEditDeleteV1': return SyncEntityType.assetEditDeleteV1;
        case r'AssetMetadataV1': return SyncEntityType.assetMetadataV1;
        case r'AssetMetadataDeleteV1': return SyncEntityType.assetMetadataDeleteV1;
        case r'PartnerV1': return SyncEntityType.partnerV1;
        case r'PartnerDeleteV1': return SyncEntityType.partnerDeleteV1;
        case r'PartnerAssetV1': return SyncEntityType.partnerAssetV1;
        case r'PartnerAssetBackfillV1': return SyncEntityType.partnerAssetBackfillV1;
        case r'PartnerAssetDeleteV1': return SyncEntityType.partnerAssetDeleteV1;
        case r'PartnerAssetExifV1': return SyncEntityType.partnerAssetExifV1;
        case r'PartnerAssetExifBackfillV1': return SyncEntityType.partnerAssetExifBackfillV1;
        case r'PartnerStackBackfillV1': return SyncEntityType.partnerStackBackfillV1;
        case r'PartnerStackDeleteV1': return SyncEntityType.partnerStackDeleteV1;
        case r'PartnerStackV1': return SyncEntityType.partnerStackV1;
        case r'AlbumV1': return SyncEntityType.albumV1;
        case r'AlbumDeleteV1': return SyncEntityType.albumDeleteV1;
        case r'AlbumUserV1': return SyncEntityType.albumUserV1;
        case r'AlbumUserBackfillV1': return SyncEntityType.albumUserBackfillV1;
        case r'AlbumUserDeleteV1': return SyncEntityType.albumUserDeleteV1;
        case r'AlbumAssetCreateV1': return SyncEntityType.albumAssetCreateV1;
        case r'AlbumAssetUpdateV1': return SyncEntityType.albumAssetUpdateV1;
        case r'AlbumAssetBackfillV1': return SyncEntityType.albumAssetBackfillV1;
        case r'AlbumAssetExifCreateV1': return SyncEntityType.albumAssetExifCreateV1;
        case r'AlbumAssetExifUpdateV1': return SyncEntityType.albumAssetExifUpdateV1;
        case r'AlbumAssetExifBackfillV1': return SyncEntityType.albumAssetExifBackfillV1;
        case r'AlbumToAssetV1': return SyncEntityType.albumToAssetV1;
        case r'AlbumToAssetDeleteV1': return SyncEntityType.albumToAssetDeleteV1;
        case r'AlbumToAssetBackfillV1': return SyncEntityType.albumToAssetBackfillV1;
        case r'MemoryV1': return SyncEntityType.memoryV1;
        case r'MemoryDeleteV1': return SyncEntityType.memoryDeleteV1;
        case r'MemoryToAssetV1': return SyncEntityType.memoryToAssetV1;
        case r'MemoryToAssetDeleteV1': return SyncEntityType.memoryToAssetDeleteV1;
        case r'StackV1': return SyncEntityType.stackV1;
        case r'StackDeleteV1': return SyncEntityType.stackDeleteV1;
        case r'PersonV1': return SyncEntityType.personV1;
        case r'PersonDeleteV1': return SyncEntityType.personDeleteV1;
        case r'AssetFaceV1': return SyncEntityType.assetFaceV1;
        case r'AssetFaceV2': return SyncEntityType.assetFaceV2;
        case r'AssetFaceDeleteV1': return SyncEntityType.assetFaceDeleteV1;
        case r'UserMetadataV1': return SyncEntityType.userMetadataV1;
        case r'UserMetadataDeleteV1': return SyncEntityType.userMetadataDeleteV1;
        case r'SharedSpaceV1': return SyncEntityType.sharedSpaceV1;
        case r'SharedSpaceDeleteV1': return SyncEntityType.sharedSpaceDeleteV1;
        case r'SharedSpaceMemberV1': return SyncEntityType.sharedSpaceMemberV1;
        case r'SharedSpaceMemberDeleteV1': return SyncEntityType.sharedSpaceMemberDeleteV1;
        case r'SharedSpaceMemberBackfillV1': return SyncEntityType.sharedSpaceMemberBackfillV1;
        case r'SharedSpaceAssetCreateV1': return SyncEntityType.sharedSpaceAssetCreateV1;
        case r'SharedSpaceAssetUpdateV1': return SyncEntityType.sharedSpaceAssetUpdateV1;
        case r'SharedSpaceAssetBackfillV1': return SyncEntityType.sharedSpaceAssetBackfillV1;
        case r'SharedSpaceAssetExifCreateV1': return SyncEntityType.sharedSpaceAssetExifCreateV1;
        case r'SharedSpaceAssetExifUpdateV1': return SyncEntityType.sharedSpaceAssetExifUpdateV1;
        case r'SharedSpaceAssetExifBackfillV1': return SyncEntityType.sharedSpaceAssetExifBackfillV1;
        case r'SharedSpaceToAssetV1': return SyncEntityType.sharedSpaceToAssetV1;
        case r'SharedSpaceToAssetDeleteV1': return SyncEntityType.sharedSpaceToAssetDeleteV1;
        case r'SharedSpaceToAssetBackfillV1': return SyncEntityType.sharedSpaceToAssetBackfillV1;
        case r'LibraryV1': return SyncEntityType.libraryV1;
        case r'LibraryDeleteV1': return SyncEntityType.libraryDeleteV1;
        case r'LibraryAssetCreateV1': return SyncEntityType.libraryAssetCreateV1;
        case r'LibraryAssetDeleteV1': return SyncEntityType.libraryAssetDeleteV1;
        case r'LibraryAssetBackfillV1': return SyncEntityType.libraryAssetBackfillV1;
        case r'LibraryAssetExifCreateV1': return SyncEntityType.libraryAssetExifCreateV1;
        case r'LibraryAssetExifBackfillV1': return SyncEntityType.libraryAssetExifBackfillV1;
        case r'SharedSpaceLibraryV1': return SyncEntityType.sharedSpaceLibraryV1;
        case r'SharedSpaceLibraryDeleteV1': return SyncEntityType.sharedSpaceLibraryDeleteV1;
        case r'SharedSpaceLibraryBackfillV1': return SyncEntityType.sharedSpaceLibraryBackfillV1;
        case r'SyncAckV1': return SyncEntityType.syncAckV1;
        case r'SyncResetV1': return SyncEntityType.syncResetV1;
        case r'SyncCompleteV1': return SyncEntityType.syncCompleteV1;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [SyncEntityTypeTypeTransformer] instance.
  static SyncEntityTypeTypeTransformer? _instance;
}


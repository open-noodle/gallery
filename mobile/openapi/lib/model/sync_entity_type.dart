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
enum SyncEntityType {
  authUserV1._(r'AuthUserV1'),
  userV1._(r'UserV1'),
  userDeleteV1._(r'UserDeleteV1'),
  assetV1._(r'AssetV1'),
  assetV2._(r'AssetV2'),
  assetDeleteV1._(r'AssetDeleteV1'),
  assetExifV1._(r'AssetExifV1'),
  assetEditV1._(r'AssetEditV1'),
  assetEditDeleteV1._(r'AssetEditDeleteV1'),
  assetMetadataV1._(r'AssetMetadataV1'),
  assetMetadataDeleteV1._(r'AssetMetadataDeleteV1'),
  assetOcrV1._(r'AssetOcrV1'),
  assetOcrDeleteV1._(r'AssetOcrDeleteV1'),
  partnerV1._(r'PartnerV1'),
  partnerDeleteV1._(r'PartnerDeleteV1'),
  partnerAssetV1._(r'PartnerAssetV1'),
  partnerAssetV2._(r'PartnerAssetV2'),
  partnerAssetBackfillV1._(r'PartnerAssetBackfillV1'),
  partnerAssetBackfillV2._(r'PartnerAssetBackfillV2'),
  partnerAssetDeleteV1._(r'PartnerAssetDeleteV1'),
  partnerAssetExifV1._(r'PartnerAssetExifV1'),
  partnerAssetExifBackfillV1._(r'PartnerAssetExifBackfillV1'),
  partnerStackBackfillV1._(r'PartnerStackBackfillV1'),
  partnerStackDeleteV1._(r'PartnerStackDeleteV1'),
  partnerStackV1._(r'PartnerStackV1'),
  albumV1._(r'AlbumV1'),
  albumV2._(r'AlbumV2'),
  albumDeleteV1._(r'AlbumDeleteV1'),
  albumUserV1._(r'AlbumUserV1'),
  albumUserBackfillV1._(r'AlbumUserBackfillV1'),
  albumUserDeleteV1._(r'AlbumUserDeleteV1'),
  albumAssetCreateV1._(r'AlbumAssetCreateV1'),
  albumAssetCreateV2._(r'AlbumAssetCreateV2'),
  albumAssetUpdateV1._(r'AlbumAssetUpdateV1'),
  albumAssetUpdateV2._(r'AlbumAssetUpdateV2'),
  albumAssetBackfillV1._(r'AlbumAssetBackfillV1'),
  albumAssetBackfillV2._(r'AlbumAssetBackfillV2'),
  albumAssetExifCreateV1._(r'AlbumAssetExifCreateV1'),
  albumAssetExifUpdateV1._(r'AlbumAssetExifUpdateV1'),
  albumAssetExifBackfillV1._(r'AlbumAssetExifBackfillV1'),
  albumToAssetV1._(r'AlbumToAssetV1'),
  albumToAssetDeleteV1._(r'AlbumToAssetDeleteV1'),
  albumToAssetBackfillV1._(r'AlbumToAssetBackfillV1'),
  memoryV1._(r'MemoryV1'),
  memoryDeleteV1._(r'MemoryDeleteV1'),
  memoryToAssetV1._(r'MemoryToAssetV1'),
  memoryToAssetDeleteV1._(r'MemoryToAssetDeleteV1'),
  stackV1._(r'StackV1'),
  stackDeleteV1._(r'StackDeleteV1'),
  personV1._(r'PersonV1'),
  personDeleteV1._(r'PersonDeleteV1'),
  assetFaceV1._(r'AssetFaceV1'),
  assetFaceV2._(r'AssetFaceV2'),
  assetFaceDeleteV1._(r'AssetFaceDeleteV1'),
  userMetadataV1._(r'UserMetadataV1'),
  userMetadataDeleteV1._(r'UserMetadataDeleteV1'),
  sharedSpaceV1._(r'SharedSpaceV1'),
  sharedSpaceDeleteV1._(r'SharedSpaceDeleteV1'),
  sharedSpaceMemberV1._(r'SharedSpaceMemberV1'),
  sharedSpaceMemberDeleteV1._(r'SharedSpaceMemberDeleteV1'),
  sharedSpaceMemberBackfillV1._(r'SharedSpaceMemberBackfillV1'),
  sharedSpaceAssetCreateV1._(r'SharedSpaceAssetCreateV1'),
  sharedSpaceAssetUpdateV1._(r'SharedSpaceAssetUpdateV1'),
  sharedSpaceAssetBackfillV1._(r'SharedSpaceAssetBackfillV1'),
  sharedSpaceAssetExifCreateV1._(r'SharedSpaceAssetExifCreateV1'),
  sharedSpaceAssetExifUpdateV1._(r'SharedSpaceAssetExifUpdateV1'),
  sharedSpaceAssetExifBackfillV1._(r'SharedSpaceAssetExifBackfillV1'),
  sharedSpaceToAssetV1._(r'SharedSpaceToAssetV1'),
  sharedSpaceToAssetDeleteV1._(r'SharedSpaceToAssetDeleteV1'),
  sharedSpaceToAssetBackfillV1._(r'SharedSpaceToAssetBackfillV1'),
  libraryV1._(r'LibraryV1'),
  libraryDeleteV1._(r'LibraryDeleteV1'),
  libraryAssetCreateV1._(r'LibraryAssetCreateV1'),
  libraryAssetDeleteV1._(r'LibraryAssetDeleteV1'),
  libraryAssetBackfillV1._(r'LibraryAssetBackfillV1'),
  libraryAssetExifCreateV1._(r'LibraryAssetExifCreateV1'),
  libraryAssetExifBackfillV1._(r'LibraryAssetExifBackfillV1'),
  sharedSpaceLibraryV1._(r'SharedSpaceLibraryV1'),
  sharedSpaceLibraryDeleteV1._(r'SharedSpaceLibraryDeleteV1'),
  sharedSpaceLibraryBackfillV1._(r'SharedSpaceLibraryBackfillV1'),
  sharedSpaceAlbumV1._(r'SharedSpaceAlbumV1'),
  sharedSpaceAlbumDeleteV1._(r'SharedSpaceAlbumDeleteV1'),
  sharedSpaceAlbumBackfillV1._(r'SharedSpaceAlbumBackfillV1'),
  sharedSpaceAlbumLinkV1._(r'SharedSpaceAlbumLinkV1'),
  sharedSpaceAlbumLinkDeleteV1._(r'SharedSpaceAlbumLinkDeleteV1'),
  sharedSpaceAlbumLinkBackfillV1._(r'SharedSpaceAlbumLinkBackfillV1'),
  sharedSpaceAlbumHiddenV1._(r'SharedSpaceAlbumHiddenV1'),
  sharedSpaceAlbumHiddenDeleteV1._(r'SharedSpaceAlbumHiddenDeleteV1'),
  sharedSpaceAlbumHiddenBackfillV1._(r'SharedSpaceAlbumHiddenBackfillV1'),
  sharedSpaceAlbumToAssetV1._(r'SharedSpaceAlbumToAssetV1'),
  sharedSpaceAlbumToAssetDeleteV1._(r'SharedSpaceAlbumToAssetDeleteV1'),
  sharedSpaceAlbumToAssetBackfillV1._(r'SharedSpaceAlbumToAssetBackfillV1'),
  sharedSpaceAlbumAssetCreateV1._(r'SharedSpaceAlbumAssetCreateV1'),
  sharedSpaceAlbumAssetUpdateV1._(r'SharedSpaceAlbumAssetUpdateV1'),
  sharedSpaceAlbumAssetBackfillV1._(r'SharedSpaceAlbumAssetBackfillV1'),
  sharedSpaceAlbumAssetExifCreateV1._(r'SharedSpaceAlbumAssetExifCreateV1'),
  sharedSpaceAlbumAssetExifUpdateV1._(r'SharedSpaceAlbumAssetExifUpdateV1'),
  sharedSpaceAlbumAssetExifBackfillV1._(r'SharedSpaceAlbumAssetExifBackfillV1'),
  syncAckV1._(r'SyncAckV1'),
  syncResetV1._(r'SyncResetV1'),
  syncCompleteV1._(r'SyncCompleteV1'),
  ;

  /// Instantiate a new enum with the provided value.
  const SyncEntityType._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [SyncEntityType] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static SyncEntityType? fromJson(dynamic value) => SyncEntityTypeTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [SyncEntityType]
  /// that were successfully decoded from the passed [JSON][json].
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

  /// Encodes this enum as a value suitable for JSON.
  String encode(SyncEntityType data) => data._value;

  /// Returns the instance of [SyncEntityType] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SyncEntityType? decode(dynamic data, {bool allowNull = true}) {
    if (data is SyncEntityType) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'AuthUserV1': return SyncEntityType.authUserV1;
        case r'UserV1': return SyncEntityType.userV1;
        case r'UserDeleteV1': return SyncEntityType.userDeleteV1;
        case r'AssetV1': return SyncEntityType.assetV1;
        case r'AssetV2': return SyncEntityType.assetV2;
        case r'AssetDeleteV1': return SyncEntityType.assetDeleteV1;
        case r'AssetExifV1': return SyncEntityType.assetExifV1;
        case r'AssetEditV1': return SyncEntityType.assetEditV1;
        case r'AssetEditDeleteV1': return SyncEntityType.assetEditDeleteV1;
        case r'AssetMetadataV1': return SyncEntityType.assetMetadataV1;
        case r'AssetMetadataDeleteV1': return SyncEntityType.assetMetadataDeleteV1;
        case r'AssetOcrV1': return SyncEntityType.assetOcrV1;
        case r'AssetOcrDeleteV1': return SyncEntityType.assetOcrDeleteV1;
        case r'PartnerV1': return SyncEntityType.partnerV1;
        case r'PartnerDeleteV1': return SyncEntityType.partnerDeleteV1;
        case r'PartnerAssetV1': return SyncEntityType.partnerAssetV1;
        case r'PartnerAssetV2': return SyncEntityType.partnerAssetV2;
        case r'PartnerAssetBackfillV1': return SyncEntityType.partnerAssetBackfillV1;
        case r'PartnerAssetBackfillV2': return SyncEntityType.partnerAssetBackfillV2;
        case r'PartnerAssetDeleteV1': return SyncEntityType.partnerAssetDeleteV1;
        case r'PartnerAssetExifV1': return SyncEntityType.partnerAssetExifV1;
        case r'PartnerAssetExifBackfillV1': return SyncEntityType.partnerAssetExifBackfillV1;
        case r'PartnerStackBackfillV1': return SyncEntityType.partnerStackBackfillV1;
        case r'PartnerStackDeleteV1': return SyncEntityType.partnerStackDeleteV1;
        case r'PartnerStackV1': return SyncEntityType.partnerStackV1;
        case r'AlbumV1': return SyncEntityType.albumV1;
        case r'AlbumV2': return SyncEntityType.albumV2;
        case r'AlbumDeleteV1': return SyncEntityType.albumDeleteV1;
        case r'AlbumUserV1': return SyncEntityType.albumUserV1;
        case r'AlbumUserBackfillV1': return SyncEntityType.albumUserBackfillV1;
        case r'AlbumUserDeleteV1': return SyncEntityType.albumUserDeleteV1;
        case r'AlbumAssetCreateV1': return SyncEntityType.albumAssetCreateV1;
        case r'AlbumAssetCreateV2': return SyncEntityType.albumAssetCreateV2;
        case r'AlbumAssetUpdateV1': return SyncEntityType.albumAssetUpdateV1;
        case r'AlbumAssetUpdateV2': return SyncEntityType.albumAssetUpdateV2;
        case r'AlbumAssetBackfillV1': return SyncEntityType.albumAssetBackfillV1;
        case r'AlbumAssetBackfillV2': return SyncEntityType.albumAssetBackfillV2;
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
        case r'SharedSpaceAlbumV1': return SyncEntityType.sharedSpaceAlbumV1;
        case r'SharedSpaceAlbumDeleteV1': return SyncEntityType.sharedSpaceAlbumDeleteV1;
        case r'SharedSpaceAlbumBackfillV1': return SyncEntityType.sharedSpaceAlbumBackfillV1;
        case r'SharedSpaceAlbumLinkV1': return SyncEntityType.sharedSpaceAlbumLinkV1;
        case r'SharedSpaceAlbumLinkDeleteV1': return SyncEntityType.sharedSpaceAlbumLinkDeleteV1;
        case r'SharedSpaceAlbumLinkBackfillV1': return SyncEntityType.sharedSpaceAlbumLinkBackfillV1;
        case r'SharedSpaceAlbumHiddenV1': return SyncEntityType.sharedSpaceAlbumHiddenV1;
        case r'SharedSpaceAlbumHiddenDeleteV1': return SyncEntityType.sharedSpaceAlbumHiddenDeleteV1;
        case r'SharedSpaceAlbumHiddenBackfillV1': return SyncEntityType.sharedSpaceAlbumHiddenBackfillV1;
        case r'SharedSpaceAlbumToAssetV1': return SyncEntityType.sharedSpaceAlbumToAssetV1;
        case r'SharedSpaceAlbumToAssetDeleteV1': return SyncEntityType.sharedSpaceAlbumToAssetDeleteV1;
        case r'SharedSpaceAlbumToAssetBackfillV1': return SyncEntityType.sharedSpaceAlbumToAssetBackfillV1;
        case r'SharedSpaceAlbumAssetCreateV1': return SyncEntityType.sharedSpaceAlbumAssetCreateV1;
        case r'SharedSpaceAlbumAssetUpdateV1': return SyncEntityType.sharedSpaceAlbumAssetUpdateV1;
        case r'SharedSpaceAlbumAssetBackfillV1': return SyncEntityType.sharedSpaceAlbumAssetBackfillV1;
        case r'SharedSpaceAlbumAssetExifCreateV1': return SyncEntityType.sharedSpaceAlbumAssetExifCreateV1;
        case r'SharedSpaceAlbumAssetExifUpdateV1': return SyncEntityType.sharedSpaceAlbumAssetExifUpdateV1;
        case r'SharedSpaceAlbumAssetExifBackfillV1': return SyncEntityType.sharedSpaceAlbumAssetExifBackfillV1;
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

  /// The singleton instance of this transformer.
  static SyncEntityTypeTypeTransformer? _instance;
}


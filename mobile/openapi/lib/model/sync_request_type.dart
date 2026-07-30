//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Sync request type
enum SyncRequestType {
  albumsV1._(r'AlbumsV1'),
  albumsV2._(r'AlbumsV2'),
  albumUsersV1._(r'AlbumUsersV1'),
  albumToAssetsV1._(r'AlbumToAssetsV1'),
  albumAssetsV1._(r'AlbumAssetsV1'),
  albumAssetsV2._(r'AlbumAssetsV2'),
  albumAssetExifsV1._(r'AlbumAssetExifsV1'),
  assetsV1._(r'AssetsV1'),
  assetsV2._(r'AssetsV2'),
  assetExifsV1._(r'AssetExifsV1'),
  assetEditsV1._(r'AssetEditsV1'),
  assetMetadataV1._(r'AssetMetadataV1'),
  assetOcrV1._(r'AssetOcrV1'),
  assetFavoritesV1._(r'AssetFavoritesV1'),
  authUsersV1._(r'AuthUsersV1'),
  memoriesV1._(r'MemoriesV1'),
  memoryToAssetsV1._(r'MemoryToAssetsV1'),
  partnersV1._(r'PartnersV1'),
  partnerAssetsV1._(r'PartnerAssetsV1'),
  partnerAssetsV2._(r'PartnerAssetsV2'),
  partnerAssetExifsV1._(r'PartnerAssetExifsV1'),
  partnerStacksV1._(r'PartnerStacksV1'),
  stacksV1._(r'StacksV1'),
  usersV1._(r'UsersV1'),
  peopleV1._(r'PeopleV1'),
  assetFacesV1._(r'AssetFacesV1'),
  assetFacesV2._(r'AssetFacesV2'),
  userMetadataV1._(r'UserMetadataV1'),
  sharedSpacesV1._(r'SharedSpacesV1'),
  sharedSpaceMembersV1._(r'SharedSpaceMembersV1'),
  sharedSpaceAssetsV1._(r'SharedSpaceAssetsV1'),
  sharedSpaceAssetExifsV1._(r'SharedSpaceAssetExifsV1'),
  sharedSpaceToAssetsV1._(r'SharedSpaceToAssetsV1'),
  librariesV1._(r'LibrariesV1'),
  libraryAssetsV1._(r'LibraryAssetsV1'),
  libraryAssetExifsV1._(r'LibraryAssetExifsV1'),
  sharedSpaceLibrariesV1._(r'SharedSpaceLibrariesV1'),
  sharedSpaceAlbumsV1._(r'SharedSpaceAlbumsV1'),
  sharedSpaceAlbumLinksV1._(r'SharedSpaceAlbumLinksV1'),
  sharedSpaceAlbumFoldersV1._(r'SharedSpaceAlbumFoldersV1'),
  sharedSpaceAlbumToAssetsV1._(r'SharedSpaceAlbumToAssetsV1'),
  sharedSpaceAlbumAssetsV1._(r'SharedSpaceAlbumAssetsV1'),
  sharedSpaceAlbumAssetExifsV1._(r'SharedSpaceAlbumAssetExifsV1'),
  sharedSpaceAlbumHiddensV1._(r'SharedSpaceAlbumHiddensV1'),
  ;

  /// Instantiate a new enum with the provided value.
  const SyncRequestType._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [SyncRequestType] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static SyncRequestType? fromJson(dynamic value) => SyncRequestTypeTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [SyncRequestType]
  /// that were successfully decoded from the passed [JSON][json].
  static List<SyncRequestType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncRequestType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncRequestType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SyncRequestType] to String,
/// and [decode] dynamic data back to [SyncRequestType].
class SyncRequestTypeTypeTransformer {
  factory SyncRequestTypeTypeTransformer() => _instance ??= const SyncRequestTypeTypeTransformer._();

  const SyncRequestTypeTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(SyncRequestType data) => data._value;

  /// Returns the instance of [SyncRequestType] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SyncRequestType? decode(dynamic data, {bool allowNull = true}) {
    if (data is SyncRequestType) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'AlbumsV1': return SyncRequestType.albumsV1;
        case r'AlbumsV2': return SyncRequestType.albumsV2;
        case r'AlbumUsersV1': return SyncRequestType.albumUsersV1;
        case r'AlbumToAssetsV1': return SyncRequestType.albumToAssetsV1;
        case r'AlbumAssetsV1': return SyncRequestType.albumAssetsV1;
        case r'AlbumAssetsV2': return SyncRequestType.albumAssetsV2;
        case r'AlbumAssetExifsV1': return SyncRequestType.albumAssetExifsV1;
        case r'AssetsV1': return SyncRequestType.assetsV1;
        case r'AssetsV2': return SyncRequestType.assetsV2;
        case r'AssetExifsV1': return SyncRequestType.assetExifsV1;
        case r'AssetEditsV1': return SyncRequestType.assetEditsV1;
        case r'AssetMetadataV1': return SyncRequestType.assetMetadataV1;
        case r'AssetOcrV1': return SyncRequestType.assetOcrV1;
        case r'AssetFavoritesV1': return SyncRequestType.assetFavoritesV1;
        case r'AuthUsersV1': return SyncRequestType.authUsersV1;
        case r'MemoriesV1': return SyncRequestType.memoriesV1;
        case r'MemoryToAssetsV1': return SyncRequestType.memoryToAssetsV1;
        case r'PartnersV1': return SyncRequestType.partnersV1;
        case r'PartnerAssetsV1': return SyncRequestType.partnerAssetsV1;
        case r'PartnerAssetsV2': return SyncRequestType.partnerAssetsV2;
        case r'PartnerAssetExifsV1': return SyncRequestType.partnerAssetExifsV1;
        case r'PartnerStacksV1': return SyncRequestType.partnerStacksV1;
        case r'StacksV1': return SyncRequestType.stacksV1;
        case r'UsersV1': return SyncRequestType.usersV1;
        case r'PeopleV1': return SyncRequestType.peopleV1;
        case r'AssetFacesV1': return SyncRequestType.assetFacesV1;
        case r'AssetFacesV2': return SyncRequestType.assetFacesV2;
        case r'UserMetadataV1': return SyncRequestType.userMetadataV1;
        case r'SharedSpacesV1': return SyncRequestType.sharedSpacesV1;
        case r'SharedSpaceMembersV1': return SyncRequestType.sharedSpaceMembersV1;
        case r'SharedSpaceAssetsV1': return SyncRequestType.sharedSpaceAssetsV1;
        case r'SharedSpaceAssetExifsV1': return SyncRequestType.sharedSpaceAssetExifsV1;
        case r'SharedSpaceToAssetsV1': return SyncRequestType.sharedSpaceToAssetsV1;
        case r'LibrariesV1': return SyncRequestType.librariesV1;
        case r'LibraryAssetsV1': return SyncRequestType.libraryAssetsV1;
        case r'LibraryAssetExifsV1': return SyncRequestType.libraryAssetExifsV1;
        case r'SharedSpaceLibrariesV1': return SyncRequestType.sharedSpaceLibrariesV1;
        case r'SharedSpaceAlbumsV1': return SyncRequestType.sharedSpaceAlbumsV1;
        case r'SharedSpaceAlbumLinksV1': return SyncRequestType.sharedSpaceAlbumLinksV1;
        case r'SharedSpaceAlbumFoldersV1': return SyncRequestType.sharedSpaceAlbumFoldersV1;
        case r'SharedSpaceAlbumToAssetsV1': return SyncRequestType.sharedSpaceAlbumToAssetsV1;
        case r'SharedSpaceAlbumAssetsV1': return SyncRequestType.sharedSpaceAlbumAssetsV1;
        case r'SharedSpaceAlbumAssetExifsV1': return SyncRequestType.sharedSpaceAlbumAssetExifsV1;
        case r'SharedSpaceAlbumHiddensV1': return SyncRequestType.sharedSpaceAlbumHiddensV1;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static SyncRequestTypeTypeTransformer? _instance;
}


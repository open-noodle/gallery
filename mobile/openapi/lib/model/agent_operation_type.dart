//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const albumPeriodCreate = AgentOperationType._(r'album.create');
  static const albumPeriodAddAssets = AgentOperationType._(r'album.addAssets');
  static const albumPeriodRemoveAssets = AgentOperationType._(r'album.removeAssets');
  static const albumPeriodUpdateDetails = AgentOperationType._(r'album.updateDetails');
  static const albumPeriodSetCover = AgentOperationType._(r'album.setCover');
  static const albumPeriodAddUsers = AgentOperationType._(r'album.addUsers');
  static const albumPeriodRemoveUsers = AgentOperationType._(r'album.removeUsers');
  static const albumPeriodUpdateUserRole = AgentOperationType._(r'album.updateUserRole');
  static const albumPeriodDelete = AgentOperationType._(r'album.delete');
  static const spacePeriodCreate = AgentOperationType._(r'space.create');
  static const spacePeriodAddAssets = AgentOperationType._(r'space.addAssets');
  static const spacePeriodRemoveAssets = AgentOperationType._(r'space.removeAssets');
  static const spacePeriodUpdateDetails = AgentOperationType._(r'space.updateDetails');
  static const spacePeriodAddMembers = AgentOperationType._(r'space.addMembers');
  static const spacePeriodRemoveMembers = AgentOperationType._(r'space.removeMembers');
  static const spacePeriodUpdateMemberRole = AgentOperationType._(r'space.updateMemberRole');
  static const spacePeriodDelete = AgentOperationType._(r'space.delete');
  static const assetPeriodRotate = AgentOperationType._(r'asset.rotate');
  static const assetPeriodCrop = AgentOperationType._(r'asset.crop');
  static const assetPeriodAdjust = AgentOperationType._(r'asset.adjust');
  static const assetPeriodFlip = AgentOperationType._(r'asset.flip');
  static const assetPeriodStack = AgentOperationType._(r'asset.stack');
  static const assetPeriodUnstack = AgentOperationType._(r'asset.unstack');
  static const assetPeriodSetFavorite = AgentOperationType._(r'asset.setFavorite');
  static const assetPeriodSetArchive = AgentOperationType._(r'asset.setArchive');
  static const assetPeriodSetVisibility = AgentOperationType._(r'asset.setVisibility');
  static const assetPeriodUpdateMetadata = AgentOperationType._(r'asset.updateMetadata');
  static const assetPeriodAddTag = AgentOperationType._(r'asset.addTag');
  static const assetPeriodRemoveTag = AgentOperationType._(r'asset.removeTag');
  static const assetPeriodTrash = AgentOperationType._(r'asset.trash');
  static const assetPeriodRestore = AgentOperationType._(r'asset.restore');
  static const shareLinkPeriodCreate = AgentOperationType._(r'shareLink.create');
  static const shareLinkPeriodCreateAlbum = AgentOperationType._(r'shareLink.createAlbum');
  static const personPeriodUpdate = AgentOperationType._(r'person.update');
  static const personPeriodMerge = AgentOperationType._(r'person.merge');

  /// List of all possible values in this [enum][AgentOperationType].
  static const values = <AgentOperationType>[
    albumPeriodCreate,
    albumPeriodAddAssets,
    albumPeriodRemoveAssets,
    albumPeriodUpdateDetails,
    albumPeriodSetCover,
    albumPeriodAddUsers,
    albumPeriodRemoveUsers,
    albumPeriodUpdateUserRole,
    albumPeriodDelete,
    spacePeriodCreate,
    spacePeriodAddAssets,
    spacePeriodRemoveAssets,
    spacePeriodUpdateDetails,
    spacePeriodAddMembers,
    spacePeriodRemoveMembers,
    spacePeriodUpdateMemberRole,
    spacePeriodDelete,
    assetPeriodRotate,
    assetPeriodCrop,
    assetPeriodAdjust,
    assetPeriodFlip,
    assetPeriodStack,
    assetPeriodUnstack,
    assetPeriodSetFavorite,
    assetPeriodSetArchive,
    assetPeriodSetVisibility,
    assetPeriodUpdateMetadata,
    assetPeriodAddTag,
    assetPeriodRemoveTag,
    assetPeriodTrash,
    assetPeriodRestore,
    shareLinkPeriodCreate,
    shareLinkPeriodCreateAlbum,
    personPeriodUpdate,
    personPeriodMerge,
  ];

  static AgentOperationType? fromJson(dynamic value) => AgentOperationTypeTypeTransformer().decode(value);

  static List<AgentOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationType] to String,
/// and [decode] dynamic data back to [AgentOperationType].
class AgentOperationTypeTypeTransformer {
  factory AgentOperationTypeTypeTransformer() => _instance ??= const AgentOperationTypeTypeTransformer._();

  const AgentOperationTypeTypeTransformer._();

  String encode(AgentOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'album.create': return AgentOperationType.albumPeriodCreate;
        case r'album.addAssets': return AgentOperationType.albumPeriodAddAssets;
        case r'album.removeAssets': return AgentOperationType.albumPeriodRemoveAssets;
        case r'album.updateDetails': return AgentOperationType.albumPeriodUpdateDetails;
        case r'album.setCover': return AgentOperationType.albumPeriodSetCover;
        case r'album.addUsers': return AgentOperationType.albumPeriodAddUsers;
        case r'album.removeUsers': return AgentOperationType.albumPeriodRemoveUsers;
        case r'album.updateUserRole': return AgentOperationType.albumPeriodUpdateUserRole;
        case r'album.delete': return AgentOperationType.albumPeriodDelete;
        case r'space.create': return AgentOperationType.spacePeriodCreate;
        case r'space.addAssets': return AgentOperationType.spacePeriodAddAssets;
        case r'space.removeAssets': return AgentOperationType.spacePeriodRemoveAssets;
        case r'space.updateDetails': return AgentOperationType.spacePeriodUpdateDetails;
        case r'space.addMembers': return AgentOperationType.spacePeriodAddMembers;
        case r'space.removeMembers': return AgentOperationType.spacePeriodRemoveMembers;
        case r'space.updateMemberRole': return AgentOperationType.spacePeriodUpdateMemberRole;
        case r'space.delete': return AgentOperationType.spacePeriodDelete;
        case r'asset.rotate': return AgentOperationType.assetPeriodRotate;
        case r'asset.crop': return AgentOperationType.assetPeriodCrop;
        case r'asset.adjust': return AgentOperationType.assetPeriodAdjust;
        case r'asset.flip': return AgentOperationType.assetPeriodFlip;
        case r'asset.stack': return AgentOperationType.assetPeriodStack;
        case r'asset.unstack': return AgentOperationType.assetPeriodUnstack;
        case r'asset.setFavorite': return AgentOperationType.assetPeriodSetFavorite;
        case r'asset.setArchive': return AgentOperationType.assetPeriodSetArchive;
        case r'asset.setVisibility': return AgentOperationType.assetPeriodSetVisibility;
        case r'asset.updateMetadata': return AgentOperationType.assetPeriodUpdateMetadata;
        case r'asset.addTag': return AgentOperationType.assetPeriodAddTag;
        case r'asset.removeTag': return AgentOperationType.assetPeriodRemoveTag;
        case r'asset.trash': return AgentOperationType.assetPeriodTrash;
        case r'asset.restore': return AgentOperationType.assetPeriodRestore;
        case r'shareLink.create': return AgentOperationType.shareLinkPeriodCreate;
        case r'shareLink.createAlbum': return AgentOperationType.shareLinkPeriodCreateAlbum;
        case r'person.update': return AgentOperationType.personPeriodUpdate;
        case r'person.merge': return AgentOperationType.personPeriodMerge;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationTypeTypeTransformer] instance.
  static AgentOperationTypeTypeTransformer? _instance;
}


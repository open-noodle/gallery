//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentOperationType {
  albumPeriodCreate._(r'album.create'),
  albumPeriodAddAssets._(r'album.addAssets'),
  albumPeriodRemoveAssets._(r'album.removeAssets'),
  albumPeriodUpdateDetails._(r'album.updateDetails'),
  albumPeriodSetCover._(r'album.setCover'),
  albumPeriodAddUsers._(r'album.addUsers'),
  albumPeriodRemoveUsers._(r'album.removeUsers'),
  albumPeriodUpdateUserRole._(r'album.updateUserRole'),
  albumPeriodDelete._(r'album.delete'),
  spacePeriodCreate._(r'space.create'),
  spacePeriodAddAssets._(r'space.addAssets'),
  spacePeriodRemoveAssets._(r'space.removeAssets'),
  spacePeriodUpdateDetails._(r'space.updateDetails'),
  spacePeriodAddMembers._(r'space.addMembers'),
  spacePeriodRemoveMembers._(r'space.removeMembers'),
  spacePeriodUpdateMemberRole._(r'space.updateMemberRole'),
  spacePeriodDelete._(r'space.delete'),
  assetPeriodRotate._(r'asset.rotate'),
  assetPeriodCrop._(r'asset.crop'),
  assetPeriodAdjust._(r'asset.adjust'),
  assetPeriodFlip._(r'asset.flip'),
  assetPeriodStack._(r'asset.stack'),
  assetPeriodUnstack._(r'asset.unstack'),
  assetPeriodSetFavorite._(r'asset.setFavorite'),
  assetPeriodSetArchive._(r'asset.setArchive'),
  assetPeriodSetVisibility._(r'asset.setVisibility'),
  assetPeriodUpdateMetadata._(r'asset.updateMetadata'),
  assetPeriodAddTag._(r'asset.addTag'),
  assetPeriodRemoveTag._(r'asset.removeTag'),
  assetPeriodTrash._(r'asset.trash'),
  assetPeriodRestore._(r'asset.restore'),
  shareLinkPeriodCreate._(r'shareLink.create'),
  shareLinkPeriodCreateAlbum._(r'shareLink.createAlbum'),
  personPeriodUpdate._(r'person.update'),
  personPeriodMerge._(r'person.merge'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentOperationType._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentOperationType] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentOperationType? fromJson(dynamic value) => AgentOperationTypeTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentOperationType]
  /// that were successfully decoded from the passed [JSON][json].
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

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentOperationType data) => data._value;

  /// Returns the instance of [AgentOperationType] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentOperationType) {
      return data;
    }
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

  /// The singleton instance of this transformer.
  static AgentOperationTypeTypeTransformer? _instance;
}


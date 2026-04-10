//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncSharedSpaceV1 {
  /// Returns a new [SyncSharedSpaceV1] instance.
  SyncSharedSpaceV1({
    required this.color,
    required this.createdAt,
    required this.createdById,
    required this.description,
    required this.faceRecognitionEnabled,
    required this.id,
    required this.lastActivityAt,
    required this.name,
    required this.petsEnabled,
    required this.thumbnailAssetId,
    required this.thumbnailCropY,
    required this.updatedAt,
  });

  /// Color
  String? color;

  /// Created at
  DateTime createdAt;

  /// Created by user ID
  String createdById;

  /// Space description
  String? description;

  /// Face recognition enabled
  bool faceRecognitionEnabled;

  /// Shared space ID
  String id;

  /// Last activity timestamp
  DateTime? lastActivityAt;

  /// Space name
  String name;

  /// Pets enabled
  bool petsEnabled;

  /// Thumbnail asset ID
  String? thumbnailAssetId;

  /// Thumbnail crop Y offset
  num? thumbnailCropY;

  /// Updated at
  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncSharedSpaceV1 &&
    other.color == color &&
    other.createdAt == createdAt &&
    other.createdById == createdById &&
    other.description == description &&
    other.faceRecognitionEnabled == faceRecognitionEnabled &&
    other.id == id &&
    other.lastActivityAt == lastActivityAt &&
    other.name == name &&
    other.petsEnabled == petsEnabled &&
    other.thumbnailAssetId == thumbnailAssetId &&
    other.thumbnailCropY == thumbnailCropY &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (color == null ? 0 : color!.hashCode) +
    (createdAt.hashCode) +
    (createdById.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (faceRecognitionEnabled.hashCode) +
    (id.hashCode) +
    (lastActivityAt == null ? 0 : lastActivityAt!.hashCode) +
    (name.hashCode) +
    (petsEnabled.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode) +
    (thumbnailCropY == null ? 0 : thumbnailCropY!.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SyncSharedSpaceV1[color=$color, createdAt=$createdAt, createdById=$createdById, description=$description, faceRecognitionEnabled=$faceRecognitionEnabled, id=$id, lastActivityAt=$lastActivityAt, name=$name, petsEnabled=$petsEnabled, thumbnailAssetId=$thumbnailAssetId, thumbnailCropY=$thumbnailCropY, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.color != null) {
      json[r'color'] = this.color;
    } else {
    //  json[r'color'] = null;
    }
      json[r'createdAt'] = this.createdAt.toUtc().toIso8601String();
      json[r'createdById'] = this.createdById;
    if (this.description != null) {
      json[r'description'] = this.description;
    } else {
    //  json[r'description'] = null;
    }
      json[r'faceRecognitionEnabled'] = this.faceRecognitionEnabled;
      json[r'id'] = this.id;
    if (this.lastActivityAt != null) {
      json[r'lastActivityAt'] = this.lastActivityAt!.toUtc().toIso8601String();
    } else {
    //  json[r'lastActivityAt'] = null;
    }
      json[r'name'] = this.name;
      json[r'petsEnabled'] = this.petsEnabled;
    if (this.thumbnailAssetId != null) {
      json[r'thumbnailAssetId'] = this.thumbnailAssetId;
    } else {
    //  json[r'thumbnailAssetId'] = null;
    }
    if (this.thumbnailCropY != null) {
      json[r'thumbnailCropY'] = this.thumbnailCropY;
    } else {
    //  json[r'thumbnailCropY'] = null;
    }
      json[r'updatedAt'] = this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [SyncSharedSpaceV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncSharedSpaceV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncSharedSpaceV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncSharedSpaceV1(
        color: mapValueOfType<String>(json, r'color'),
        createdAt: mapDateTime(json, r'createdAt', r'')!,
        createdById: mapValueOfType<String>(json, r'createdById')!,
        description: mapValueOfType<String>(json, r'description'),
        faceRecognitionEnabled: mapValueOfType<bool>(json, r'faceRecognitionEnabled')!,
        id: mapValueOfType<String>(json, r'id')!,
        lastActivityAt: mapDateTime(json, r'lastActivityAt', r''),
        name: mapValueOfType<String>(json, r'name')!,
        petsEnabled: mapValueOfType<bool>(json, r'petsEnabled')!,
        thumbnailAssetId: mapValueOfType<String>(json, r'thumbnailAssetId'),
        thumbnailCropY: json[r'thumbnailCropY'] == null
            ? null
            : num.parse('${json[r'thumbnailCropY']}'),
        updatedAt: mapDateTime(json, r'updatedAt', r'')!,
      );
    }
    return null;
  }

  static List<SyncSharedSpaceV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncSharedSpaceV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncSharedSpaceV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncSharedSpaceV1> mapFromJson(dynamic json) {
    final map = <String, SyncSharedSpaceV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncSharedSpaceV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncSharedSpaceV1-objects as value to a dart map
  static Map<String, List<SyncSharedSpaceV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncSharedSpaceV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncSharedSpaceV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'color',
    'createdAt',
    'createdById',
    'description',
    'faceRecognitionEnabled',
    'id',
    'lastActivityAt',
    'name',
    'petsEnabled',
    'thumbnailAssetId',
    'thumbnailCropY',
    'updatedAt',
  };
}


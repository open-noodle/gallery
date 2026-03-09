//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceResponseDto {
  /// Returns a new [SharedSpaceResponseDto] instance.
  SharedSpaceResponseDto({
    this.assetCount,
    required this.createdAt,
    required this.createdById,
    this.description,
    required this.id,
    this.memberCount,
    this.members = const [],
    required this.name,
    this.thumbnailAssetId,
    required this.updatedAt,
  });

  /// Number of assets
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? assetCount;

  /// Creation date
  String createdAt;

  /// Creator user ID
  String createdById;

  /// Space description
  String? description;

  /// Space ID
  String id;

  /// Number of members
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? memberCount;

  /// Space members (summary)
  List<SharedSpaceMemberResponseDto> members;

  /// Space name
  String name;

  /// Thumbnail asset ID
  String? thumbnailAssetId;

  /// Last update date
  String updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceResponseDto &&
    other.assetCount == assetCount &&
    other.createdAt == createdAt &&
    other.createdById == createdById &&
    other.description == description &&
    other.id == id &&
    other.memberCount == memberCount &&
    _deepEquality.equals(other.members, members) &&
    other.name == name &&
    other.thumbnailAssetId == thumbnailAssetId &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetCount == null ? 0 : assetCount!.hashCode) +
    (createdAt.hashCode) +
    (createdById.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (id.hashCode) +
    (memberCount == null ? 0 : memberCount!.hashCode) +
    (members.hashCode) +
    (name.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SharedSpaceResponseDto[assetCount=$assetCount, createdAt=$createdAt, createdById=$createdById, description=$description, id=$id, memberCount=$memberCount, members=$members, name=$name, thumbnailAssetId=$thumbnailAssetId, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.assetCount != null) {
      json[r'assetCount'] = this.assetCount;
    } else {
    //  json[r'assetCount'] = null;
    }
      json[r'createdAt'] = this.createdAt;
      json[r'createdById'] = this.createdById;
    if (this.description != null) {
      json[r'description'] = this.description;
    } else {
    //  json[r'description'] = null;
    }
      json[r'id'] = this.id;
    if (this.memberCount != null) {
      json[r'memberCount'] = this.memberCount;
    } else {
    //  json[r'memberCount'] = null;
    }
      json[r'members'] = this.members;
      json[r'name'] = this.name;
    if (this.thumbnailAssetId != null) {
      json[r'thumbnailAssetId'] = this.thumbnailAssetId;
    } else {
    //  json[r'thumbnailAssetId'] = null;
    }
      json[r'updatedAt'] = this.updatedAt;
    return json;
  }

  /// Returns a new [SharedSpaceResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceResponseDto(
        assetCount: json[r'assetCount'] == null
            ? null
            : num.parse('${json[r'assetCount']}'),
        createdAt: mapValueOfType<String>(json, r'createdAt')!,
        createdById: mapValueOfType<String>(json, r'createdById')!,
        description: mapValueOfType<String>(json, r'description'),
        id: mapValueOfType<String>(json, r'id')!,
        memberCount: json[r'memberCount'] == null
            ? null
            : num.parse('${json[r'memberCount']}'),
        members: SharedSpaceMemberResponseDto.listFromJson(json[r'members']),
        name: mapValueOfType<String>(json, r'name')!,
        thumbnailAssetId: mapValueOfType<String>(json, r'thumbnailAssetId'),
        updatedAt: mapValueOfType<String>(json, r'updatedAt')!,
      );
    }
    return null;
  }

  static List<SharedSpaceResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceResponseDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceResponseDto-objects as value to a dart map
  static Map<String, List<SharedSpaceResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'createdAt',
    'createdById',
    'id',
    'name',
    'updatedAt',
  };
}


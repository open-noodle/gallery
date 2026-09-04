//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceAlbumFolderDto {
  /// Returns a new [SharedSpaceAlbumFolderDto] instance.
  SharedSpaceAlbumFolderDto({
    required this.createdAt,
    required this.createdById,
    required this.id,
    required this.name,
    required this.parentId,
    required this.spaceId,
    required this.updatedAt,
  });

  DateTime createdAt;

  /// User who created the folder
  String? createdById;

  /// Folder ID
  String id;

  /// Folder name
  String name;

  /// Parent folder ID, or null when at the space root
  String? parentId;

  /// Shared space ID
  String spaceId;

  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceAlbumFolderDto &&
    other.createdAt == createdAt &&
    other.createdById == createdById &&
    other.id == id &&
    other.name == name &&
    other.parentId == parentId &&
    other.spaceId == spaceId &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (createdAt.hashCode) +
    (createdById == null ? 0 : createdById!.hashCode) +
    (id.hashCode) +
    (name.hashCode) +
    (parentId == null ? 0 : parentId!.hashCode) +
    (spaceId.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SharedSpaceAlbumFolderDto[createdAt=$createdAt, createdById=$createdById, id=$id, name=$name, parentId=$parentId, spaceId=$spaceId, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'createdAt'] = this.createdAt.toUtc().toIso8601String();
    if (this.createdById != null) {
      json[r'createdById'] = this.createdById;
    } else {
      json[r'createdById'] = null;
    }
      json[r'id'] = this.id;
      json[r'name'] = this.name;
    if (this.parentId != null) {
      json[r'parentId'] = this.parentId;
    } else {
      json[r'parentId'] = null;
    }
      json[r'spaceId'] = this.spaceId;
      json[r'updatedAt'] = this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [SharedSpaceAlbumFolderDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceAlbumFolderDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceAlbumFolderDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceAlbumFolderDto(
        createdAt: mapDateTime(json, r'createdAt', r'')!,
        createdById: mapValueOfType<String>(json, r'createdById'),
        id: mapValueOfType<String>(json, r'id')!,
        name: mapValueOfType<String>(json, r'name')!,
        parentId: mapValueOfType<String>(json, r'parentId'),
        spaceId: mapValueOfType<String>(json, r'spaceId')!,
        updatedAt: mapDateTime(json, r'updatedAt', r'')!,
      );
    }
    return null;
  }

  static List<SharedSpaceAlbumFolderDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceAlbumFolderDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceAlbumFolderDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceAlbumFolderDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceAlbumFolderDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceAlbumFolderDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceAlbumFolderDto-objects as value to a dart map
  static Map<String, List<SharedSpaceAlbumFolderDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceAlbumFolderDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceAlbumFolderDto.listFromJson(entry.value, growable: growable,);
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
    'parentId',
    'spaceId',
    'updatedAt',
  };
}


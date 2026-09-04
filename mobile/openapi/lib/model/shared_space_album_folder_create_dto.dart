//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceAlbumFolderCreateDto {
  /// Returns a new [SharedSpaceAlbumFolderCreateDto] instance.
  SharedSpaceAlbumFolderCreateDto({
    required this.name,
    this.parentId = const Optional.absent(),
  });

  /// Folder name
  String name;

  /// Parent folder ID; omit or null for the space root
  Optional<String?> parentId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceAlbumFolderCreateDto &&
    other.name == name &&
    other.parentId == parentId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name.hashCode) +
    (parentId == null ? 0 : parentId!.hashCode);

  @override
  String toString() => 'SharedSpaceAlbumFolderCreateDto[name=$name, parentId=$parentId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'name'] = this.name;
    if (this.parentId.isPresent) {
      final value = this.parentId.value;
      json[r'parentId'] = value;
    }
    return json;
  }

  /// Returns a new [SharedSpaceAlbumFolderCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceAlbumFolderCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceAlbumFolderCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceAlbumFolderCreateDto(
        name: mapValueOfType<String>(json, r'name')!,
        parentId: json.containsKey(r'parentId') ? Optional.present(mapValueOfType<String>(json, r'parentId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<SharedSpaceAlbumFolderCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceAlbumFolderCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceAlbumFolderCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceAlbumFolderCreateDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceAlbumFolderCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceAlbumFolderCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceAlbumFolderCreateDto-objects as value to a dart map
  static Map<String, List<SharedSpaceAlbumFolderCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceAlbumFolderCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceAlbumFolderCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'name',
  };
}


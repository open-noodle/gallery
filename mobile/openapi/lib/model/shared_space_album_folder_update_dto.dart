//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceAlbumFolderUpdateDto {
  /// Returns a new [SharedSpaceAlbumFolderUpdateDto] instance.
  SharedSpaceAlbumFolderUpdateDto({
    this.name = const Optional.absent(),
    this.parentId = const Optional.absent(),
  });

  /// New folder name
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> name;

  /// New parent folder ID; null moves the folder to the space root
  Optional<String?> parentId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceAlbumFolderUpdateDto &&
    other.name == name &&
    other.parentId == parentId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name == null ? 0 : name!.hashCode) +
    (parentId == null ? 0 : parentId!.hashCode);

  @override
  String toString() => 'SharedSpaceAlbumFolderUpdateDto[name=$name, parentId=$parentId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.name.isPresent) {
      final value = this.name.value;
      json[r'name'] = value;
    }
    if (this.parentId.isPresent) {
      final value = this.parentId.value;
      json[r'parentId'] = value;
    }
    return json;
  }

  /// Returns a new [SharedSpaceAlbumFolderUpdateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceAlbumFolderUpdateDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceAlbumFolderUpdateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceAlbumFolderUpdateDto(
        name: json.containsKey(r'name') ? Optional.present(mapValueOfType<String>(json, r'name')) : const Optional.absent(),
        parentId: json.containsKey(r'parentId') ? Optional.present(mapValueOfType<String>(json, r'parentId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<SharedSpaceAlbumFolderUpdateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceAlbumFolderUpdateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceAlbumFolderUpdateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceAlbumFolderUpdateDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceAlbumFolderUpdateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceAlbumFolderUpdateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceAlbumFolderUpdateDto-objects as value to a dart map
  static Map<String, List<SharedSpaceAlbumFolderUpdateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceAlbumFolderUpdateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceAlbumFolderUpdateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


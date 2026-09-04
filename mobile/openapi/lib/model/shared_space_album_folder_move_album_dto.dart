//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceAlbumFolderMoveAlbumDto {
  /// Returns a new [SharedSpaceAlbumFolderMoveAlbumDto] instance.
  SharedSpaceAlbumFolderMoveAlbumDto({
    required this.folderId,
  });

  /// Destination folder ID; null moves the album to the space root
  String? folderId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceAlbumFolderMoveAlbumDto &&
    other.folderId == folderId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (folderId == null ? 0 : folderId!.hashCode);

  @override
  String toString() => 'SharedSpaceAlbumFolderMoveAlbumDto[folderId=$folderId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.folderId != null) {
      json[r'folderId'] = this.folderId;
    } else {
      json[r'folderId'] = null;
    }
    return json;
  }

  /// Returns a new [SharedSpaceAlbumFolderMoveAlbumDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceAlbumFolderMoveAlbumDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceAlbumFolderMoveAlbumDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceAlbumFolderMoveAlbumDto(
        folderId: mapValueOfType<String>(json, r'folderId'),
      );
    }
    return null;
  }

  static List<SharedSpaceAlbumFolderMoveAlbumDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceAlbumFolderMoveAlbumDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceAlbumFolderMoveAlbumDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceAlbumFolderMoveAlbumDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceAlbumFolderMoveAlbumDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceAlbumFolderMoveAlbumDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceAlbumFolderMoveAlbumDto-objects as value to a dart map
  static Map<String, List<SharedSpaceAlbumFolderMoveAlbumDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceAlbumFolderMoveAlbumDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceAlbumFolderMoveAlbumDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'folderId',
  };
}


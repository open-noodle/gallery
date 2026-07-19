//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceAssetLinkedAlbumDto {
  /// Returns a new [SharedSpaceAssetLinkedAlbumDto] instance.
  SharedSpaceAssetLinkedAlbumDto({
    required this.albumId,
    required this.albumName,
  });

  /// Album ID
  String albumId;

  /// Album name
  String albumName;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceAssetLinkedAlbumDto &&
    other.albumId == albumId &&
    other.albumName == albumName;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albumId.hashCode) +
    (albumName.hashCode);

  @override
  String toString() => 'SharedSpaceAssetLinkedAlbumDto[albumId=$albumId, albumName=$albumName]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albumId'] = this.albumId;
      json[r'albumName'] = this.albumName;
    return json;
  }

  /// Returns a new [SharedSpaceAssetLinkedAlbumDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceAssetLinkedAlbumDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceAssetLinkedAlbumDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceAssetLinkedAlbumDto(
        albumId: mapValueOfType<String>(json, r'albumId')!,
        albumName: mapValueOfType<String>(json, r'albumName')!,
      );
    }
    return null;
  }

  static List<SharedSpaceAssetLinkedAlbumDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceAssetLinkedAlbumDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceAssetLinkedAlbumDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceAssetLinkedAlbumDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceAssetLinkedAlbumDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceAssetLinkedAlbumDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceAssetLinkedAlbumDto-objects as value to a dart map
  static Map<String, List<SharedSpaceAssetLinkedAlbumDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceAssetLinkedAlbumDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceAssetLinkedAlbumDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albumId',
    'albumName',
  };
}


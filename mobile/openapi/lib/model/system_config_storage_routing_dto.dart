//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigStorageRoutingDto {
  /// Returns a new [SystemConfigStorageRoutingDto] instance.
  SystemConfigStorageRoutingDto({
    required this.encodedVideo,
    required this.originals,
    required this.thumbnails,
  });

  StorageRouting encodedVideo;

  StorageRouting originals;

  StorageRouting thumbnails;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigStorageRoutingDto &&
    other.encodedVideo == encodedVideo &&
    other.originals == originals &&
    other.thumbnails == thumbnails;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (encodedVideo.hashCode) +
    (originals.hashCode) +
    (thumbnails.hashCode);

  @override
  String toString() => 'SystemConfigStorageRoutingDto[encodedVideo=$encodedVideo, originals=$originals, thumbnails=$thumbnails]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'encodedVideo'] = this.encodedVideo;
      json[r'originals'] = this.originals;
      json[r'thumbnails'] = this.thumbnails;
    return json;
  }

  /// Returns a new [SystemConfigStorageRoutingDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigStorageRoutingDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigStorageRoutingDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigStorageRoutingDto(
        encodedVideo: StorageRouting.fromJson(json[r'encodedVideo'])!,
        originals: StorageRouting.fromJson(json[r'originals'])!,
        thumbnails: StorageRouting.fromJson(json[r'thumbnails'])!,
      );
    }
    return null;
  }

  static List<SystemConfigStorageRoutingDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigStorageRoutingDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigStorageRoutingDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigStorageRoutingDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigStorageRoutingDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigStorageRoutingDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigStorageRoutingDto-objects as value to a dart map
  static Map<String, List<SystemConfigStorageRoutingDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigStorageRoutingDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigStorageRoutingDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'encodedVideo',
    'originals',
    'thumbnails',
  };
}


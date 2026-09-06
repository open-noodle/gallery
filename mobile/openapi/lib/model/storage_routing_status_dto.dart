//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class StorageRoutingStatusDto {
  /// Returns a new [StorageRoutingStatusDto] instance.
  StorageRoutingStatusDto({
    required this.encodedVideo,
    required this.originals,
    required this.thumbnails,
  });

  StorageRoutingStatusEntryDto encodedVideo;

  StorageRoutingStatusEntryDto originals;

  StorageRoutingStatusEntryDto thumbnails;

  @override
  bool operator ==(Object other) => identical(this, other) || other is StorageRoutingStatusDto &&
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
  String toString() => 'StorageRoutingStatusDto[encodedVideo=$encodedVideo, originals=$originals, thumbnails=$thumbnails]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'encodedVideo'] = this.encodedVideo;
      json[r'originals'] = this.originals;
      json[r'thumbnails'] = this.thumbnails;
    return json;
  }

  /// Returns a new [StorageRoutingStatusDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static StorageRoutingStatusDto? fromJson(dynamic value) {
    upgradeDto(value, "StorageRoutingStatusDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return StorageRoutingStatusDto(
        encodedVideo: StorageRoutingStatusEntryDto.fromJson(json[r'encodedVideo'])!,
        originals: StorageRoutingStatusEntryDto.fromJson(json[r'originals'])!,
        thumbnails: StorageRoutingStatusEntryDto.fromJson(json[r'thumbnails'])!,
      );
    }
    return null;
  }

  static List<StorageRoutingStatusDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <StorageRoutingStatusDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = StorageRoutingStatusDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, StorageRoutingStatusDto> mapFromJson(dynamic json) {
    final map = <String, StorageRoutingStatusDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = StorageRoutingStatusDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of StorageRoutingStatusDto-objects as value to a dart map
  static Map<String, List<StorageRoutingStatusDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<StorageRoutingStatusDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = StorageRoutingStatusDto.listFromJson(entry.value, growable: growable,);
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


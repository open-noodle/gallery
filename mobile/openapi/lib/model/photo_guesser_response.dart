//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PhotoGuesserResponse {
  /// Returns a new [PhotoGuesserResponse] instance.
  PhotoGuesserResponse({
    required this.includePartners,
    required this.includeSpaces,
  });

  /// Whether PhotoGuesser solo rounds include partner photos
  bool includePartners;

  /// Whether PhotoGuesser solo rounds include shared-space photos
  bool includeSpaces;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PhotoGuesserResponse &&
    other.includePartners == includePartners &&
    other.includeSpaces == includeSpaces;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (includePartners.hashCode) +
    (includeSpaces.hashCode);

  @override
  String toString() => 'PhotoGuesserResponse[includePartners=$includePartners, includeSpaces=$includeSpaces]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'includePartners'] = this.includePartners;
      json[r'includeSpaces'] = this.includeSpaces;
    return json;
  }

  /// Returns a new [PhotoGuesserResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PhotoGuesserResponse? fromJson(dynamic value) {
    upgradeDto(value, "PhotoGuesserResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return PhotoGuesserResponse(
        includePartners: mapValueOfType<bool>(json, r'includePartners')!,
        includeSpaces: mapValueOfType<bool>(json, r'includeSpaces')!,
      );
    }
    return null;
  }

  static List<PhotoGuesserResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PhotoGuesserResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PhotoGuesserResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PhotoGuesserResponse> mapFromJson(dynamic json) {
    final map = <String, PhotoGuesserResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PhotoGuesserResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PhotoGuesserResponse-objects as value to a dart map
  static Map<String, List<PhotoGuesserResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PhotoGuesserResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PhotoGuesserResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'includePartners',
    'includeSpaces',
  };
}


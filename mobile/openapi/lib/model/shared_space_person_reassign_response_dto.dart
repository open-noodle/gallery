//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpacePersonReassignResponseDto {
  /// Returns a new [SharedSpacePersonReassignResponseDto] instance.
  SharedSpacePersonReassignResponseDto({
    required this.reassigned,
  });

  /// Number of faces actually reassigned
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int reassigned;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpacePersonReassignResponseDto &&
    other.reassigned == reassigned;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (reassigned.hashCode);

  @override
  String toString() => 'SharedSpacePersonReassignResponseDto[reassigned=$reassigned]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'reassigned'] = this.reassigned;
    return json;
  }

  /// Returns a new [SharedSpacePersonReassignResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpacePersonReassignResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpacePersonReassignResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpacePersonReassignResponseDto(
        reassigned: mapValueOfType<int>(json, r'reassigned')!,
      );
    }
    return null;
  }

  static List<SharedSpacePersonReassignResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonReassignResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonReassignResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpacePersonReassignResponseDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpacePersonReassignResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpacePersonReassignResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpacePersonReassignResponseDto-objects as value to a dart map
  static Map<String, List<SharedSpacePersonReassignResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpacePersonReassignResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpacePersonReassignResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'reassigned',
  };
}


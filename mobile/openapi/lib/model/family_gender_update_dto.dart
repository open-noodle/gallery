//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyGenderUpdateDto {
  /// Returns a new [FamilyGenderUpdateDto] instance.
  FamilyGenderUpdateDto({
    required this.gender,
  });

  /// Gender ('male' or 'female'), or null to clear
  String? gender;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyGenderUpdateDto &&
    other.gender == gender;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (gender == null ? 0 : gender!.hashCode);

  @override
  String toString() => 'FamilyGenderUpdateDto[gender=$gender]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.gender != null) {
      json[r'gender'] = this.gender;
    } else {
      json[r'gender'] = null;
    }
    return json;
  }

  /// Returns a new [FamilyGenderUpdateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyGenderUpdateDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyGenderUpdateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyGenderUpdateDto(
        gender: mapValueOfType<String>(json, r'gender'),
      );
    }
    return null;
  }

  static List<FamilyGenderUpdateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyGenderUpdateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyGenderUpdateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyGenderUpdateDto> mapFromJson(dynamic json) {
    final map = <String, FamilyGenderUpdateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyGenderUpdateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyGenderUpdateDto-objects as value to a dart map
  static Map<String, List<FamilyGenderUpdateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyGenderUpdateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyGenderUpdateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'gender',
  };
}


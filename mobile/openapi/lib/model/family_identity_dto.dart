//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyIdentityDto {
  /// Returns a new [FamilyIdentityDto] instance.
  FamilyIdentityDto({
    required this.gender,
    required this.label,
    required this.name,
  });

  /// Recorded gender ('male', 'female'), or null if unset
  String? gender;

  /// This identity's relation to the caller (\"your sister\"), or null
  String? label;

  /// Resolved display name
  String name;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyIdentityDto &&
    other.gender == gender &&
    other.label == label &&
    other.name == name;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (gender == null ? 0 : gender!.hashCode) +
    (label == null ? 0 : label!.hashCode) +
    (name.hashCode);

  @override
  String toString() => 'FamilyIdentityDto[gender=$gender, label=$label, name=$name]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.gender != null) {
      json[r'gender'] = this.gender;
    } else {
      json[r'gender'] = null;
    }
    if (this.label != null) {
      json[r'label'] = this.label;
    } else {
      json[r'label'] = null;
    }
      json[r'name'] = this.name;
    return json;
  }

  /// Returns a new [FamilyIdentityDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyIdentityDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyIdentityDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyIdentityDto(
        gender: mapValueOfType<String>(json, r'gender'),
        label: mapValueOfType<String>(json, r'label'),
        name: mapValueOfType<String>(json, r'name')!,
      );
    }
    return null;
  }

  static List<FamilyIdentityDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyIdentityDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyIdentityDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyIdentityDto> mapFromJson(dynamic json) {
    final map = <String, FamilyIdentityDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyIdentityDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyIdentityDto-objects as value to a dart map
  static Map<String, List<FamilyIdentityDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyIdentityDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyIdentityDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'gender',
    'label',
    'name',
  };
}


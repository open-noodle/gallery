//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyUnionCreateResponseDto {
  /// Returns a new [FamilyUnionCreateResponseDto] instance.
  FamilyUnionCreateResponseDto({
    required this.id,
  });

  String id;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyUnionCreateResponseDto &&
    other.id == id;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (id.hashCode);

  @override
  String toString() => 'FamilyUnionCreateResponseDto[id=$id]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'id'] = this.id;
    return json;
  }

  /// Returns a new [FamilyUnionCreateResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyUnionCreateResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyUnionCreateResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyUnionCreateResponseDto(
        id: mapValueOfType<String>(json, r'id')!,
      );
    }
    return null;
  }

  static List<FamilyUnionCreateResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyUnionCreateResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyUnionCreateResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyUnionCreateResponseDto> mapFromJson(dynamic json) {
    final map = <String, FamilyUnionCreateResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyUnionCreateResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyUnionCreateResponseDto-objects as value to a dart map
  static Map<String, List<FamilyUnionCreateResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyUnionCreateResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyUnionCreateResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'id',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyPersonRelationsResponseDto {
  /// Returns a new [FamilyPersonRelationsResponseDto] instance.
  FamilyPersonRelationsResponseDto({
    this.relations = const [],
  });

  List<FamilyPersonRelationDto> relations;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyPersonRelationsResponseDto &&
    _deepEquality.equals(other.relations, relations);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (relations.hashCode);

  @override
  String toString() => 'FamilyPersonRelationsResponseDto[relations=$relations]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'relations'] = this.relations;
    return json;
  }

  /// Returns a new [FamilyPersonRelationsResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyPersonRelationsResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyPersonRelationsResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyPersonRelationsResponseDto(
        relations: FamilyPersonRelationDto.listFromJson(json[r'relations']),
      );
    }
    return null;
  }

  static List<FamilyPersonRelationsResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyPersonRelationsResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyPersonRelationsResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyPersonRelationsResponseDto> mapFromJson(dynamic json) {
    final map = <String, FamilyPersonRelationsResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyPersonRelationsResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyPersonRelationsResponseDto-objects as value to a dart map
  static Map<String, List<FamilyPersonRelationsResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyPersonRelationsResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyPersonRelationsResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'relations',
  };
}


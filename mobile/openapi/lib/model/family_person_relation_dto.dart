//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyPersonRelationDto {
  /// Returns a new [FamilyPersonRelationDto] instance.
  FamilyPersonRelationDto({
    required this.anonymousSlot,
    required this.person,
    required this.relation,
  });

  /// Opaque per-union slot index, only present when person is null
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int? anonymousSlot;

  /// The related person, or null if the viewer cannot resolve them
  PersonResponseDto? person;

  /// How this participant relates to the requested person (e.g. 'parent')
  String relation;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyPersonRelationDto &&
    other.anonymousSlot == anonymousSlot &&
    other.person == person &&
    other.relation == relation;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (anonymousSlot == null ? 0 : anonymousSlot!.hashCode) +
    (person == null ? 0 : person!.hashCode) +
    (relation.hashCode);

  @override
  String toString() => 'FamilyPersonRelationDto[anonymousSlot=$anonymousSlot, person=$person, relation=$relation]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.anonymousSlot != null) {
      json[r'anonymousSlot'] = this.anonymousSlot;
    } else {
      json[r'anonymousSlot'] = null;
    }
    if (this.person != null) {
      json[r'person'] = this.person;
    } else {
      json[r'person'] = null;
    }
      json[r'relation'] = this.relation;
    return json;
  }

  /// Returns a new [FamilyPersonRelationDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyPersonRelationDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyPersonRelationDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyPersonRelationDto(
        anonymousSlot: mapValueOfType<int>(json, r'anonymousSlot'),
        person: PersonResponseDto.fromJson(json[r'person']),
        relation: mapValueOfType<String>(json, r'relation')!,
      );
    }
    return null;
  }

  static List<FamilyPersonRelationDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyPersonRelationDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyPersonRelationDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyPersonRelationDto> mapFromJson(dynamic json) {
    final map = <String, FamilyPersonRelationDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyPersonRelationDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyPersonRelationDto-objects as value to a dart map
  static Map<String, List<FamilyPersonRelationDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyPersonRelationDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyPersonRelationDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'anonymousSlot',
    'person',
    'relation',
  };
}


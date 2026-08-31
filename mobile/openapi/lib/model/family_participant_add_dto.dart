//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyParticipantAddDto {
  /// Returns a new [FamilyParticipantAddDto] instance.
  FamilyParticipantAddDto({
    required this.identityId,
    required this.role,
  });

  /// Identity ID to add to the union
  String identityId;

  FamilyParticipantRole role;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyParticipantAddDto &&
    other.identityId == identityId &&
    other.role == role;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (identityId.hashCode) +
    (role.hashCode);

  @override
  String toString() => 'FamilyParticipantAddDto[identityId=$identityId, role=$role]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'identityId'] = this.identityId;
      json[r'role'] = this.role;
    return json;
  }

  /// Returns a new [FamilyParticipantAddDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyParticipantAddDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyParticipantAddDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyParticipantAddDto(
        identityId: mapValueOfType<String>(json, r'identityId')!,
        role: FamilyParticipantRole.fromJson(json[r'role'])!,
      );
    }
    return null;
  }

  static List<FamilyParticipantAddDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyParticipantAddDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyParticipantAddDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyParticipantAddDto> mapFromJson(dynamic json) {
    final map = <String, FamilyParticipantAddDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyParticipantAddDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyParticipantAddDto-objects as value to a dart map
  static Map<String, List<FamilyParticipantAddDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyParticipantAddDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyParticipantAddDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'identityId',
    'role',
  };
}


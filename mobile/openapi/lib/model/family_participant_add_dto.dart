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
    this.identityId = const Optional.absent(),
    this.personId = const Optional.absent(),
    required this.role,
  });

  /// Identity ID to add to the union
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> identityId;

  /// Person ID to add, resolved to its identity
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> personId;

  FamilyParticipantRole role;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyParticipantAddDto &&
    other.identityId == identityId &&
    other.personId == personId &&
    other.role == role;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (identityId == null ? 0 : identityId!.hashCode) +
    (personId == null ? 0 : personId!.hashCode) +
    (role.hashCode);

  @override
  String toString() => 'FamilyParticipantAddDto[identityId=$identityId, personId=$personId, role=$role]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.identityId.isPresent) {
      final value = this.identityId.value;
      json[r'identityId'] = value;
    }
    if (this.personId.isPresent) {
      final value = this.personId.value;
      json[r'personId'] = value;
    }
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
        identityId: json.containsKey(r'identityId') ? Optional.present(mapValueOfType<String>(json, r'identityId')) : const Optional.absent(),
        personId: json.containsKey(r'personId') ? Optional.present(mapValueOfType<String>(json, r'personId')) : const Optional.absent(),
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
    'role',
  };
}


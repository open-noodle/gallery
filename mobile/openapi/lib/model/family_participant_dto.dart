//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyParticipantDto {
  /// Returns a new [FamilyParticipantDto] instance.
  FamilyParticipantDto({
    required this.identityId,
    required this.kind,
  });

  /// Identity ID when kind is 'known'; null when 'anonymous'
  String? identityId;

  FamilyParticipantKind kind;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyParticipantDto &&
    other.identityId == identityId &&
    other.kind == kind;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (identityId == null ? 0 : identityId!.hashCode) +
    (kind.hashCode);

  @override
  String toString() => 'FamilyParticipantDto[identityId=$identityId, kind=$kind]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.identityId != null) {
      json[r'identityId'] = this.identityId;
    } else {
      json[r'identityId'] = null;
    }
      json[r'kind'] = this.kind;
    return json;
  }

  /// Returns a new [FamilyParticipantDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyParticipantDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyParticipantDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyParticipantDto(
        identityId: mapValueOfType<String>(json, r'identityId'),
        kind: FamilyParticipantKind.fromJson(json[r'kind'])!,
      );
    }
    return null;
  }

  static List<FamilyParticipantDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyParticipantDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyParticipantDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyParticipantDto> mapFromJson(dynamic json) {
    final map = <String, FamilyParticipantDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyParticipantDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyParticipantDto-objects as value to a dart map
  static Map<String, List<FamilyParticipantDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyParticipantDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyParticipantDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'identityId',
    'kind',
  };
}


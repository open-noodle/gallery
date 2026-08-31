//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyMyRootUpdateDto {
  /// Returns a new [FamilyMyRootUpdateDto] instance.
  FamilyMyRootUpdateDto({
    required this.identityId,
  });

  /// Identity ID to nominate as yourself, or null to clear
  String? identityId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyMyRootUpdateDto &&
    other.identityId == identityId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (identityId == null ? 0 : identityId!.hashCode);

  @override
  String toString() => 'FamilyMyRootUpdateDto[identityId=$identityId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.identityId != null) {
      json[r'identityId'] = this.identityId;
    } else {
      json[r'identityId'] = null;
    }
    return json;
  }

  /// Returns a new [FamilyMyRootUpdateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyMyRootUpdateDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyMyRootUpdateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyMyRootUpdateDto(
        identityId: mapValueOfType<String>(json, r'identityId'),
      );
    }
    return null;
  }

  static List<FamilyMyRootUpdateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyMyRootUpdateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyMyRootUpdateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyMyRootUpdateDto> mapFromJson(dynamic json) {
    final map = <String, FamilyMyRootUpdateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyMyRootUpdateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyMyRootUpdateDto-objects as value to a dart map
  static Map<String, List<FamilyMyRootUpdateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyMyRootUpdateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyMyRootUpdateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'identityId',
  };
}


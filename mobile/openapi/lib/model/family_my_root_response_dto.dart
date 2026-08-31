//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyMyRootResponseDto {
  /// Returns a new [FamilyMyRootResponseDto] instance.
  FamilyMyRootResponseDto({
    required this.access,
    required this.rootIdentityId,
  });

  FamilyAccessLevel access;

  /// The identity nominated as the caller, or null if never set
  String? rootIdentityId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyMyRootResponseDto &&
    other.access == access &&
    other.rootIdentityId == rootIdentityId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (access.hashCode) +
    (rootIdentityId == null ? 0 : rootIdentityId!.hashCode);

  @override
  String toString() => 'FamilyMyRootResponseDto[access=$access, rootIdentityId=$rootIdentityId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'access'] = this.access;
    if (this.rootIdentityId != null) {
      json[r'rootIdentityId'] = this.rootIdentityId;
    } else {
      json[r'rootIdentityId'] = null;
    }
    return json;
  }

  /// Returns a new [FamilyMyRootResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyMyRootResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyMyRootResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyMyRootResponseDto(
        access: FamilyAccessLevel.fromJson(json[r'access'])!,
        rootIdentityId: mapValueOfType<String>(json, r'rootIdentityId'),
      );
    }
    return null;
  }

  static List<FamilyMyRootResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyMyRootResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyMyRootResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyMyRootResponseDto> mapFromJson(dynamic json) {
    final map = <String, FamilyMyRootResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyMyRootResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyMyRootResponseDto-objects as value to a dart map
  static Map<String, List<FamilyMyRootResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyMyRootResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyMyRootResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'access',
    'rootIdentityId',
  };
}


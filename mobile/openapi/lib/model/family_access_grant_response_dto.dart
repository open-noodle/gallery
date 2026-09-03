//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyAccessGrantResponseDto {
  /// Returns a new [FamilyAccessGrantResponseDto] instance.
  FamilyAccessGrantResponseDto({
    required this.grantedAt,
    required this.grantedById,
    required this.level,
    required this.userId,
  });

  /// When this grant was last set
  DateTime grantedAt;

  /// Admin who last set this grant, if known
  String? grantedById;

  FamilyAccessLevel level;

  /// User ID this grant applies to
  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyAccessGrantResponseDto &&
    other.grantedAt == grantedAt &&
    other.grantedById == grantedById &&
    other.level == level &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (grantedAt.hashCode) +
    (grantedById == null ? 0 : grantedById!.hashCode) +
    (level.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'FamilyAccessGrantResponseDto[grantedAt=$grantedAt, grantedById=$grantedById, level=$level, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'grantedAt'] = this.grantedAt.toUtc().toIso8601String();
    if (this.grantedById != null) {
      json[r'grantedById'] = this.grantedById;
    } else {
      json[r'grantedById'] = null;
    }
      json[r'level'] = this.level;
      json[r'userId'] = this.userId;
    return json;
  }

  /// Returns a new [FamilyAccessGrantResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyAccessGrantResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyAccessGrantResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyAccessGrantResponseDto(
        grantedAt: mapDateTime(json, r'grantedAt', r'')!,
        grantedById: mapValueOfType<String>(json, r'grantedById'),
        level: FamilyAccessLevel.fromJson(json[r'level'])!,
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<FamilyAccessGrantResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyAccessGrantResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyAccessGrantResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyAccessGrantResponseDto> mapFromJson(dynamic json) {
    final map = <String, FamilyAccessGrantResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyAccessGrantResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyAccessGrantResponseDto-objects as value to a dart map
  static Map<String, List<FamilyAccessGrantResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyAccessGrantResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyAccessGrantResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'grantedAt',
    'grantedById',
    'level',
    'userId',
  };
}


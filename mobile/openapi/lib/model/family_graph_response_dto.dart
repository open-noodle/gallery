//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyGraphResponseDto {
  /// Returns a new [FamilyGraphResponseDto] instance.
  FamilyGraphResponseDto({
    required this.hasNextPage,
    this.identities = const {},
    this.unions = const [],
  });

  bool hasNextPage;

  Map<String, FamilyIdentityDto> identities;

  List<FamilyUnionDto> unions;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyGraphResponseDto &&
    other.hasNextPage == hasNextPage &&
    _deepEquality.equals(other.identities, identities) &&
    _deepEquality.equals(other.unions, unions);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (hasNextPage.hashCode) +
    (identities.hashCode) +
    (unions.hashCode);

  @override
  String toString() => 'FamilyGraphResponseDto[hasNextPage=$hasNextPage, identities=$identities, unions=$unions]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'hasNextPage'] = this.hasNextPage;
      json[r'identities'] = this.identities;
      json[r'unions'] = this.unions;
    return json;
  }

  /// Returns a new [FamilyGraphResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyGraphResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyGraphResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyGraphResponseDto(
        hasNextPage: mapValueOfType<bool>(json, r'hasNextPage')!,
        identities: FamilyIdentityDto.mapFromJson(json[r'identities']),
        unions: FamilyUnionDto.listFromJson(json[r'unions']),
      );
    }
    return null;
  }

  static List<FamilyGraphResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyGraphResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyGraphResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyGraphResponseDto> mapFromJson(dynamic json) {
    final map = <String, FamilyGraphResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyGraphResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyGraphResponseDto-objects as value to a dart map
  static Map<String, List<FamilyGraphResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyGraphResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyGraphResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'hasNextPage',
    'identities',
    'unions',
  };
}


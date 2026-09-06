//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class DissolveResponseDto {
  /// Returns a new [DissolveResponseDto] instance.
  DissolveResponseDto({
    required this.counts,
    required this.expectedFaceCount,
    required this.personId,
    this.warnings = const [],
  });

  DissolveResponseDtoCounts counts;

  num expectedFaceCount;

  String personId;

  List<DissolveResponseDtoWarningsInner> warnings;

  @override
  bool operator ==(Object other) => identical(this, other) || other is DissolveResponseDto &&
    other.counts == counts &&
    other.expectedFaceCount == expectedFaceCount &&
    other.personId == personId &&
    _deepEquality.equals(other.warnings, warnings);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (counts.hashCode) +
    (expectedFaceCount.hashCode) +
    (personId.hashCode) +
    (warnings.hashCode);

  @override
  String toString() => 'DissolveResponseDto[counts=$counts, expectedFaceCount=$expectedFaceCount, personId=$personId, warnings=$warnings]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'counts'] = this.counts;
      json[r'expectedFaceCount'] = this.expectedFaceCount;
      json[r'personId'] = this.personId;
      json[r'warnings'] = this.warnings;
    return json;
  }

  /// Returns a new [DissolveResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static DissolveResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "DissolveResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return DissolveResponseDto(
        counts: DissolveResponseDtoCounts.fromJson(json[r'counts'])!,
        expectedFaceCount: num.parse('${json[r'expectedFaceCount']}'),
        personId: mapValueOfType<String>(json, r'personId')!,
        warnings: DissolveResponseDtoWarningsInner.listFromJson(json[r'warnings']),
      );
    }
    return null;
  }

  static List<DissolveResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <DissolveResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = DissolveResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, DissolveResponseDto> mapFromJson(dynamic json) {
    final map = <String, DissolveResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = DissolveResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of DissolveResponseDto-objects as value to a dart map
  static Map<String, List<DissolveResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<DissolveResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = DissolveResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'counts',
    'expectedFaceCount',
    'personId',
    'warnings',
  };
}


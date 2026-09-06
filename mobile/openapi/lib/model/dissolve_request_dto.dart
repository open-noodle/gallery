//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class DissolveRequestDto {
  /// Returns a new [DissolveRequestDto] instance.
  DissolveRequestDto({
    required this.expectedFaceCount,
    required this.outcome,
    required this.redetect,
    required this.scope,
  });

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int expectedFaceCount;

  DissolveOutcome outcome;

  bool redetect;

  DissolveScope scope;

  @override
  bool operator ==(Object other) => identical(this, other) || other is DissolveRequestDto &&
    other.expectedFaceCount == expectedFaceCount &&
    other.outcome == outcome &&
    other.redetect == redetect &&
    other.scope == scope;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (expectedFaceCount.hashCode) +
    (outcome.hashCode) +
    (redetect.hashCode) +
    (scope.hashCode);

  @override
  String toString() => 'DissolveRequestDto[expectedFaceCount=$expectedFaceCount, outcome=$outcome, redetect=$redetect, scope=$scope]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'expectedFaceCount'] = this.expectedFaceCount;
      json[r'outcome'] = this.outcome;
      json[r'redetect'] = this.redetect;
      json[r'scope'] = this.scope;
    return json;
  }

  /// Returns a new [DissolveRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static DissolveRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "DissolveRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return DissolveRequestDto(
        expectedFaceCount: mapValueOfType<int>(json, r'expectedFaceCount')!,
        outcome: DissolveOutcome.fromJson(json[r'outcome'])!,
        redetect: mapValueOfType<bool>(json, r'redetect')!,
        scope: DissolveScope.fromJson(json[r'scope'])!,
      );
    }
    return null;
  }

  static List<DissolveRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <DissolveRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = DissolveRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, DissolveRequestDto> mapFromJson(dynamic json) {
    final map = <String, DissolveRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = DissolveRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of DissolveRequestDto-objects as value to a dart map
  static Map<String, List<DissolveRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<DissolveRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = DissolveRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'expectedFaceCount',
    'outcome',
    'redetect',
    'scope',
  };
}


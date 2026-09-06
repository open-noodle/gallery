//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PeopleHealthResponseDto {
  /// Returns a new [PeopleHealthResponseDto] instance.
  PeopleHealthResponseDto({
    required this.hasMore,
    this.people = const [],
    required this.total,
  });

  bool hasMore;

  List<PeopleHealthResponseDtoPeopleInner> people;

  num total;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PeopleHealthResponseDto &&
    other.hasMore == hasMore &&
    _deepEquality.equals(other.people, people) &&
    other.total == total;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (hasMore.hashCode) +
    (people.hashCode) +
    (total.hashCode);

  @override
  String toString() => 'PeopleHealthResponseDto[hasMore=$hasMore, people=$people, total=$total]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'hasMore'] = this.hasMore;
      json[r'people'] = this.people;
      json[r'total'] = this.total;
    return json;
  }

  /// Returns a new [PeopleHealthResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PeopleHealthResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "PeopleHealthResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return PeopleHealthResponseDto(
        hasMore: mapValueOfType<bool>(json, r'hasMore')!,
        people: PeopleHealthResponseDtoPeopleInner.listFromJson(json[r'people']),
        total: num.parse('${json[r'total']}'),
      );
    }
    return null;
  }

  static List<PeopleHealthResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PeopleHealthResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PeopleHealthResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PeopleHealthResponseDto> mapFromJson(dynamic json) {
    final map = <String, PeopleHealthResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PeopleHealthResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PeopleHealthResponseDto-objects as value to a dart map
  static Map<String, List<PeopleHealthResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PeopleHealthResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PeopleHealthResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'hasMore',
    'people',
    'total',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FilterSuggestionsTagDto {
  /// Returns a new [FilterSuggestionsTagDto] instance.
  FilterSuggestionsTagDto({
    required this.id,
    required this.value,
  });

  /// Tag ID
  String id;

  /// Tag value/name
  String value;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FilterSuggestionsTagDto &&
    other.id == id &&
    other.value == value;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (id.hashCode) +
    (value.hashCode);

  @override
  String toString() => 'FilterSuggestionsTagDto[id=$id, value=$value]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'id'] = this.id;
      json[r'value'] = this.value;
    return json;
  }

  /// Returns a new [FilterSuggestionsTagDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FilterSuggestionsTagDto? fromJson(dynamic value) {
    upgradeDto(value, "FilterSuggestionsTagDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FilterSuggestionsTagDto(
        id: mapValueOfType<String>(json, r'id')!,
        value: mapValueOfType<String>(json, r'value')!,
      );
    }
    return null;
  }

  static List<FilterSuggestionsTagDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FilterSuggestionsTagDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FilterSuggestionsTagDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FilterSuggestionsTagDto> mapFromJson(dynamic json) {
    final map = <String, FilterSuggestionsTagDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FilterSuggestionsTagDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FilterSuggestionsTagDto-objects as value to a dart map
  static Map<String, List<FilterSuggestionsTagDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FilterSuggestionsTagDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FilterSuggestionsTagDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'id',
    'value',
  };
}


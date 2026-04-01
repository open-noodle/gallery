//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FilterSuggestionsPersonDto {
  /// Returns a new [FilterSuggestionsPersonDto] instance.
  FilterSuggestionsPersonDto({
    required this.id,
    required this.name,
  });

  /// Person ID
  String id;

  /// Person name
  String name;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FilterSuggestionsPersonDto &&
    other.id == id &&
    other.name == name;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (id.hashCode) +
    (name.hashCode);

  @override
  String toString() => 'FilterSuggestionsPersonDto[id=$id, name=$name]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'id'] = this.id;
      json[r'name'] = this.name;
    return json;
  }

  /// Returns a new [FilterSuggestionsPersonDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FilterSuggestionsPersonDto? fromJson(dynamic value) {
    upgradeDto(value, "FilterSuggestionsPersonDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FilterSuggestionsPersonDto(
        id: mapValueOfType<String>(json, r'id')!,
        name: mapValueOfType<String>(json, r'name')!,
      );
    }
    return null;
  }

  static List<FilterSuggestionsPersonDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FilterSuggestionsPersonDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FilterSuggestionsPersonDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FilterSuggestionsPersonDto> mapFromJson(dynamic json) {
    final map = <String, FilterSuggestionsPersonDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FilterSuggestionsPersonDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FilterSuggestionsPersonDto-objects as value to a dart map
  static Map<String, List<FilterSuggestionsPersonDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FilterSuggestionsPersonDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FilterSuggestionsPersonDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'id',
    'name',
  };
}


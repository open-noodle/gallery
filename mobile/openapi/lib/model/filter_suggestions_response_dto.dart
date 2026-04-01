//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FilterSuggestionsResponseDto {
  /// Returns a new [FilterSuggestionsResponseDto] instance.
  FilterSuggestionsResponseDto({
    this.cameraMakes = const [],
    this.countries = const [],
    required this.hasUnnamedPeople,
    this.mediaTypes = const [],
    this.people = const [],
    this.ratings = const [],
    this.tags = const [],
  });

  /// Available camera makes
  List<String> cameraMakes;

  /// Available countries
  List<String> countries;

  /// Whether unnamed people exist in the filtered set
  bool hasUnnamedPeople;

  /// Available media types
  List<String> mediaTypes;

  /// Available people (named, non-hidden, with thumbnails)
  List<FilterSuggestionsPersonDto> people;

  /// Available ratings
  List<num> ratings;

  /// Available tags
  List<FilterSuggestionsTagDto> tags;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FilterSuggestionsResponseDto &&
    _deepEquality.equals(other.cameraMakes, cameraMakes) &&
    _deepEquality.equals(other.countries, countries) &&
    other.hasUnnamedPeople == hasUnnamedPeople &&
    _deepEquality.equals(other.mediaTypes, mediaTypes) &&
    _deepEquality.equals(other.people, people) &&
    _deepEquality.equals(other.ratings, ratings) &&
    _deepEquality.equals(other.tags, tags);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (cameraMakes.hashCode) +
    (countries.hashCode) +
    (hasUnnamedPeople.hashCode) +
    (mediaTypes.hashCode) +
    (people.hashCode) +
    (ratings.hashCode) +
    (tags.hashCode);

  @override
  String toString() => 'FilterSuggestionsResponseDto[cameraMakes=$cameraMakes, countries=$countries, hasUnnamedPeople=$hasUnnamedPeople, mediaTypes=$mediaTypes, people=$people, ratings=$ratings, tags=$tags]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'cameraMakes'] = this.cameraMakes;
      json[r'countries'] = this.countries;
      json[r'hasUnnamedPeople'] = this.hasUnnamedPeople;
      json[r'mediaTypes'] = this.mediaTypes;
      json[r'people'] = this.people;
      json[r'ratings'] = this.ratings;
      json[r'tags'] = this.tags;
    return json;
  }

  /// Returns a new [FilterSuggestionsResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FilterSuggestionsResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "FilterSuggestionsResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FilterSuggestionsResponseDto(
        cameraMakes: json[r'cameraMakes'] is Iterable
            ? (json[r'cameraMakes'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        countries: json[r'countries'] is Iterable
            ? (json[r'countries'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        hasUnnamedPeople: mapValueOfType<bool>(json, r'hasUnnamedPeople')!,
        mediaTypes: json[r'mediaTypes'] is Iterable
            ? (json[r'mediaTypes'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        people: FilterSuggestionsPersonDto.listFromJson(json[r'people']),
        ratings: json[r'ratings'] is Iterable
            ? (json[r'ratings'] as Iterable).cast<num>().toList(growable: false)
            : const [],
        tags: FilterSuggestionsTagDto.listFromJson(json[r'tags']),
      );
    }
    return null;
  }

  static List<FilterSuggestionsResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FilterSuggestionsResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FilterSuggestionsResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FilterSuggestionsResponseDto> mapFromJson(dynamic json) {
    final map = <String, FilterSuggestionsResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FilterSuggestionsResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FilterSuggestionsResponseDto-objects as value to a dart map
  static Map<String, List<FilterSuggestionsResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FilterSuggestionsResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FilterSuggestionsResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'cameraMakes',
    'countries',
    'hasUnnamedPeople',
    'mediaTypes',
    'people',
    'ratings',
    'tags',
  };
}


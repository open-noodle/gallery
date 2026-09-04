//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameStandingsResponseDto {
  /// Returns a new [GameStandingsResponseDto] instance.
  GameStandingsResponseDto({
    this.entries = const [],
    required this.month,
  });

  /// Per-player totals, best first, non-players last
  List<GameStandingsResponseDtoEntriesInner> entries;

  /// The UTC calendar month these standings cover, as YYYY-MM. The client formats the name.
  String month;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameStandingsResponseDto &&
    _deepEquality.equals(other.entries, entries) &&
    other.month == month;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (entries.hashCode) +
    (month.hashCode);

  @override
  String toString() => 'GameStandingsResponseDto[entries=$entries, month=$month]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'entries'] = this.entries;
      json[r'month'] = this.month;
    return json;
  }

  /// Returns a new [GameStandingsResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameStandingsResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GameStandingsResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameStandingsResponseDto(
        entries: GameStandingsResponseDtoEntriesInner.listFromJson(json[r'entries']),
        month: mapValueOfType<String>(json, r'month')!,
      );
    }
    return null;
  }

  static List<GameStandingsResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameStandingsResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameStandingsResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameStandingsResponseDto> mapFromJson(dynamic json) {
    final map = <String, GameStandingsResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameStandingsResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameStandingsResponseDto-objects as value to a dart map
  static Map<String, List<GameStandingsResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameStandingsResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameStandingsResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'entries',
    'month',
  };
}


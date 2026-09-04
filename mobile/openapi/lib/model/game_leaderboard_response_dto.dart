//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameLeaderboardResponseDto {
  /// Returns a new [GameLeaderboardResponseDto] instance.
  GameLeaderboardResponseDto({
    this.entries = const [],
  });

  /// Per-player totals, highest first
  List<GameLeaderboardResponseDtoEntriesInner> entries;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameLeaderboardResponseDto &&
    _deepEquality.equals(other.entries, entries);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (entries.hashCode);

  @override
  String toString() => 'GameLeaderboardResponseDto[entries=$entries]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'entries'] = this.entries;
    return json;
  }

  /// Returns a new [GameLeaderboardResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameLeaderboardResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GameLeaderboardResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameLeaderboardResponseDto(
        entries: GameLeaderboardResponseDtoEntriesInner.listFromJson(json[r'entries']),
      );
    }
    return null;
  }

  static List<GameLeaderboardResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameLeaderboardResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameLeaderboardResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameLeaderboardResponseDto> mapFromJson(dynamic json) {
    final map = <String, GameLeaderboardResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameLeaderboardResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameLeaderboardResponseDto-objects as value to a dart map
  static Map<String, List<GameLeaderboardResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameLeaderboardResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameLeaderboardResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'entries',
  };
}


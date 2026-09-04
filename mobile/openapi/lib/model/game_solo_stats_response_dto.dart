//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameSoloStatsResponseDto {
  /// Returns a new [GameSoloStatsResponseDto] instance.
  GameSoloStatsResponseDto({
    required this.averageScore,
    required this.bestScore,
    required this.bestStreak,
    required this.currentStreak,
    required this.gamesPlayed,
  });

  /// Mean total across games played, rounded to whole points
  num averageScore;

  /// The highest total scored in a single game
  num bestScore;

  /// The longest such run ever
  num bestStreak;

  /// Consecutive UTC days of fully played dailies, ending today or yesterday
  num currentStreak;

  /// How many games have at least one guess
  num gamesPlayed;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameSoloStatsResponseDto &&
    other.averageScore == averageScore &&
    other.bestScore == bestScore &&
    other.bestStreak == bestStreak &&
    other.currentStreak == currentStreak &&
    other.gamesPlayed == gamesPlayed;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (averageScore.hashCode) +
    (bestScore.hashCode) +
    (bestStreak.hashCode) +
    (currentStreak.hashCode) +
    (gamesPlayed.hashCode);

  @override
  String toString() => 'GameSoloStatsResponseDto[averageScore=$averageScore, bestScore=$bestScore, bestStreak=$bestStreak, currentStreak=$currentStreak, gamesPlayed=$gamesPlayed]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'averageScore'] = this.averageScore;
      json[r'bestScore'] = this.bestScore;
      json[r'bestStreak'] = this.bestStreak;
      json[r'currentStreak'] = this.currentStreak;
      json[r'gamesPlayed'] = this.gamesPlayed;
    return json;
  }

  /// Returns a new [GameSoloStatsResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameSoloStatsResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GameSoloStatsResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameSoloStatsResponseDto(
        averageScore: num.parse('${json[r'averageScore']}'),
        bestScore: num.parse('${json[r'bestScore']}'),
        bestStreak: num.parse('${json[r'bestStreak']}'),
        currentStreak: num.parse('${json[r'currentStreak']}'),
        gamesPlayed: num.parse('${json[r'gamesPlayed']}'),
      );
    }
    return null;
  }

  static List<GameSoloStatsResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameSoloStatsResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameSoloStatsResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameSoloStatsResponseDto> mapFromJson(dynamic json) {
    final map = <String, GameSoloStatsResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameSoloStatsResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameSoloStatsResponseDto-objects as value to a dart map
  static Map<String, List<GameSoloStatsResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameSoloStatsResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameSoloStatsResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'averageScore',
    'bestScore',
    'bestStreak',
    'currentStreak',
    'gamesPlayed',
  };
}


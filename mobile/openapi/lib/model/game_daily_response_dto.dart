//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameDailyResponseDto {
  /// Returns a new [GameDailyResponseDto] instance.
  GameDailyResponseDto({
    required this.challenge,
  });

  /// Today's daily, if one could be generated
  GameChallengeListItemResponseDto? challenge;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameDailyResponseDto &&
    other.challenge == challenge;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (challenge == null ? 0 : challenge!.hashCode);

  @override
  String toString() => 'GameDailyResponseDto[challenge=$challenge]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.challenge != null) {
      json[r'challenge'] = this.challenge;
    } else {
      json[r'challenge'] = null;
    }
    return json;
  }

  /// Returns a new [GameDailyResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameDailyResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GameDailyResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameDailyResponseDto(
        challenge: GameChallengeListItemResponseDto.fromJson(json[r'challenge']),
      );
    }
    return null;
  }

  static List<GameDailyResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameDailyResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameDailyResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameDailyResponseDto> mapFromJson(dynamic json) {
    final map = <String, GameDailyResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameDailyResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameDailyResponseDto-objects as value to a dart map
  static Map<String, List<GameDailyResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameDailyResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameDailyResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'challenge',
  };
}


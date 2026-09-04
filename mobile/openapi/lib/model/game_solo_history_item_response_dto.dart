//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameSoloHistoryItemResponseDto {
  /// Returns a new [GameSoloHistoryItemResponseDto] instance.
  GameSoloHistoryItemResponseDto({
    required this.answered,
    required this.createdAt,
    required this.dailyOn,
    required this.id,
    required this.name,
    required this.roundCount,
    required this.total,
  });

  /// Number of rounds the player answered
  num answered;

  /// Creation date
  DateTime createdAt;

  /// The UTC date this was the daily for, or null for a free-play game
  DateTime? dailyOn;

  /// Challenge ID
  String id;

  /// Challenge name
  String name;

  /// Number of rounds in the challenge
  num roundCount;

  /// Total score across the rounds they answered
  num total;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameSoloHistoryItemResponseDto &&
    other.answered == answered &&
    other.createdAt == createdAt &&
    other.dailyOn == dailyOn &&
    other.id == id &&
    other.name == name &&
    other.roundCount == roundCount &&
    other.total == total;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (answered.hashCode) +
    (createdAt.hashCode) +
    (dailyOn == null ? 0 : dailyOn!.hashCode) +
    (id.hashCode) +
    (name.hashCode) +
    (roundCount.hashCode) +
    (total.hashCode);

  @override
  String toString() => 'GameSoloHistoryItemResponseDto[answered=$answered, createdAt=$createdAt, dailyOn=$dailyOn, id=$id, name=$name, roundCount=$roundCount, total=$total]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'answered'] = this.answered;
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
    if (this.dailyOn != null) {
      json[r'dailyOn'] = _dateFormatter.format(this.dailyOn!);
    } else {
      json[r'dailyOn'] = null;
    }
      json[r'id'] = this.id;
      json[r'name'] = this.name;
      json[r'roundCount'] = this.roundCount;
      json[r'total'] = this.total;
    return json;
  }

  /// Returns a new [GameSoloHistoryItemResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameSoloHistoryItemResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GameSoloHistoryItemResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameSoloHistoryItemResponseDto(
        answered: num.parse('${json[r'answered']}'),
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        dailyOn: mapDateTime(json, r'dailyOn', r''),
        id: mapValueOfType<String>(json, r'id')!,
        name: mapValueOfType<String>(json, r'name')!,
        roundCount: num.parse('${json[r'roundCount']}'),
        total: num.parse('${json[r'total']}'),
      );
    }
    return null;
  }

  static List<GameSoloHistoryItemResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameSoloHistoryItemResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameSoloHistoryItemResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameSoloHistoryItemResponseDto> mapFromJson(dynamic json) {
    final map = <String, GameSoloHistoryItemResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameSoloHistoryItemResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameSoloHistoryItemResponseDto-objects as value to a dart map
  static Map<String, List<GameSoloHistoryItemResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameSoloHistoryItemResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameSoloHistoryItemResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'answered',
    'createdAt',
    'dailyOn',
    'id',
    'name',
    'roundCount',
    'total',
  };
}


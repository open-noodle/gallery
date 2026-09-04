//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameLeaderboardResponseDtoEntriesInner {
  /// Returns a new [GameLeaderboardResponseDtoEntriesInner] instance.
  GameLeaderboardResponseDtoEntriesInner({
    required this.answered,
    required this.name,
    required this.total,
    required this.userId,
  });

  /// Number of rounds answered
  num answered;

  /// User name
  String name;

  /// Total score across all guessed rounds
  num total;

  /// User ID
  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameLeaderboardResponseDtoEntriesInner &&
    other.answered == answered &&
    other.name == name &&
    other.total == total &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (answered.hashCode) +
    (name.hashCode) +
    (total.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'GameLeaderboardResponseDtoEntriesInner[answered=$answered, name=$name, total=$total, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'answered'] = this.answered;
      json[r'name'] = this.name;
      json[r'total'] = this.total;
      json[r'userId'] = this.userId;
    return json;
  }

  /// Returns a new [GameLeaderboardResponseDtoEntriesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameLeaderboardResponseDtoEntriesInner? fromJson(dynamic value) {
    upgradeDto(value, "GameLeaderboardResponseDtoEntriesInner");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameLeaderboardResponseDtoEntriesInner(
        answered: num.parse('${json[r'answered']}'),
        name: mapValueOfType<String>(json, r'name')!,
        total: num.parse('${json[r'total']}'),
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<GameLeaderboardResponseDtoEntriesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameLeaderboardResponseDtoEntriesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameLeaderboardResponseDtoEntriesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameLeaderboardResponseDtoEntriesInner> mapFromJson(dynamic json) {
    final map = <String, GameLeaderboardResponseDtoEntriesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameLeaderboardResponseDtoEntriesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameLeaderboardResponseDtoEntriesInner-objects as value to a dart map
  static Map<String, List<GameLeaderboardResponseDtoEntriesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameLeaderboardResponseDtoEntriesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameLeaderboardResponseDtoEntriesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'answered',
    'name',
    'total',
    'userId',
  };
}


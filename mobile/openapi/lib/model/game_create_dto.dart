//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameCreateDto {
  /// Returns a new [GameCreateDto] instance.
  GameCreateDto({
    this.name = const Optional.absent(),
    this.roundCount = const Optional.present(5),
    this.type = const Optional.absent(),
  });

  /// Challenge name
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> name;

  /// Number of rounds to generate
  ///
  /// Minimum value: 1
  /// Maximum value: 20
  Optional<int?> roundCount;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<GameChallengeType?> type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameCreateDto &&
    other.name == name &&
    other.roundCount == roundCount &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name == null ? 0 : name!.hashCode) +
    (roundCount.hashCode) +
    (type == null ? 0 : type!.hashCode);

  @override
  String toString() => 'GameCreateDto[name=$name, roundCount=$roundCount, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.name.isPresent) {
      final value = this.name.value;
      json[r'name'] = value;
    }
    if (this.roundCount.isPresent) {
      final value = this.roundCount.value;
      json[r'roundCount'] = value;
    }
    if (this.type.isPresent) {
      final value = this.type.value;
      json[r'type'] = value;
    }
    return json;
  }

  /// Returns a new [GameCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "GameCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameCreateDto(
        name: json.containsKey(r'name') ? Optional.present(mapValueOfType<String>(json, r'name')) : const Optional.absent(),
        roundCount: json.containsKey(r'roundCount') ? Optional.present(json[r'roundCount'] == null ? null : int.parse('${json[r'roundCount']}')) : const Optional.absent(),
        type: json.containsKey(r'type') ? Optional.present(GameChallengeType.fromJson(json[r'type'])) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<GameCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameCreateDto> mapFromJson(dynamic json) {
    final map = <String, GameCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameCreateDto-objects as value to a dart map
  static Map<String, List<GameCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameSoloCreateDto {
  /// Returns a new [GameSoloCreateDto] instance.
  GameSoloCreateDto({
    this.roundCount = const Optional.present(5),
    this.sources = const Optional.absent(),
    this.type = const Optional.absent(),
  });

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
  Optional<GameSoloSourcesDto?> sources;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<GameChallengeType?> type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameSoloCreateDto &&
    other.roundCount == roundCount &&
    other.sources == sources &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (roundCount.hashCode) +
    (sources == null ? 0 : sources!.hashCode) +
    (type == null ? 0 : type!.hashCode);

  @override
  String toString() => 'GameSoloCreateDto[roundCount=$roundCount, sources=$sources, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.roundCount.isPresent) {
      final value = this.roundCount.value;
      json[r'roundCount'] = value;
    }
    if (this.sources.isPresent) {
      final value = this.sources.value;
      json[r'sources'] = value;
    }
    if (this.type.isPresent) {
      final value = this.type.value;
      json[r'type'] = value;
    }
    return json;
  }

  /// Returns a new [GameSoloCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameSoloCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "GameSoloCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameSoloCreateDto(
        roundCount: json.containsKey(r'roundCount') ? Optional.present(json[r'roundCount'] == null ? null : int.parse('${json[r'roundCount']}')) : const Optional.absent(),
        sources: json.containsKey(r'sources') ? Optional.present(GameSoloSourcesDto.fromJson(json[r'sources'])) : const Optional.absent(),
        type: json.containsKey(r'type') ? Optional.present(GameChallengeType.fromJson(json[r'type'])) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<GameSoloCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameSoloCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameSoloCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameSoloCreateDto> mapFromJson(dynamic json) {
    final map = <String, GameSoloCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameSoloCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameSoloCreateDto-objects as value to a dart map
  static Map<String, List<GameSoloCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameSoloCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameSoloCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


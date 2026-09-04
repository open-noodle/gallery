//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameRoundDetailResponseDto {
  /// Returns a new [GameRoundDetailResponseDto] instance.
  GameRoundDetailResponseDto({
    this.answer = const Optional.absent(),
    this.assetId = const Optional.absent(),
    this.guess = const Optional.absent(),
    required this.index,
    this.score = const Optional.absent(),
    required this.type,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<GameRoundDetailResponseDtoAnswer?> answer;

  /// Round photo asset ID - present only once the caller has guessed
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> assetId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<GameRoundDetailResponseDtoGuess?> guess;

  /// Round index (0-based)
  num index;

  /// The caller's score for this round - present only once guessed
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> score;

  GameRoundType type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameRoundDetailResponseDto &&
    other.answer == answer &&
    other.assetId == assetId &&
    other.guess == guess &&
    other.index == index &&
    other.score == score &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (answer == null ? 0 : answer!.hashCode) +
    (assetId == null ? 0 : assetId!.hashCode) +
    (guess == null ? 0 : guess!.hashCode) +
    (index.hashCode) +
    (score == null ? 0 : score!.hashCode) +
    (type.hashCode);

  @override
  String toString() => 'GameRoundDetailResponseDto[answer=$answer, assetId=$assetId, guess=$guess, index=$index, score=$score, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.answer.isPresent) {
      final value = this.answer.value;
      json[r'answer'] = value;
    }
    if (this.assetId.isPresent) {
      final value = this.assetId.value;
      json[r'assetId'] = value;
    }
    if (this.guess.isPresent) {
      final value = this.guess.value;
      json[r'guess'] = value;
    }
      json[r'index'] = this.index;
    if (this.score.isPresent) {
      final value = this.score.value;
      json[r'score'] = value;
    }
      json[r'type'] = this.type;
    return json;
  }

  /// Returns a new [GameRoundDetailResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameRoundDetailResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GameRoundDetailResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameRoundDetailResponseDto(
        answer: json.containsKey(r'answer') ? Optional.present(GameRoundDetailResponseDtoAnswer.fromJson(json[r'answer'])) : const Optional.absent(),
        assetId: json.containsKey(r'assetId') ? Optional.present(mapValueOfType<String>(json, r'assetId')) : const Optional.absent(),
        guess: json.containsKey(r'guess') ? Optional.present(GameRoundDetailResponseDtoGuess.fromJson(json[r'guess'])) : const Optional.absent(),
        index: num.parse('${json[r'index']}'),
        score: json.containsKey(r'score') ? Optional.present(json[r'score'] == null ? null : num.parse('${json[r'score']}')) : const Optional.absent(),
        type: GameRoundType.fromJson(json[r'type'])!,
      );
    }
    return null;
  }

  static List<GameRoundDetailResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameRoundDetailResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameRoundDetailResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameRoundDetailResponseDto> mapFromJson(dynamic json) {
    final map = <String, GameRoundDetailResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameRoundDetailResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameRoundDetailResponseDto-objects as value to a dart map
  static Map<String, List<GameRoundDetailResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameRoundDetailResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameRoundDetailResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'index',
    'type',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameGuessResponseDto {
  /// Returns a new [GameGuessResponseDto] instance.
  GameGuessResponseDto({
    required this.distanceKm,
    required this.guessDate,
    required this.guessLat,
    required this.guessLon,
    required this.offsetDays,
    required this.roundId,
    required this.score,
    required this.userId,
  });

  /// Distance between the guess and the answer, in km
  num? distanceKm;

  /// Guessed date
  DateTime? guessDate;

  /// Guessed latitude
  num? guessLat;

  /// Guessed longitude
  num? guessLon;

  /// Day offset between the guess and the answer
  num? offsetDays;

  /// Round ID
  String roundId;

  /// Score awarded for this guess
  num score;

  /// User ID
  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameGuessResponseDto &&
    other.distanceKm == distanceKm &&
    other.guessDate == guessDate &&
    other.guessLat == guessLat &&
    other.guessLon == guessLon &&
    other.offsetDays == offsetDays &&
    other.roundId == roundId &&
    other.score == score &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (distanceKm == null ? 0 : distanceKm!.hashCode) +
    (guessDate == null ? 0 : guessDate!.hashCode) +
    (guessLat == null ? 0 : guessLat!.hashCode) +
    (guessLon == null ? 0 : guessLon!.hashCode) +
    (offsetDays == null ? 0 : offsetDays!.hashCode) +
    (roundId.hashCode) +
    (score.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'GameGuessResponseDto[distanceKm=$distanceKm, guessDate=$guessDate, guessLat=$guessLat, guessLon=$guessLon, offsetDays=$offsetDays, roundId=$roundId, score=$score, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.distanceKm != null) {
      json[r'distanceKm'] = this.distanceKm;
    } else {
      json[r'distanceKm'] = null;
    }
    if (this.guessDate != null) {
      json[r'guessDate'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.guessDate!.millisecondsSinceEpoch
        : this.guessDate!.toUtc().toIso8601String();
    } else {
      json[r'guessDate'] = null;
    }
    if (this.guessLat != null) {
      json[r'guessLat'] = this.guessLat;
    } else {
      json[r'guessLat'] = null;
    }
    if (this.guessLon != null) {
      json[r'guessLon'] = this.guessLon;
    } else {
      json[r'guessLon'] = null;
    }
    if (this.offsetDays != null) {
      json[r'offsetDays'] = this.offsetDays;
    } else {
      json[r'offsetDays'] = null;
    }
      json[r'roundId'] = this.roundId;
      json[r'score'] = this.score;
      json[r'userId'] = this.userId;
    return json;
  }

  /// Returns a new [GameGuessResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameGuessResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GameGuessResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameGuessResponseDto(
        distanceKm: json[r'distanceKm'] == null
            ? null
            : num.parse('${json[r'distanceKm']}'),
        guessDate: mapDateTime(json, r'guessDate', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        guessLat: json[r'guessLat'] == null
            ? null
            : num.parse('${json[r'guessLat']}'),
        guessLon: json[r'guessLon'] == null
            ? null
            : num.parse('${json[r'guessLon']}'),
        offsetDays: json[r'offsetDays'] == null
            ? null
            : num.parse('${json[r'offsetDays']}'),
        roundId: mapValueOfType<String>(json, r'roundId')!,
        score: num.parse('${json[r'score']}'),
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<GameGuessResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameGuessResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameGuessResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameGuessResponseDto> mapFromJson(dynamic json) {
    final map = <String, GameGuessResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameGuessResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameGuessResponseDto-objects as value to a dart map
  static Map<String, List<GameGuessResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameGuessResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameGuessResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'distanceKm',
    'guessDate',
    'guessLat',
    'guessLon',
    'offsetDays',
    'roundId',
    'score',
    'userId',
  };
}


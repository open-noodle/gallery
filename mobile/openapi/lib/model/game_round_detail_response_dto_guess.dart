//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameRoundDetailResponseDtoGuess {
  /// Returns a new [GameRoundDetailResponseDtoGuess] instance.
  GameRoundDetailResponseDtoGuess({
    required this.date,
    required this.distanceKm,
    required this.lat,
    required this.lon,
    required this.offsetDays,
  });

  /// Guessed date, for a date round
  DateTime? date;

  /// Distance from the answer, in km
  num? distanceKm;

  /// Guessed latitude, for a location round
  num? lat;

  /// Guessed longitude, for a location round
  num? lon;

  /// Day offset from the answer
  num? offsetDays;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameRoundDetailResponseDtoGuess &&
    other.date == date &&
    other.distanceKm == distanceKm &&
    other.lat == lat &&
    other.lon == lon &&
    other.offsetDays == offsetDays;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (date == null ? 0 : date!.hashCode) +
    (distanceKm == null ? 0 : distanceKm!.hashCode) +
    (lat == null ? 0 : lat!.hashCode) +
    (lon == null ? 0 : lon!.hashCode) +
    (offsetDays == null ? 0 : offsetDays!.hashCode);

  @override
  String toString() => 'GameRoundDetailResponseDtoGuess[date=$date, distanceKm=$distanceKm, lat=$lat, lon=$lon, offsetDays=$offsetDays]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.date != null) {
      json[r'date'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.date!.millisecondsSinceEpoch
        : this.date!.toUtc().toIso8601String();
    } else {
      json[r'date'] = null;
    }
    if (this.distanceKm != null) {
      json[r'distanceKm'] = this.distanceKm;
    } else {
      json[r'distanceKm'] = null;
    }
    if (this.lat != null) {
      json[r'lat'] = this.lat;
    } else {
      json[r'lat'] = null;
    }
    if (this.lon != null) {
      json[r'lon'] = this.lon;
    } else {
      json[r'lon'] = null;
    }
    if (this.offsetDays != null) {
      json[r'offsetDays'] = this.offsetDays;
    } else {
      json[r'offsetDays'] = null;
    }
    return json;
  }

  /// Returns a new [GameRoundDetailResponseDtoGuess] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameRoundDetailResponseDtoGuess? fromJson(dynamic value) {
    upgradeDto(value, "GameRoundDetailResponseDtoGuess");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameRoundDetailResponseDtoGuess(
        date: mapDateTime(json, r'date', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        distanceKm: json[r'distanceKm'] == null
            ? null
            : num.parse('${json[r'distanceKm']}'),
        lat: json[r'lat'] == null
            ? null
            : num.parse('${json[r'lat']}'),
        lon: json[r'lon'] == null
            ? null
            : num.parse('${json[r'lon']}'),
        offsetDays: json[r'offsetDays'] == null
            ? null
            : num.parse('${json[r'offsetDays']}'),
      );
    }
    return null;
  }

  static List<GameRoundDetailResponseDtoGuess> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameRoundDetailResponseDtoGuess>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameRoundDetailResponseDtoGuess.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameRoundDetailResponseDtoGuess> mapFromJson(dynamic json) {
    final map = <String, GameRoundDetailResponseDtoGuess>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameRoundDetailResponseDtoGuess.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameRoundDetailResponseDtoGuess-objects as value to a dart map
  static Map<String, List<GameRoundDetailResponseDtoGuess>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameRoundDetailResponseDtoGuess>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameRoundDetailResponseDtoGuess.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'date',
    'distanceKm',
    'lat',
    'lon',
    'offsetDays',
  };
}


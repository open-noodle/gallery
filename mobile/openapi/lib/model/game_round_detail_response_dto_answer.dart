//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameRoundDetailResponseDtoAnswer {
  /// Returns a new [GameRoundDetailResponseDtoAnswer] instance.
  GameRoundDetailResponseDtoAnswer({
    required this.date,
    required this.lat,
    required this.lon,
  });

  /// Answer date, for a date round
  DateTime? date;

  /// Answer latitude, for a location round
  num? lat;

  /// Answer longitude, for a location round
  num? lon;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameRoundDetailResponseDtoAnswer &&
    other.date == date &&
    other.lat == lat &&
    other.lon == lon;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (date == null ? 0 : date!.hashCode) +
    (lat == null ? 0 : lat!.hashCode) +
    (lon == null ? 0 : lon!.hashCode);

  @override
  String toString() => 'GameRoundDetailResponseDtoAnswer[date=$date, lat=$lat, lon=$lon]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.date != null) {
      json[r'date'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.date!.millisecondsSinceEpoch
        : this.date!.toUtc().toIso8601String();
    } else {
      json[r'date'] = null;
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
    return json;
  }

  /// Returns a new [GameRoundDetailResponseDtoAnswer] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameRoundDetailResponseDtoAnswer? fromJson(dynamic value) {
    upgradeDto(value, "GameRoundDetailResponseDtoAnswer");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameRoundDetailResponseDtoAnswer(
        date: mapDateTime(json, r'date', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        lat: json[r'lat'] == null
            ? null
            : num.parse('${json[r'lat']}'),
        lon: json[r'lon'] == null
            ? null
            : num.parse('${json[r'lon']}'),
      );
    }
    return null;
  }

  static List<GameRoundDetailResponseDtoAnswer> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameRoundDetailResponseDtoAnswer>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameRoundDetailResponseDtoAnswer.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameRoundDetailResponseDtoAnswer> mapFromJson(dynamic json) {
    final map = <String, GameRoundDetailResponseDtoAnswer>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameRoundDetailResponseDtoAnswer.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameRoundDetailResponseDtoAnswer-objects as value to a dart map
  static Map<String, List<GameRoundDetailResponseDtoAnswer>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameRoundDetailResponseDtoAnswer>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameRoundDetailResponseDtoAnswer.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'date',
    'lat',
    'lon',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameGuessDto {
  /// Returns a new [GameGuessDto] instance.
  GameGuessDto({
    this.date = const Optional.absent(),
    this.lat = const Optional.absent(),
    this.lon = const Optional.absent(),
  });

  /// Guessed date, for a date round
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> date;

  /// Guessed latitude, for a location round
  ///
  /// Minimum value: -90
  /// Maximum value: 90
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> lat;

  /// Guessed longitude, for a location round
  ///
  /// Minimum value: -180
  /// Maximum value: 180
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> lon;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameGuessDto &&
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
  String toString() => 'GameGuessDto[date=$date, lat=$lat, lon=$lon]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.date.isPresent) {
      final value = this.date.value;
      json[r'date'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.lat.isPresent) {
      final value = this.lat.value;
      json[r'lat'] = value;
    }
    if (this.lon.isPresent) {
      final value = this.lon.value;
      json[r'lon'] = value;
    }
    return json;
  }

  /// Returns a new [GameGuessDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameGuessDto? fromJson(dynamic value) {
    upgradeDto(value, "GameGuessDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameGuessDto(
        date: json.containsKey(r'date') ? Optional.present(mapDateTime(json, r'date', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        lat: json.containsKey(r'lat') ? Optional.present(json[r'lat'] == null ? null : num.parse('${json[r'lat']}')) : const Optional.absent(),
        lon: json.containsKey(r'lon') ? Optional.present(json[r'lon'] == null ? null : num.parse('${json[r'lon']}')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<GameGuessDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameGuessDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameGuessDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameGuessDto> mapFromJson(dynamic json) {
    final map = <String, GameGuessDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameGuessDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameGuessDto-objects as value to a dart map
  static Map<String, List<GameGuessDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameGuessDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameGuessDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


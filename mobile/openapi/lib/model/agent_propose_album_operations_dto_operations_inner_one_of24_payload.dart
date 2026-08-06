//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload {
  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload] instance.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload({
    this.description = const Optional.absent(),
    this.rating = const Optional.absent(),
    this.dateTimeOriginal = const Optional.absent(),
    this.dateTimeRelative = const Optional.absent(),
    this.timeZone = const Optional.absent(),
    this.latitude = const Optional.absent(),
    this.longitude = const Optional.absent(),
  });

  /// Asset description. Use an empty string to clear the description.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> description;

  /// Asset star rating from 1 to 5. Use null to clear the rating.
  ///
  /// Minimum value: 1
  /// Maximum value: 5
  Optional<int?> rating;

  /// Absolute original capture date/time as an ISO datetime.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> dateTimeOriginal;

  /// Relative capture time shift as an integer minute offset. Cannot be combined with dateTimeOriginal.
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> dateTimeRelative;

  /// IANA time zone such as Europe/Berlin.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> timeZone;

  /// Explicit latitude coordinate. Provide both latitude and longitude; place names are not accepted.
  ///
  /// Minimum value: -90
  /// Maximum value: 90
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> latitude;

  /// Explicit longitude coordinate. Provide both latitude and longitude; place names are not accepted.
  ///
  /// Minimum value: -180
  /// Maximum value: 180
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> longitude;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload &&
    other.description == description &&
    other.rating == rating &&
    other.dateTimeOriginal == dateTimeOriginal &&
    other.dateTimeRelative == dateTimeRelative &&
    other.timeZone == timeZone &&
    other.latitude == latitude &&
    other.longitude == longitude;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (description == null ? 0 : description!.hashCode) +
    (rating == null ? 0 : rating!.hashCode) +
    (dateTimeOriginal == null ? 0 : dateTimeOriginal!.hashCode) +
    (dateTimeRelative == null ? 0 : dateTimeRelative!.hashCode) +
    (timeZone == null ? 0 : timeZone!.hashCode) +
    (latitude == null ? 0 : latitude!.hashCode) +
    (longitude == null ? 0 : longitude!.hashCode);

  @override
  String toString() => 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload[description=$description, rating=$rating, dateTimeOriginal=$dateTimeOriginal, dateTimeRelative=$dateTimeRelative, timeZone=$timeZone, latitude=$latitude, longitude=$longitude]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.description.isPresent) {
      final value = this.description.value;
      json[r'description'] = value;
    }
    if (this.rating.isPresent) {
      final value = this.rating.value;
      json[r'rating'] = value;
    }
    if (this.dateTimeOriginal.isPresent) {
      final value = this.dateTimeOriginal.value;
      json[r'dateTimeOriginal'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.dateTimeRelative.isPresent) {
      final value = this.dateTimeRelative.value;
      json[r'dateTimeRelative'] = value;
    }
    if (this.timeZone.isPresent) {
      final value = this.timeZone.value;
      json[r'timeZone'] = value;
    }
    if (this.latitude.isPresent) {
      final value = this.latitude.value;
      json[r'latitude'] = value;
    }
    if (this.longitude.isPresent) {
      final value = this.longitude.value;
      json[r'longitude'] = value;
    }
    return json;
  }

  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload? fromJson(dynamic value) {
    upgradeDto(value, "AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload(
        description: json.containsKey(r'description') ? Optional.present(mapValueOfType<String>(json, r'description')) : const Optional.absent(),
        rating: json.containsKey(r'rating') ? Optional.present(json[r'rating'] == null ? null : int.parse('${json[r'rating']}')) : const Optional.absent(),
        dateTimeOriginal: json.containsKey(r'dateTimeOriginal') ? Optional.present(mapDateTime(json, r'dateTimeOriginal', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$/')) : const Optional.absent(),
        dateTimeRelative: json.containsKey(r'dateTimeRelative') ? Optional.present(json[r'dateTimeRelative'] == null ? null : int.parse('${json[r'dateTimeRelative']}')) : const Optional.absent(),
        timeZone: json.containsKey(r'timeZone') ? Optional.present(mapValueOfType<String>(json, r'timeZone')) : const Optional.absent(),
        latitude: json.containsKey(r'latitude') ? Optional.present(json[r'latitude'] == null ? null : num.parse('${json[r'latitude']}')) : const Optional.absent(),
        longitude: json.containsKey(r'longitude') ? Optional.present(json[r'longitude'] == null ? null : num.parse('${json[r'longitude']}')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload> mapFromJson(dynamic json) {
    final map = <String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload-objects as value to a dart map
  static Map<String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


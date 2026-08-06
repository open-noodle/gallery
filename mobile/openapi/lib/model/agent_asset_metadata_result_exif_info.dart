//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentAssetMetadataResultExifInfo {
  /// Returns a new [AgentAssetMetadataResultExifInfo] instance.
  AgentAssetMetadataResultExifInfo({
    this.city = const Optional.absent(),
    this.country = const Optional.absent(),
    this.dateTimeOriginal = const Optional.absent(),
    this.latitude = const Optional.absent(),
    this.lensModel = const Optional.absent(),
    this.longitude = const Optional.absent(),
    this.make = const Optional.absent(),
    this.model = const Optional.absent(),
    this.rating = const Optional.absent(),
    this.state = const Optional.absent(),
  });

  Optional<String?> city;

  Optional<String?> country;

  Optional<DateTime?> dateTimeOriginal;

  Optional<num?> latitude;

  Optional<String?> lensModel;

  Optional<num?> longitude;

  Optional<String?> make;

  Optional<String?> model;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  Optional<int?> rating;

  Optional<String?> state;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentAssetMetadataResultExifInfo &&
    other.city == city &&
    other.country == country &&
    other.dateTimeOriginal == dateTimeOriginal &&
    other.latitude == latitude &&
    other.lensModel == lensModel &&
    other.longitude == longitude &&
    other.make == make &&
    other.model == model &&
    other.rating == rating &&
    other.state == state;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (city == null ? 0 : city!.hashCode) +
    (country == null ? 0 : country!.hashCode) +
    (dateTimeOriginal == null ? 0 : dateTimeOriginal!.hashCode) +
    (latitude == null ? 0 : latitude!.hashCode) +
    (lensModel == null ? 0 : lensModel!.hashCode) +
    (longitude == null ? 0 : longitude!.hashCode) +
    (make == null ? 0 : make!.hashCode) +
    (model == null ? 0 : model!.hashCode) +
    (rating == null ? 0 : rating!.hashCode) +
    (state == null ? 0 : state!.hashCode);

  @override
  String toString() => 'AgentAssetMetadataResultExifInfo[city=$city, country=$country, dateTimeOriginal=$dateTimeOriginal, latitude=$latitude, lensModel=$lensModel, longitude=$longitude, make=$make, model=$model, rating=$rating, state=$state]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.city.isPresent) {
      final value = this.city.value;
      json[r'city'] = value;
    }
    if (this.country.isPresent) {
      final value = this.country.value;
      json[r'country'] = value;
    }
    if (this.dateTimeOriginal.isPresent) {
      final value = this.dateTimeOriginal.value;
      json[r'dateTimeOriginal'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.latitude.isPresent) {
      final value = this.latitude.value;
      json[r'latitude'] = value;
    }
    if (this.lensModel.isPresent) {
      final value = this.lensModel.value;
      json[r'lensModel'] = value;
    }
    if (this.longitude.isPresent) {
      final value = this.longitude.value;
      json[r'longitude'] = value;
    }
    if (this.make.isPresent) {
      final value = this.make.value;
      json[r'make'] = value;
    }
    if (this.model.isPresent) {
      final value = this.model.value;
      json[r'model'] = value;
    }
    if (this.rating.isPresent) {
      final value = this.rating.value;
      json[r'rating'] = value;
    }
    if (this.state.isPresent) {
      final value = this.state.value;
      json[r'state'] = value;
    }
    return json;
  }

  /// Returns a new [AgentAssetMetadataResultExifInfo] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentAssetMetadataResultExifInfo? fromJson(dynamic value) {
    upgradeDto(value, "AgentAssetMetadataResultExifInfo");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentAssetMetadataResultExifInfo(
        city: json.containsKey(r'city') ? Optional.present(mapValueOfType<String>(json, r'city')) : const Optional.absent(),
        country: json.containsKey(r'country') ? Optional.present(mapValueOfType<String>(json, r'country')) : const Optional.absent(),
        dateTimeOriginal: json.containsKey(r'dateTimeOriginal') ? Optional.present(mapDateTime(json, r'dateTimeOriginal', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        latitude: json.containsKey(r'latitude') ? Optional.present(json[r'latitude'] == null ? null : num.parse('${json[r'latitude']}')) : const Optional.absent(),
        lensModel: json.containsKey(r'lensModel') ? Optional.present(mapValueOfType<String>(json, r'lensModel')) : const Optional.absent(),
        longitude: json.containsKey(r'longitude') ? Optional.present(json[r'longitude'] == null ? null : num.parse('${json[r'longitude']}')) : const Optional.absent(),
        make: json.containsKey(r'make') ? Optional.present(mapValueOfType<String>(json, r'make')) : const Optional.absent(),
        model: json.containsKey(r'model') ? Optional.present(mapValueOfType<String>(json, r'model')) : const Optional.absent(),
        rating: json.containsKey(r'rating') ? Optional.present(json[r'rating'] == null ? null : int.parse('${json[r'rating']}')) : const Optional.absent(),
        state: json.containsKey(r'state') ? Optional.present(mapValueOfType<String>(json, r'state')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentAssetMetadataResultExifInfo> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetMetadataResultExifInfo>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetMetadataResultExifInfo.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentAssetMetadataResultExifInfo> mapFromJson(dynamic json) {
    final map = <String, AgentAssetMetadataResultExifInfo>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentAssetMetadataResultExifInfo.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentAssetMetadataResultExifInfo-objects as value to a dart map
  static Map<String, List<AgentAssetMetadataResultExifInfo>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentAssetMetadataResultExifInfo>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentAssetMetadataResultExifInfo.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


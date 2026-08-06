//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentAssetMetadataQuality {
  /// Returns a new [AgentAssetMetadataQuality] instance.
  AgentAssetMetadataQuality({
    required this.brightness,
    required this.exposure,
    required this.quality,
    required this.sharpness,
  });

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? brightness;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? exposure;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? quality;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? sharpness;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentAssetMetadataQuality &&
    other.brightness == brightness &&
    other.exposure == exposure &&
    other.quality == quality &&
    other.sharpness == sharpness;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (brightness == null ? 0 : brightness!.hashCode) +
    (exposure == null ? 0 : exposure!.hashCode) +
    (quality == null ? 0 : quality!.hashCode) +
    (sharpness == null ? 0 : sharpness!.hashCode);

  @override
  String toString() => 'AgentAssetMetadataQuality[brightness=$brightness, exposure=$exposure, quality=$quality, sharpness=$sharpness]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.brightness != null) {
      json[r'brightness'] = this.brightness;
    } else {
    //  json[r'brightness'] = null;
    }
    if (this.exposure != null) {
      json[r'exposure'] = this.exposure;
    } else {
    //  json[r'exposure'] = null;
    }
    if (this.quality != null) {
      json[r'quality'] = this.quality;
    } else {
    //  json[r'quality'] = null;
    }
    if (this.sharpness != null) {
      json[r'sharpness'] = this.sharpness;
    } else {
    //  json[r'sharpness'] = null;
    }
    return json;
  }

  /// Returns a new [AgentAssetMetadataQuality] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentAssetMetadataQuality? fromJson(dynamic value) {
    upgradeDto(value, "AgentAssetMetadataQuality");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentAssetMetadataQuality(
        brightness: mapValueOfType<int>(json, r'brightness'),
        exposure: mapValueOfType<int>(json, r'exposure'),
        quality: mapValueOfType<int>(json, r'quality'),
        sharpness: mapValueOfType<int>(json, r'sharpness'),
      );
    }
    return null;
  }

  static List<AgentAssetMetadataQuality> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetMetadataQuality>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetMetadataQuality.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentAssetMetadataQuality> mapFromJson(dynamic json) {
    final map = <String, AgentAssetMetadataQuality>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentAssetMetadataQuality.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentAssetMetadataQuality-objects as value to a dart map
  static Map<String, List<AgentAssetMetadataQuality>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentAssetMetadataQuality>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentAssetMetadataQuality.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'brightness',
    'exposure',
    'quality',
    'sharpness',
  };
}


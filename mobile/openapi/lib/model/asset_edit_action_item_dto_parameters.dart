//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AssetEditActionItemDtoParameters {
  /// Returns a new [AssetEditActionItemDtoParameters] instance.
  AssetEditActionItemDtoParameters({
    required this.height,
    required this.width,
    required this.x,
    required this.y,
    required this.angle,
    required this.axis,
    required this.endTime,
    required this.startTime,
    this.autoEnhance = const Optional.absent(),
    this.brightness = const Optional.absent(),
    this.contrast = const Optional.absent(),
    this.saturation = const Optional.absent(),
  });

  /// Height of the crop
  ///
  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  int height;

  /// Width of the crop
  ///
  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  int width;

  /// Top-Left X coordinate of crop
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int x;

  /// Top-Left Y coordinate of crop
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int y;

  /// Rotation angle in degrees
  num angle;

  MirrorAxis axis;

  /// End time in seconds
  ///
  /// Minimum value: 0
  num endTime;

  /// Start time in seconds
  ///
  /// Minimum value: 0
  num startTime;

  /// Auto-enhance (contrast stretch)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> autoEnhance;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<TonalLevel?> brightness;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<TonalLevel?> contrast;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<TonalLevel?> saturation;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AssetEditActionItemDtoParameters &&
    other.height == height &&
    other.width == width &&
    other.x == x &&
    other.y == y &&
    other.angle == angle &&
    other.axis == axis &&
    other.endTime == endTime &&
    other.startTime == startTime &&
    other.autoEnhance == autoEnhance &&
    other.brightness == brightness &&
    other.contrast == contrast &&
    other.saturation == saturation;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (height.hashCode) +
    (width.hashCode) +
    (x.hashCode) +
    (y.hashCode) +
    (angle.hashCode) +
    (axis.hashCode) +
    (endTime.hashCode) +
    (startTime.hashCode) +
    (autoEnhance == null ? 0 : autoEnhance!.hashCode) +
    (brightness == null ? 0 : brightness!.hashCode) +
    (contrast == null ? 0 : contrast!.hashCode) +
    (saturation == null ? 0 : saturation!.hashCode);

  @override
  String toString() => 'AssetEditActionItemDtoParameters[height=$height, width=$width, x=$x, y=$y, angle=$angle, axis=$axis, endTime=$endTime, startTime=$startTime, autoEnhance=$autoEnhance, brightness=$brightness, contrast=$contrast, saturation=$saturation]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'height'] = this.height;
      json[r'width'] = this.width;
      json[r'x'] = this.x;
      json[r'y'] = this.y;
      json[r'angle'] = this.angle;
      json[r'axis'] = this.axis;
      json[r'endTime'] = this.endTime;
      json[r'startTime'] = this.startTime;
    if (this.autoEnhance.isPresent) {
      final value = this.autoEnhance.value;
      json[r'autoEnhance'] = value;
    }
    if (this.brightness.isPresent) {
      final value = this.brightness.value;
      json[r'brightness'] = value;
    }
    if (this.contrast.isPresent) {
      final value = this.contrast.value;
      json[r'contrast'] = value;
    }
    if (this.saturation.isPresent) {
      final value = this.saturation.value;
      json[r'saturation'] = value;
    }
    return json;
  }

  /// Returns a new [AssetEditActionItemDtoParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AssetEditActionItemDtoParameters? fromJson(dynamic value) {
    upgradeDto(value, "AssetEditActionItemDtoParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AssetEditActionItemDtoParameters(
        height: mapValueOfType<int>(json, r'height')!,
        width: mapValueOfType<int>(json, r'width')!,
        x: mapValueOfType<int>(json, r'x')!,
        y: mapValueOfType<int>(json, r'y')!,
        angle: num.parse('${json[r'angle']}'),
        axis: MirrorAxis.fromJson(json[r'axis'])!,
        endTime: num.parse('${json[r'endTime']}'),
        startTime: num.parse('${json[r'startTime']}'),
        autoEnhance: json.containsKey(r'autoEnhance') ? Optional.present(mapValueOfType<bool>(json, r'autoEnhance')) : const Optional.absent(),
        brightness: json.containsKey(r'brightness') ? Optional.present(TonalLevel.fromJson(json[r'brightness'])) : const Optional.absent(),
        contrast: json.containsKey(r'contrast') ? Optional.present(TonalLevel.fromJson(json[r'contrast'])) : const Optional.absent(),
        saturation: json.containsKey(r'saturation') ? Optional.present(TonalLevel.fromJson(json[r'saturation'])) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AssetEditActionItemDtoParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AssetEditActionItemDtoParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AssetEditActionItemDtoParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AssetEditActionItemDtoParameters> mapFromJson(dynamic json) {
    final map = <String, AssetEditActionItemDtoParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AssetEditActionItemDtoParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AssetEditActionItemDtoParameters-objects as value to a dart map
  static Map<String, List<AssetEditActionItemDtoParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AssetEditActionItemDtoParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AssetEditActionItemDtoParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'height',
    'width',
    'x',
    'y',
    'angle',
    'axis',
    'endTime',
    'startTime',
  };
}


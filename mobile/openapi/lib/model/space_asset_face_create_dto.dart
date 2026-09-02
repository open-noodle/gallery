//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SpaceAssetFaceCreateDto {
  /// Returns a new [SpaceAssetFaceCreateDto] instance.
  SpaceAssetFaceCreateDto({
    required this.height,
    required this.imageHeight,
    required this.imageWidth,
    required this.spacePersonId,
    required this.width,
    required this.x,
    required this.y,
  });

  /// Face bounding box height
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int height;

  /// Image height in pixels (of the preview the box was drawn on)
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int imageHeight;

  /// Image width in pixels (of the preview the box was drawn on)
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int imageWidth;

  /// Space person ID this face will be attached to
  String spacePersonId;

  /// Face bounding box width
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int width;

  /// Face bounding box X coordinate
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int x;

  /// Face bounding box Y coordinate
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int y;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SpaceAssetFaceCreateDto &&
    other.height == height &&
    other.imageHeight == imageHeight &&
    other.imageWidth == imageWidth &&
    other.spacePersonId == spacePersonId &&
    other.width == width &&
    other.x == x &&
    other.y == y;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (height.hashCode) +
    (imageHeight.hashCode) +
    (imageWidth.hashCode) +
    (spacePersonId.hashCode) +
    (width.hashCode) +
    (x.hashCode) +
    (y.hashCode);

  @override
  String toString() => 'SpaceAssetFaceCreateDto[height=$height, imageHeight=$imageHeight, imageWidth=$imageWidth, spacePersonId=$spacePersonId, width=$width, x=$x, y=$y]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'height'] = this.height;
      json[r'imageHeight'] = this.imageHeight;
      json[r'imageWidth'] = this.imageWidth;
      json[r'spacePersonId'] = this.spacePersonId;
      json[r'width'] = this.width;
      json[r'x'] = this.x;
      json[r'y'] = this.y;
    return json;
  }

  /// Returns a new [SpaceAssetFaceCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SpaceAssetFaceCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "SpaceAssetFaceCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SpaceAssetFaceCreateDto(
        height: mapValueOfType<int>(json, r'height')!,
        imageHeight: mapValueOfType<int>(json, r'imageHeight')!,
        imageWidth: mapValueOfType<int>(json, r'imageWidth')!,
        spacePersonId: mapValueOfType<String>(json, r'spacePersonId')!,
        width: mapValueOfType<int>(json, r'width')!,
        x: mapValueOfType<int>(json, r'x')!,
        y: mapValueOfType<int>(json, r'y')!,
      );
    }
    return null;
  }

  static List<SpaceAssetFaceCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SpaceAssetFaceCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SpaceAssetFaceCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SpaceAssetFaceCreateDto> mapFromJson(dynamic json) {
    final map = <String, SpaceAssetFaceCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SpaceAssetFaceCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SpaceAssetFaceCreateDto-objects as value to a dart map
  static Map<String, List<SpaceAssetFaceCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SpaceAssetFaceCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SpaceAssetFaceCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'height',
    'imageHeight',
    'imageWidth',
    'spacePersonId',
    'width',
    'x',
    'y',
  };
}


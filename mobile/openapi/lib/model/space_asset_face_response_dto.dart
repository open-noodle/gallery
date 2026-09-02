//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SpaceAssetFaceResponseDto {
  /// Returns a new [SpaceAssetFaceResponseDto] instance.
  SpaceAssetFaceResponseDto({
    required this.boundingBoxX1,
    required this.boundingBoxX2,
    required this.boundingBoxY1,
    required this.boundingBoxY2,
    required this.id,
    required this.imageHeight,
    required this.imageWidth,
    required this.isEditorDrawn,
    required this.spacePersonId,
    required this.spacePersonName,
  });

  /// Bounding box X1
  num boundingBoxX1;

  /// Bounding box X2
  num boundingBoxX2;

  /// Bounding box Y1
  num boundingBoxY1;

  /// Bounding box Y2
  num boundingBoxY2;

  /// Asset face ID
  String id;

  /// Original image height
  num imageHeight;

  /// Original image width
  num imageWidth;

  /// Whether this face box was drawn by a space Owner/Editor, and so may be deleted by one
  bool isEditorDrawn;

  /// Space person ID this face is attached to, if any
  String? spacePersonId;

  /// Space person name this face is attached to, if any
  String? spacePersonName;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SpaceAssetFaceResponseDto &&
    other.boundingBoxX1 == boundingBoxX1 &&
    other.boundingBoxX2 == boundingBoxX2 &&
    other.boundingBoxY1 == boundingBoxY1 &&
    other.boundingBoxY2 == boundingBoxY2 &&
    other.id == id &&
    other.imageHeight == imageHeight &&
    other.imageWidth == imageWidth &&
    other.isEditorDrawn == isEditorDrawn &&
    other.spacePersonId == spacePersonId &&
    other.spacePersonName == spacePersonName;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (boundingBoxX1.hashCode) +
    (boundingBoxX2.hashCode) +
    (boundingBoxY1.hashCode) +
    (boundingBoxY2.hashCode) +
    (id.hashCode) +
    (imageHeight.hashCode) +
    (imageWidth.hashCode) +
    (isEditorDrawn.hashCode) +
    (spacePersonId == null ? 0 : spacePersonId!.hashCode) +
    (spacePersonName == null ? 0 : spacePersonName!.hashCode);

  @override
  String toString() => 'SpaceAssetFaceResponseDto[boundingBoxX1=$boundingBoxX1, boundingBoxX2=$boundingBoxX2, boundingBoxY1=$boundingBoxY1, boundingBoxY2=$boundingBoxY2, id=$id, imageHeight=$imageHeight, imageWidth=$imageWidth, isEditorDrawn=$isEditorDrawn, spacePersonId=$spacePersonId, spacePersonName=$spacePersonName]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'boundingBoxX1'] = this.boundingBoxX1;
      json[r'boundingBoxX2'] = this.boundingBoxX2;
      json[r'boundingBoxY1'] = this.boundingBoxY1;
      json[r'boundingBoxY2'] = this.boundingBoxY2;
      json[r'id'] = this.id;
      json[r'imageHeight'] = this.imageHeight;
      json[r'imageWidth'] = this.imageWidth;
      json[r'isEditorDrawn'] = this.isEditorDrawn;
    if (this.spacePersonId != null) {
      json[r'spacePersonId'] = this.spacePersonId;
    } else {
      json[r'spacePersonId'] = null;
    }
    if (this.spacePersonName != null) {
      json[r'spacePersonName'] = this.spacePersonName;
    } else {
      json[r'spacePersonName'] = null;
    }
    return json;
  }

  /// Returns a new [SpaceAssetFaceResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SpaceAssetFaceResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "SpaceAssetFaceResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SpaceAssetFaceResponseDto(
        boundingBoxX1: num.parse('${json[r'boundingBoxX1']}'),
        boundingBoxX2: num.parse('${json[r'boundingBoxX2']}'),
        boundingBoxY1: num.parse('${json[r'boundingBoxY1']}'),
        boundingBoxY2: num.parse('${json[r'boundingBoxY2']}'),
        id: mapValueOfType<String>(json, r'id')!,
        imageHeight: num.parse('${json[r'imageHeight']}'),
        imageWidth: num.parse('${json[r'imageWidth']}'),
        isEditorDrawn: mapValueOfType<bool>(json, r'isEditorDrawn')!,
        spacePersonId: mapValueOfType<String>(json, r'spacePersonId'),
        spacePersonName: mapValueOfType<String>(json, r'spacePersonName'),
      );
    }
    return null;
  }

  static List<SpaceAssetFaceResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SpaceAssetFaceResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SpaceAssetFaceResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SpaceAssetFaceResponseDto> mapFromJson(dynamic json) {
    final map = <String, SpaceAssetFaceResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SpaceAssetFaceResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SpaceAssetFaceResponseDto-objects as value to a dart map
  static Map<String, List<SpaceAssetFaceResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SpaceAssetFaceResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SpaceAssetFaceResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'boundingBoxX1',
    'boundingBoxX2',
    'boundingBoxY1',
    'boundingBoxY2',
    'id',
    'imageHeight',
    'imageWidth',
    'isEditorDrawn',
    'spacePersonId',
    'spacePersonName',
  };
}


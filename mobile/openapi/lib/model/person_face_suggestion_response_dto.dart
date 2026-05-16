//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PersonFaceSuggestionResponseDto {
  /// Returns a new [PersonFaceSuggestionResponseDto] instance.
  PersonFaceSuggestionResponseDto({
    required this.assetFaceId,
    required this.assetId,
    required this.boundingBoxX1,
    required this.boundingBoxX2,
    required this.boundingBoxY1,
    required this.boundingBoxY2,
    required this.distance,
    this.fileCreatedAt,
    required this.imageHeight,
    required this.imageWidth,
  });

  /// Unassigned asset face ID
  String assetFaceId;

  /// Asset ID containing the candidate face
  String assetId;

  /// Bounding box X1 coordinate
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int boundingBoxX1;

  /// Bounding box X2 coordinate
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int boundingBoxX2;

  /// Bounding box Y1 coordinate
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int boundingBoxY1;

  /// Bounding box Y2 coordinate
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int boundingBoxY2;

  /// Embedding distance to the person
  double distance;

  /// Asset creation date
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? fileCreatedAt;

  /// Image height in pixels
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int imageHeight;

  /// Image width in pixels
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int imageWidth;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PersonFaceSuggestionResponseDto &&
    other.assetFaceId == assetFaceId &&
    other.assetId == assetId &&
    other.boundingBoxX1 == boundingBoxX1 &&
    other.boundingBoxX2 == boundingBoxX2 &&
    other.boundingBoxY1 == boundingBoxY1 &&
    other.boundingBoxY2 == boundingBoxY2 &&
    other.distance == distance &&
    other.fileCreatedAt == fileCreatedAt &&
    other.imageHeight == imageHeight &&
    other.imageWidth == imageWidth;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetFaceId.hashCode) +
    (assetId.hashCode) +
    (boundingBoxX1.hashCode) +
    (boundingBoxX2.hashCode) +
    (boundingBoxY1.hashCode) +
    (boundingBoxY2.hashCode) +
    (distance.hashCode) +
    (fileCreatedAt == null ? 0 : fileCreatedAt!.hashCode) +
    (imageHeight.hashCode) +
    (imageWidth.hashCode);

  @override
  String toString() => 'PersonFaceSuggestionResponseDto[assetFaceId=$assetFaceId, assetId=$assetId, boundingBoxX1=$boundingBoxX1, boundingBoxX2=$boundingBoxX2, boundingBoxY1=$boundingBoxY1, boundingBoxY2=$boundingBoxY2, distance=$distance, fileCreatedAt=$fileCreatedAt, imageHeight=$imageHeight, imageWidth=$imageWidth]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetFaceId'] = this.assetFaceId;
      json[r'assetId'] = this.assetId;
      json[r'boundingBoxX1'] = this.boundingBoxX1;
      json[r'boundingBoxX2'] = this.boundingBoxX2;
      json[r'boundingBoxY1'] = this.boundingBoxY1;
      json[r'boundingBoxY2'] = this.boundingBoxY2;
      json[r'distance'] = this.distance;
    if (this.fileCreatedAt != null) {
      json[r'fileCreatedAt'] = this.fileCreatedAt!.toUtc().toIso8601String();
    } else {
    //  json[r'fileCreatedAt'] = null;
    }
      json[r'imageHeight'] = this.imageHeight;
      json[r'imageWidth'] = this.imageWidth;
    return json;
  }

  /// Returns a new [PersonFaceSuggestionResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PersonFaceSuggestionResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "PersonFaceSuggestionResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return PersonFaceSuggestionResponseDto(
        assetFaceId: mapValueOfType<String>(json, r'assetFaceId')!,
        assetId: mapValueOfType<String>(json, r'assetId')!,
        boundingBoxX1: mapValueOfType<int>(json, r'boundingBoxX1')!,
        boundingBoxX2: mapValueOfType<int>(json, r'boundingBoxX2')!,
        boundingBoxY1: mapValueOfType<int>(json, r'boundingBoxY1')!,
        boundingBoxY2: mapValueOfType<int>(json, r'boundingBoxY2')!,
        distance: (mapValueOfType<num>(json, r'distance')!).toDouble(),
        fileCreatedAt: mapDateTime(json, r'fileCreatedAt', r''),
        imageHeight: mapValueOfType<int>(json, r'imageHeight')!,
        imageWidth: mapValueOfType<int>(json, r'imageWidth')!,
      );
    }
    return null;
  }

  static List<PersonFaceSuggestionResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PersonFaceSuggestionResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PersonFaceSuggestionResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PersonFaceSuggestionResponseDto> mapFromJson(dynamic json) {
    final map = <String, PersonFaceSuggestionResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PersonFaceSuggestionResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PersonFaceSuggestionResponseDto-objects as value to a dart map
  static Map<String, List<PersonFaceSuggestionResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PersonFaceSuggestionResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PersonFaceSuggestionResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetFaceId',
    'assetId',
    'boundingBoxX1',
    'boundingBoxX2',
    'boundingBoxY1',
    'boundingBoxY2',
    'distance',
    'imageHeight',
    'imageWidth',
  };
}


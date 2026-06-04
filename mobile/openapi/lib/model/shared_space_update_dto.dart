//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceUpdateDto {
  /// Returns a new [SharedSpaceUpdateDto] instance.
  SharedSpaceUpdateDto({
    this.color = const Optional.absent(),
    this.description = const Optional.absent(),
    this.faceRecognitionEnabled = const Optional.absent(),
    this.name = const Optional.absent(),
    this.petsEnabled = const Optional.absent(),
    this.thumbnailAssetId = const Optional.absent(),
    this.thumbnailCropY = const Optional.absent(),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<UserAvatarColor?> color;

  /// Space description
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> description;

  /// Enable face recognition for this space
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> faceRecognitionEnabled;

  /// Space name
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> name;

  /// Show pets in space people list
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> petsEnabled;

  /// Thumbnail asset ID
  Optional<String?> thumbnailAssetId;

  /// Vertical crop position for cover photo (0-100)
  ///
  /// Minimum value: 0
  /// Maximum value: 100
  Optional<int?> thumbnailCropY;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceUpdateDto &&
    other.color == color &&
    other.description == description &&
    other.faceRecognitionEnabled == faceRecognitionEnabled &&
    other.name == name &&
    other.petsEnabled == petsEnabled &&
    other.thumbnailAssetId == thumbnailAssetId &&
    other.thumbnailCropY == thumbnailCropY;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (color == null ? 0 : color!.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (faceRecognitionEnabled == null ? 0 : faceRecognitionEnabled!.hashCode) +
    (name == null ? 0 : name!.hashCode) +
    (petsEnabled == null ? 0 : petsEnabled!.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode) +
    (thumbnailCropY == null ? 0 : thumbnailCropY!.hashCode);

  @override
  String toString() => 'SharedSpaceUpdateDto[color=$color, description=$description, faceRecognitionEnabled=$faceRecognitionEnabled, name=$name, petsEnabled=$petsEnabled, thumbnailAssetId=$thumbnailAssetId, thumbnailCropY=$thumbnailCropY]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.color.isPresent) {
      final value = this.color.value;
      json[r'color'] = value;
    }
    if (this.description.isPresent) {
      final value = this.description.value;
      json[r'description'] = value;
    }
    if (this.faceRecognitionEnabled.isPresent) {
      final value = this.faceRecognitionEnabled.value;
      json[r'faceRecognitionEnabled'] = value;
    }
    if (this.name.isPresent) {
      final value = this.name.value;
      json[r'name'] = value;
    }
    if (this.petsEnabled.isPresent) {
      final value = this.petsEnabled.value;
      json[r'petsEnabled'] = value;
    }
    if (this.thumbnailAssetId.isPresent) {
      final value = this.thumbnailAssetId.value;
      json[r'thumbnailAssetId'] = value;
    }
    if (this.thumbnailCropY.isPresent) {
      final value = this.thumbnailCropY.value;
      json[r'thumbnailCropY'] = value;
    }
    return json;
  }

  /// Returns a new [SharedSpaceUpdateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceUpdateDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceUpdateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceUpdateDto(
        color: json.containsKey(r'color') ? Optional.present(UserAvatarColor.fromJson(json[r'color'])) : const Optional.absent(),
        description: json.containsKey(r'description') ? Optional.present(mapValueOfType<String>(json, r'description')) : const Optional.absent(),
        faceRecognitionEnabled: json.containsKey(r'faceRecognitionEnabled') ? Optional.present(mapValueOfType<bool>(json, r'faceRecognitionEnabled')) : const Optional.absent(),
        name: json.containsKey(r'name') ? Optional.present(mapValueOfType<String>(json, r'name')) : const Optional.absent(),
        petsEnabled: json.containsKey(r'petsEnabled') ? Optional.present(mapValueOfType<bool>(json, r'petsEnabled')) : const Optional.absent(),
        thumbnailAssetId: json.containsKey(r'thumbnailAssetId') ? Optional.present(mapValueOfType<String>(json, r'thumbnailAssetId')) : const Optional.absent(),
        thumbnailCropY: json.containsKey(r'thumbnailCropY') ? Optional.present(json[r'thumbnailCropY'] == null ? null : int.parse('${json[r'thumbnailCropY']}')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<SharedSpaceUpdateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceUpdateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceUpdateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceUpdateDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceUpdateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceUpdateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceUpdateDto-objects as value to a dart map
  static Map<String, List<SharedSpaceUpdateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceUpdateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceUpdateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


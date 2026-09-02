//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpacePersonCreateDto {
  /// Returns a new [SharedSpacePersonCreateDto] instance.
  SharedSpacePersonCreateDto({
    this.assetFaceId = const Optional.absent(),
    this.name = const Optional.absent(),
  });

  /// Seed face to attach to the new person
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> assetFaceId;

  /// Person name
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> name;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpacePersonCreateDto &&
    other.assetFaceId == assetFaceId &&
    other.name == name;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetFaceId == null ? 0 : assetFaceId!.hashCode) +
    (name == null ? 0 : name!.hashCode);

  @override
  String toString() => 'SharedSpacePersonCreateDto[assetFaceId=$assetFaceId, name=$name]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.assetFaceId.isPresent) {
      final value = this.assetFaceId.value;
      json[r'assetFaceId'] = value;
    }
    if (this.name.isPresent) {
      final value = this.name.value;
      json[r'name'] = value;
    }
    return json;
  }

  /// Returns a new [SharedSpacePersonCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpacePersonCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpacePersonCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpacePersonCreateDto(
        assetFaceId: json.containsKey(r'assetFaceId') ? Optional.present(mapValueOfType<String>(json, r'assetFaceId')) : const Optional.absent(),
        name: json.containsKey(r'name') ? Optional.present(mapValueOfType<String>(json, r'name')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<SharedSpacePersonCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpacePersonCreateDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpacePersonCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpacePersonCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpacePersonCreateDto-objects as value to a dart map
  static Map<String, List<SharedSpacePersonCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpacePersonCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpacePersonCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class UploadSessionResponseDto {
  /// Returns a new [UploadSessionResponseDto] instance.
  UploadSessionResponseDto({
    required this.expiresAt,
    required this.id,
    required this.offset,
  });

  /// ISO timestamp after which the session may be reclaimed
  String expiresAt;

  /// Upload session ID
  String id;

  /// Bytes committed so far
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int offset;

  @override
  bool operator ==(Object other) => identical(this, other) || other is UploadSessionResponseDto &&
    other.expiresAt == expiresAt &&
    other.id == id &&
    other.offset == offset;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (expiresAt.hashCode) +
    (id.hashCode) +
    (offset.hashCode);

  @override
  String toString() => 'UploadSessionResponseDto[expiresAt=$expiresAt, id=$id, offset=$offset]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'expiresAt'] = this.expiresAt;
      json[r'id'] = this.id;
      json[r'offset'] = this.offset;
    return json;
  }

  /// Returns a new [UploadSessionResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static UploadSessionResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "UploadSessionResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return UploadSessionResponseDto(
        expiresAt: mapValueOfType<String>(json, r'expiresAt')!,
        id: mapValueOfType<String>(json, r'id')!,
        offset: mapValueOfType<int>(json, r'offset')!,
      );
    }
    return null;
  }

  static List<UploadSessionResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UploadSessionResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UploadSessionResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, UploadSessionResponseDto> mapFromJson(dynamic json) {
    final map = <String, UploadSessionResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = UploadSessionResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of UploadSessionResponseDto-objects as value to a dart map
  static Map<String, List<UploadSessionResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<UploadSessionResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = UploadSessionResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'expiresAt',
    'id',
    'offset',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LibraryManifestOwnerDto {
  /// Returns a new [LibraryManifestOwnerDto] instance.
  LibraryManifestOwnerDto({
    required this.email,
    required this.id,
  });

  /// Owner email
  String email;

  /// Owner user ID
  String id;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LibraryManifestOwnerDto &&
    other.email == email &&
    other.id == id;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (email.hashCode) +
    (id.hashCode);

  @override
  String toString() => 'LibraryManifestOwnerDto[email=$email, id=$id]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'email'] = this.email;
      json[r'id'] = this.id;
    return json;
  }

  /// Returns a new [LibraryManifestOwnerDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LibraryManifestOwnerDto? fromJson(dynamic value) {
    upgradeDto(value, "LibraryManifestOwnerDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LibraryManifestOwnerDto(
        email: mapValueOfType<String>(json, r'email')!,
        id: mapValueOfType<String>(json, r'id')!,
      );
    }
    return null;
  }

  static List<LibraryManifestOwnerDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LibraryManifestOwnerDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LibraryManifestOwnerDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LibraryManifestOwnerDto> mapFromJson(dynamic json) {
    final map = <String, LibraryManifestOwnerDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LibraryManifestOwnerDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LibraryManifestOwnerDto-objects as value to a dart map
  static Map<String, List<LibraryManifestOwnerDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LibraryManifestOwnerDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LibraryManifestOwnerDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'email',
    'id',
  };
}


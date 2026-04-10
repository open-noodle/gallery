//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncSharedSpaceLibraryV1 {
  /// Returns a new [SyncSharedSpaceLibraryV1] instance.
  SyncSharedSpaceLibraryV1({
    required this.addedById,
    required this.createdAt,
    required this.libraryId,
    required this.spaceId,
    required this.updatedAt,
  });

  /// User who added the library to the space
  String? addedById;

  /// Created at
  DateTime createdAt;

  /// Library ID
  String libraryId;

  /// Shared space ID
  String spaceId;

  /// Updated at
  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncSharedSpaceLibraryV1 &&
    other.addedById == addedById &&
    other.createdAt == createdAt &&
    other.libraryId == libraryId &&
    other.spaceId == spaceId &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (addedById == null ? 0 : addedById!.hashCode) +
    (createdAt.hashCode) +
    (libraryId.hashCode) +
    (spaceId.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SyncSharedSpaceLibraryV1[addedById=$addedById, createdAt=$createdAt, libraryId=$libraryId, spaceId=$spaceId, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.addedById != null) {
      json[r'addedById'] = this.addedById;
    } else {
    //  json[r'addedById'] = null;
    }
      json[r'createdAt'] = this.createdAt.toUtc().toIso8601String();
      json[r'libraryId'] = this.libraryId;
      json[r'spaceId'] = this.spaceId;
      json[r'updatedAt'] = this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [SyncSharedSpaceLibraryV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncSharedSpaceLibraryV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncSharedSpaceLibraryV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncSharedSpaceLibraryV1(
        addedById: mapValueOfType<String>(json, r'addedById'),
        createdAt: mapDateTime(json, r'createdAt', r'')!,
        libraryId: mapValueOfType<String>(json, r'libraryId')!,
        spaceId: mapValueOfType<String>(json, r'spaceId')!,
        updatedAt: mapDateTime(json, r'updatedAt', r'')!,
      );
    }
    return null;
  }

  static List<SyncSharedSpaceLibraryV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncSharedSpaceLibraryV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncSharedSpaceLibraryV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncSharedSpaceLibraryV1> mapFromJson(dynamic json) {
    final map = <String, SyncSharedSpaceLibraryV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncSharedSpaceLibraryV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncSharedSpaceLibraryV1-objects as value to a dart map
  static Map<String, List<SyncSharedSpaceLibraryV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncSharedSpaceLibraryV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncSharedSpaceLibraryV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'addedById',
    'createdAt',
    'libraryId',
    'spaceId',
    'updatedAt',
  };
}


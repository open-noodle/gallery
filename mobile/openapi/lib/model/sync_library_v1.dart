//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncLibraryV1 {
  /// Returns a new [SyncLibraryV1] instance.
  SyncLibraryV1({
    required this.createdAt,
    required this.id,
    required this.name,
    required this.ownerId,
    required this.updatedAt,
  });

  /// Created at
  DateTime createdAt;

  /// Library ID
  String id;

  /// Library name
  String name;

  /// Owner user ID
  String ownerId;

  /// Updated at
  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncLibraryV1 &&
    other.createdAt == createdAt &&
    other.id == id &&
    other.name == name &&
    other.ownerId == ownerId &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (createdAt.hashCode) +
    (id.hashCode) +
    (name.hashCode) +
    (ownerId.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SyncLibraryV1[createdAt=$createdAt, id=$id, name=$name, ownerId=$ownerId, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'createdAt'] = this.createdAt.toUtc().toIso8601String();
      json[r'id'] = this.id;
      json[r'name'] = this.name;
      json[r'ownerId'] = this.ownerId;
      json[r'updatedAt'] = this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [SyncLibraryV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncLibraryV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncLibraryV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncLibraryV1(
        createdAt: mapDateTime(json, r'createdAt', r'')!,
        id: mapValueOfType<String>(json, r'id')!,
        name: mapValueOfType<String>(json, r'name')!,
        ownerId: mapValueOfType<String>(json, r'ownerId')!,
        updatedAt: mapDateTime(json, r'updatedAt', r'')!,
      );
    }
    return null;
  }

  static List<SyncLibraryV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncLibraryV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncLibraryV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncLibraryV1> mapFromJson(dynamic json) {
    final map = <String, SyncLibraryV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncLibraryV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncLibraryV1-objects as value to a dart map
  static Map<String, List<SyncLibraryV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncLibraryV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncLibraryV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'createdAt',
    'id',
    'name',
    'ownerId',
    'updatedAt',
  };
}


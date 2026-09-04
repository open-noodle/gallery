//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncSharedSpaceAlbumFolderV1 {
  /// Returns a new [SyncSharedSpaceAlbumFolderV1] instance.
  SyncSharedSpaceAlbumFolderV1({
    required this.createdAt,
    required this.id,
    required this.name,
    required this.parentId,
    required this.spaceId,
    required this.updatedAt,
  });

  /// Created at
  DateTime createdAt;

  /// Folder ID
  String id;

  /// Folder name
  String name;

  /// Parent folder ID
  String? parentId;

  /// Shared space ID
  String spaceId;

  /// Updated at
  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncSharedSpaceAlbumFolderV1 &&
    other.createdAt == createdAt &&
    other.id == id &&
    other.name == name &&
    other.parentId == parentId &&
    other.spaceId == spaceId &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (createdAt.hashCode) +
    (id.hashCode) +
    (name.hashCode) +
    (parentId == null ? 0 : parentId!.hashCode) +
    (spaceId.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SyncSharedSpaceAlbumFolderV1[createdAt=$createdAt, id=$id, name=$name, parentId=$parentId, spaceId=$spaceId, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
      json[r'id'] = this.id;
      json[r'name'] = this.name;
    if (this.parentId != null) {
      json[r'parentId'] = this.parentId;
    } else {
      json[r'parentId'] = null;
    }
      json[r'spaceId'] = this.spaceId;
      json[r'updatedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.updatedAt.millisecondsSinceEpoch
        : this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [SyncSharedSpaceAlbumFolderV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncSharedSpaceAlbumFolderV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncSharedSpaceAlbumFolderV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncSharedSpaceAlbumFolderV1(
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        id: mapValueOfType<String>(json, r'id')!,
        name: mapValueOfType<String>(json, r'name')!,
        parentId: mapValueOfType<String>(json, r'parentId'),
        spaceId: mapValueOfType<String>(json, r'spaceId')!,
        updatedAt: mapDateTime(json, r'updatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
      );
    }
    return null;
  }

  static List<SyncSharedSpaceAlbumFolderV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncSharedSpaceAlbumFolderV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncSharedSpaceAlbumFolderV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncSharedSpaceAlbumFolderV1> mapFromJson(dynamic json) {
    final map = <String, SyncSharedSpaceAlbumFolderV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncSharedSpaceAlbumFolderV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncSharedSpaceAlbumFolderV1-objects as value to a dart map
  static Map<String, List<SyncSharedSpaceAlbumFolderV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncSharedSpaceAlbumFolderV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncSharedSpaceAlbumFolderV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'createdAt',
    'id',
    'name',
    'parentId',
    'spaceId',
    'updatedAt',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncSharedSpaceAlbumHiddenV1 {
  /// Returns a new [SyncSharedSpaceAlbumHiddenV1] instance.
  SyncSharedSpaceAlbumHiddenV1({
    required this.albumId,
    required this.spaceId,
    required this.userId,
  });

  /// Album ID
  String albumId;

  /// Shared space ID
  String spaceId;

  /// User ID
  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncSharedSpaceAlbumHiddenV1 &&
    other.albumId == albumId &&
    other.spaceId == spaceId &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albumId.hashCode) +
    (spaceId.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'SyncSharedSpaceAlbumHiddenV1[albumId=$albumId, spaceId=$spaceId, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albumId'] = this.albumId;
      json[r'spaceId'] = this.spaceId;
      json[r'userId'] = this.userId;
    return json;
  }

  /// Returns a new [SyncSharedSpaceAlbumHiddenV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncSharedSpaceAlbumHiddenV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncSharedSpaceAlbumHiddenV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncSharedSpaceAlbumHiddenV1(
        albumId: mapValueOfType<String>(json, r'albumId')!,
        spaceId: mapValueOfType<String>(json, r'spaceId')!,
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<SyncSharedSpaceAlbumHiddenV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncSharedSpaceAlbumHiddenV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncSharedSpaceAlbumHiddenV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncSharedSpaceAlbumHiddenV1> mapFromJson(dynamic json) {
    final map = <String, SyncSharedSpaceAlbumHiddenV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncSharedSpaceAlbumHiddenV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncSharedSpaceAlbumHiddenV1-objects as value to a dart map
  static Map<String, List<SyncSharedSpaceAlbumHiddenV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncSharedSpaceAlbumHiddenV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncSharedSpaceAlbumHiddenV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albumId',
    'spaceId',
    'userId',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncSharedSpaceAlbumLinkV1 {
  /// Returns a new [SyncSharedSpaceAlbumLinkV1] instance.
  SyncSharedSpaceAlbumLinkV1({
    required this.addedById,
    required this.albumId,
    required this.createdAt,
    required this.showInTimeline,
    required this.spaceId,
    required this.updatedAt,
  });

  /// User who linked the album to the space
  String? addedById;

  /// Album ID
  String albumId;

  /// Created at
  DateTime createdAt;

  /// Whether this album appears in the space timeline
  bool showInTimeline;

  /// Shared space ID
  String spaceId;

  /// Updated at
  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncSharedSpaceAlbumLinkV1 &&
    other.addedById == addedById &&
    other.albumId == albumId &&
    other.createdAt == createdAt &&
    other.showInTimeline == showInTimeline &&
    other.spaceId == spaceId &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (addedById == null ? 0 : addedById!.hashCode) +
    (albumId.hashCode) +
    (createdAt.hashCode) +
    (showInTimeline.hashCode) +
    (spaceId.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SyncSharedSpaceAlbumLinkV1[addedById=$addedById, albumId=$albumId, createdAt=$createdAt, showInTimeline=$showInTimeline, spaceId=$spaceId, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.addedById != null) {
      json[r'addedById'] = this.addedById;
    } else {
    //  json[r'addedById'] = null;
    }
      json[r'albumId'] = this.albumId;
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
      json[r'showInTimeline'] = this.showInTimeline;
      json[r'spaceId'] = this.spaceId;
      json[r'updatedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.updatedAt.millisecondsSinceEpoch
        : this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [SyncSharedSpaceAlbumLinkV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncSharedSpaceAlbumLinkV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncSharedSpaceAlbumLinkV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncSharedSpaceAlbumLinkV1(
        addedById: mapValueOfType<String>(json, r'addedById'),
        albumId: mapValueOfType<String>(json, r'albumId')!,
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        showInTimeline: mapValueOfType<bool>(json, r'showInTimeline')!,
        spaceId: mapValueOfType<String>(json, r'spaceId')!,
        updatedAt: mapDateTime(json, r'updatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
      );
    }
    return null;
  }

  static List<SyncSharedSpaceAlbumLinkV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncSharedSpaceAlbumLinkV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncSharedSpaceAlbumLinkV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncSharedSpaceAlbumLinkV1> mapFromJson(dynamic json) {
    final map = <String, SyncSharedSpaceAlbumLinkV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncSharedSpaceAlbumLinkV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncSharedSpaceAlbumLinkV1-objects as value to a dart map
  static Map<String, List<SyncSharedSpaceAlbumLinkV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncSharedSpaceAlbumLinkV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncSharedSpaceAlbumLinkV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'addedById',
    'albumId',
    'createdAt',
    'showInTimeline',
    'spaceId',
    'updatedAt',
  };
}


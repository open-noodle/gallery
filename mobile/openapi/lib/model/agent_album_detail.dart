//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentAlbumDetail {
  /// Returns a new [AgentAlbumDetail] instance.
  AgentAlbumDetail({
    required this.albumName,
    required this.albumThumbnailAssetId,
    this.albumUsers = const [],
    required this.assetCount,
    this.assetIds = const [],
    required this.description,
    required this.endDate,
    required this.id,
    required this.ownerId,
    required this.startDate,
  });

  String albumName;

  String? albumThumbnailAssetId;

  List<AgentAlbumUserSummary> albumUsers;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetCount;

  List<String> assetIds;

  String description;

  DateTime? endDate;

  String id;

  String ownerId;

  DateTime? startDate;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentAlbumDetail &&
    other.albumName == albumName &&
    other.albumThumbnailAssetId == albumThumbnailAssetId &&
    _deepEquality.equals(other.albumUsers, albumUsers) &&
    other.assetCount == assetCount &&
    _deepEquality.equals(other.assetIds, assetIds) &&
    other.description == description &&
    other.endDate == endDate &&
    other.id == id &&
    other.ownerId == ownerId &&
    other.startDate == startDate;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albumName.hashCode) +
    (albumThumbnailAssetId == null ? 0 : albumThumbnailAssetId!.hashCode) +
    (albumUsers.hashCode) +
    (assetCount.hashCode) +
    (assetIds.hashCode) +
    (description.hashCode) +
    (endDate == null ? 0 : endDate!.hashCode) +
    (id.hashCode) +
    (ownerId.hashCode) +
    (startDate == null ? 0 : startDate!.hashCode);

  @override
  String toString() => 'AgentAlbumDetail[albumName=$albumName, albumThumbnailAssetId=$albumThumbnailAssetId, albumUsers=$albumUsers, assetCount=$assetCount, assetIds=$assetIds, description=$description, endDate=$endDate, id=$id, ownerId=$ownerId, startDate=$startDate]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albumName'] = this.albumName;
    if (this.albumThumbnailAssetId != null) {
      json[r'albumThumbnailAssetId'] = this.albumThumbnailAssetId;
    } else {
    //  json[r'albumThumbnailAssetId'] = null;
    }
      json[r'albumUsers'] = this.albumUsers;
      json[r'assetCount'] = this.assetCount;
      json[r'assetIds'] = this.assetIds;
      json[r'description'] = this.description;
    if (this.endDate != null) {
      json[r'endDate'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.endDate!.millisecondsSinceEpoch
        : this.endDate!.toUtc().toIso8601String();
    } else {
    //  json[r'endDate'] = null;
    }
      json[r'id'] = this.id;
      json[r'ownerId'] = this.ownerId;
    if (this.startDate != null) {
      json[r'startDate'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.startDate!.millisecondsSinceEpoch
        : this.startDate!.toUtc().toIso8601String();
    } else {
    //  json[r'startDate'] = null;
    }
    return json;
  }

  /// Returns a new [AgentAlbumDetail] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentAlbumDetail? fromJson(dynamic value) {
    upgradeDto(value, "AgentAlbumDetail");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentAlbumDetail(
        albumName: mapValueOfType<String>(json, r'albumName')!,
        albumThumbnailAssetId: mapValueOfType<String>(json, r'albumThumbnailAssetId'),
        albumUsers: AgentAlbumUserSummary.listFromJson(json[r'albumUsers']),
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        description: mapValueOfType<String>(json, r'description')!,
        endDate: mapDateTime(json, r'endDate', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        id: mapValueOfType<String>(json, r'id')!,
        ownerId: mapValueOfType<String>(json, r'ownerId')!,
        startDate: mapDateTime(json, r'startDate', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
      );
    }
    return null;
  }

  static List<AgentAlbumDetail> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAlbumDetail>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAlbumDetail.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentAlbumDetail> mapFromJson(dynamic json) {
    final map = <String, AgentAlbumDetail>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentAlbumDetail.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentAlbumDetail-objects as value to a dart map
  static Map<String, List<AgentAlbumDetail>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentAlbumDetail>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentAlbumDetail.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albumName',
    'albumThumbnailAssetId',
    'albumUsers',
    'assetCount',
    'assetIds',
    'description',
    'endDate',
    'id',
    'ownerId',
    'startDate',
  };
}


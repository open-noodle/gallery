//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentAlbumSummary {
  /// Returns a new [AgentAlbumSummary] instance.
  AgentAlbumSummary({
    required this.albumName,
    required this.albumThumbnailAssetId,
    required this.assetCount,
    required this.description,
    required this.endDate,
    required this.id,
    required this.ownerId,
    required this.startDate,
  });

  String albumName;

  String? albumThumbnailAssetId;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetCount;

  String description;

  DateTime? endDate;

  String id;

  String ownerId;

  DateTime? startDate;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentAlbumSummary &&
    other.albumName == albumName &&
    other.albumThumbnailAssetId == albumThumbnailAssetId &&
    other.assetCount == assetCount &&
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
    (assetCount.hashCode) +
    (description.hashCode) +
    (endDate == null ? 0 : endDate!.hashCode) +
    (id.hashCode) +
    (ownerId.hashCode) +
    (startDate == null ? 0 : startDate!.hashCode);

  @override
  String toString() => 'AgentAlbumSummary[albumName=$albumName, albumThumbnailAssetId=$albumThumbnailAssetId, assetCount=$assetCount, description=$description, endDate=$endDate, id=$id, ownerId=$ownerId, startDate=$startDate]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albumName'] = this.albumName;
    if (this.albumThumbnailAssetId != null) {
      json[r'albumThumbnailAssetId'] = this.albumThumbnailAssetId;
    } else {
    //  json[r'albumThumbnailAssetId'] = null;
    }
      json[r'assetCount'] = this.assetCount;
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

  /// Returns a new [AgentAlbumSummary] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentAlbumSummary? fromJson(dynamic value) {
    upgradeDto(value, "AgentAlbumSummary");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentAlbumSummary(
        albumName: mapValueOfType<String>(json, r'albumName')!,
        albumThumbnailAssetId: mapValueOfType<String>(json, r'albumThumbnailAssetId'),
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        description: mapValueOfType<String>(json, r'description')!,
        endDate: mapDateTime(json, r'endDate', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        id: mapValueOfType<String>(json, r'id')!,
        ownerId: mapValueOfType<String>(json, r'ownerId')!,
        startDate: mapDateTime(json, r'startDate', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
      );
    }
    return null;
  }

  static List<AgentAlbumSummary> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAlbumSummary>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAlbumSummary.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentAlbumSummary> mapFromJson(dynamic json) {
    final map = <String, AgentAlbumSummary>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentAlbumSummary.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentAlbumSummary-objects as value to a dart map
  static Map<String, List<AgentAlbumSummary>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentAlbumSummary>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentAlbumSummary.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albumName',
    'albumThumbnailAssetId',
    'assetCount',
    'description',
    'endDate',
    'id',
    'ownerId',
    'startDate',
  };
}


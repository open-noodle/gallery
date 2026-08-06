//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSpaceDetail {
  /// Returns a new [AgentSpaceDetail] instance.
  AgentSpaceDetail({
    required this.assetCount,
    this.assetIds = const [],
    required this.assetIdsReturned,
    required this.assetIdsTruncated,
    required this.color,
    required this.createdById,
    required this.description,
    required this.id,
    required this.memberCount,
    this.members = const [],
    required this.name,
    this.recentAssetIds = const [],
    required this.thumbnailAssetId,
  });

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetCount;

  List<String> assetIds;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetIdsReturned;

  bool assetIdsTruncated;

  String color;

  String createdById;

  String? description;

  String id;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int memberCount;

  List<AgentSpaceMemberSummary> members;

  String name;

  List<String> recentAssetIds;

  String? thumbnailAssetId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSpaceDetail &&
    other.assetCount == assetCount &&
    _deepEquality.equals(other.assetIds, assetIds) &&
    other.assetIdsReturned == assetIdsReturned &&
    other.assetIdsTruncated == assetIdsTruncated &&
    other.color == color &&
    other.createdById == createdById &&
    other.description == description &&
    other.id == id &&
    other.memberCount == memberCount &&
    _deepEquality.equals(other.members, members) &&
    other.name == name &&
    _deepEquality.equals(other.recentAssetIds, recentAssetIds) &&
    other.thumbnailAssetId == thumbnailAssetId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetCount.hashCode) +
    (assetIds.hashCode) +
    (assetIdsReturned.hashCode) +
    (assetIdsTruncated.hashCode) +
    (color.hashCode) +
    (createdById.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (id.hashCode) +
    (memberCount.hashCode) +
    (members.hashCode) +
    (name.hashCode) +
    (recentAssetIds.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode);

  @override
  String toString() => 'AgentSpaceDetail[assetCount=$assetCount, assetIds=$assetIds, assetIdsReturned=$assetIdsReturned, assetIdsTruncated=$assetIdsTruncated, color=$color, createdById=$createdById, description=$description, id=$id, memberCount=$memberCount, members=$members, name=$name, recentAssetIds=$recentAssetIds, thumbnailAssetId=$thumbnailAssetId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetCount'] = this.assetCount;
      json[r'assetIds'] = this.assetIds;
      json[r'assetIdsReturned'] = this.assetIdsReturned;
      json[r'assetIdsTruncated'] = this.assetIdsTruncated;
      json[r'color'] = this.color;
      json[r'createdById'] = this.createdById;
    if (this.description != null) {
      json[r'description'] = this.description;
    } else {
    //  json[r'description'] = null;
    }
      json[r'id'] = this.id;
      json[r'memberCount'] = this.memberCount;
      json[r'members'] = this.members;
      json[r'name'] = this.name;
      json[r'recentAssetIds'] = this.recentAssetIds;
    if (this.thumbnailAssetId != null) {
      json[r'thumbnailAssetId'] = this.thumbnailAssetId;
    } else {
    //  json[r'thumbnailAssetId'] = null;
    }
    return json;
  }

  /// Returns a new [AgentSpaceDetail] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSpaceDetail? fromJson(dynamic value) {
    upgradeDto(value, "AgentSpaceDetail");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSpaceDetail(
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        assetIdsReturned: mapValueOfType<int>(json, r'assetIdsReturned')!,
        assetIdsTruncated: mapValueOfType<bool>(json, r'assetIdsTruncated')!,
        color: mapValueOfType<String>(json, r'color')!,
        createdById: mapValueOfType<String>(json, r'createdById')!,
        description: mapValueOfType<String>(json, r'description'),
        id: mapValueOfType<String>(json, r'id')!,
        memberCount: mapValueOfType<int>(json, r'memberCount')!,
        members: AgentSpaceMemberSummary.listFromJson(json[r'members']),
        name: mapValueOfType<String>(json, r'name')!,
        recentAssetIds: json[r'recentAssetIds'] is Iterable
            ? (json[r'recentAssetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        thumbnailAssetId: mapValueOfType<String>(json, r'thumbnailAssetId'),
      );
    }
    return null;
  }

  static List<AgentSpaceDetail> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSpaceDetail>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSpaceDetail.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSpaceDetail> mapFromJson(dynamic json) {
    final map = <String, AgentSpaceDetail>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSpaceDetail.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSpaceDetail-objects as value to a dart map
  static Map<String, List<AgentSpaceDetail>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSpaceDetail>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSpaceDetail.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetCount',
    'assetIds',
    'assetIdsReturned',
    'assetIdsTruncated',
    'color',
    'createdById',
    'description',
    'id',
    'memberCount',
    'members',
    'name',
    'recentAssetIds',
    'thumbnailAssetId',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSpaceSummary {
  /// Returns a new [AgentSpaceSummary] instance.
  AgentSpaceSummary({
    required this.assetCount,
    required this.color,
    required this.createdById,
    required this.description,
    required this.id,
    required this.memberCount,
    required this.name,
    this.recentAssetIds = const [],
    required this.thumbnailAssetId,
  });

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetCount;

  String color;

  String createdById;

  String? description;

  String id;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int memberCount;

  String name;

  List<String> recentAssetIds;

  String? thumbnailAssetId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSpaceSummary &&
    other.assetCount == assetCount &&
    other.color == color &&
    other.createdById == createdById &&
    other.description == description &&
    other.id == id &&
    other.memberCount == memberCount &&
    other.name == name &&
    _deepEquality.equals(other.recentAssetIds, recentAssetIds) &&
    other.thumbnailAssetId == thumbnailAssetId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetCount.hashCode) +
    (color.hashCode) +
    (createdById.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (id.hashCode) +
    (memberCount.hashCode) +
    (name.hashCode) +
    (recentAssetIds.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode);

  @override
  String toString() => 'AgentSpaceSummary[assetCount=$assetCount, color=$color, createdById=$createdById, description=$description, id=$id, memberCount=$memberCount, name=$name, recentAssetIds=$recentAssetIds, thumbnailAssetId=$thumbnailAssetId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetCount'] = this.assetCount;
      json[r'color'] = this.color;
      json[r'createdById'] = this.createdById;
    if (this.description != null) {
      json[r'description'] = this.description;
    } else {
    //  json[r'description'] = null;
    }
      json[r'id'] = this.id;
      json[r'memberCount'] = this.memberCount;
      json[r'name'] = this.name;
      json[r'recentAssetIds'] = this.recentAssetIds;
    if (this.thumbnailAssetId != null) {
      json[r'thumbnailAssetId'] = this.thumbnailAssetId;
    } else {
    //  json[r'thumbnailAssetId'] = null;
    }
    return json;
  }

  /// Returns a new [AgentSpaceSummary] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSpaceSummary? fromJson(dynamic value) {
    upgradeDto(value, "AgentSpaceSummary");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSpaceSummary(
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        color: mapValueOfType<String>(json, r'color')!,
        createdById: mapValueOfType<String>(json, r'createdById')!,
        description: mapValueOfType<String>(json, r'description'),
        id: mapValueOfType<String>(json, r'id')!,
        memberCount: mapValueOfType<int>(json, r'memberCount')!,
        name: mapValueOfType<String>(json, r'name')!,
        recentAssetIds: json[r'recentAssetIds'] is Iterable
            ? (json[r'recentAssetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        thumbnailAssetId: mapValueOfType<String>(json, r'thumbnailAssetId'),
      );
    }
    return null;
  }

  static List<AgentSpaceSummary> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSpaceSummary>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSpaceSummary.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSpaceSummary> mapFromJson(dynamic json) {
    final map = <String, AgentSpaceSummary>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSpaceSummary.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSpaceSummary-objects as value to a dart map
  static Map<String, List<AgentSpaceSummary>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSpaceSummary>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSpaceSummary.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetCount',
    'color',
    'createdById',
    'description',
    'id',
    'memberCount',
    'name',
    'recentAssetIds',
    'thumbnailAssetId',
  };
}


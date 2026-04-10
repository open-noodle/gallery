//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncSharedSpaceToAssetV1 {
  /// Returns a new [SyncSharedSpaceToAssetV1] instance.
  SyncSharedSpaceToAssetV1({
    required this.assetId,
    required this.spaceId,
  });

  /// Asset ID
  String assetId;

  /// Shared space ID
  String spaceId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncSharedSpaceToAssetV1 &&
    other.assetId == assetId &&
    other.spaceId == spaceId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetId.hashCode) +
    (spaceId.hashCode);

  @override
  String toString() => 'SyncSharedSpaceToAssetV1[assetId=$assetId, spaceId=$spaceId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetId'] = this.assetId;
      json[r'spaceId'] = this.spaceId;
    return json;
  }

  /// Returns a new [SyncSharedSpaceToAssetV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncSharedSpaceToAssetV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncSharedSpaceToAssetV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncSharedSpaceToAssetV1(
        assetId: mapValueOfType<String>(json, r'assetId')!,
        spaceId: mapValueOfType<String>(json, r'spaceId')!,
      );
    }
    return null;
  }

  static List<SyncSharedSpaceToAssetV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncSharedSpaceToAssetV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncSharedSpaceToAssetV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncSharedSpaceToAssetV1> mapFromJson(dynamic json) {
    final map = <String, SyncSharedSpaceToAssetV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncSharedSpaceToAssetV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncSharedSpaceToAssetV1-objects as value to a dart map
  static Map<String, List<SyncSharedSpaceToAssetV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncSharedSpaceToAssetV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncSharedSpaceToAssetV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetId',
    'spaceId',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncLibraryAssetDeleteV1 {
  /// Returns a new [SyncLibraryAssetDeleteV1] instance.
  SyncLibraryAssetDeleteV1({
    required this.assetId,
  });

  /// Asset ID
  String assetId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncLibraryAssetDeleteV1 &&
    other.assetId == assetId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetId.hashCode);

  @override
  String toString() => 'SyncLibraryAssetDeleteV1[assetId=$assetId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetId'] = this.assetId;
    return json;
  }

  /// Returns a new [SyncLibraryAssetDeleteV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncLibraryAssetDeleteV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncLibraryAssetDeleteV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncLibraryAssetDeleteV1(
        assetId: mapValueOfType<String>(json, r'assetId')!,
      );
    }
    return null;
  }

  static List<SyncLibraryAssetDeleteV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncLibraryAssetDeleteV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncLibraryAssetDeleteV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncLibraryAssetDeleteV1> mapFromJson(dynamic json) {
    final map = <String, SyncLibraryAssetDeleteV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncLibraryAssetDeleteV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncLibraryAssetDeleteV1-objects as value to a dart map
  static Map<String, List<SyncLibraryAssetDeleteV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncLibraryAssetDeleteV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncLibraryAssetDeleteV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetId',
  };
}


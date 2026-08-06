//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationResponseDtoReviewMetadataAssetMetadata {
  /// Returns a new [AgentOperationResponseDtoReviewMetadataAssetMetadata] instance.
  AgentOperationResponseDtoReviewMetadataAssetMetadata({
    this.fields = const [],
    this.sampleAssetIds = const [],
    this.warnings = const [],
  });

  List<AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner> fields;

  List<String> sampleAssetIds;

  List<String> warnings;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationResponseDtoReviewMetadataAssetMetadata &&
    _deepEquality.equals(other.fields, fields) &&
    _deepEquality.equals(other.sampleAssetIds, sampleAssetIds) &&
    _deepEquality.equals(other.warnings, warnings);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (fields.hashCode) +
    (sampleAssetIds.hashCode) +
    (warnings.hashCode);

  @override
  String toString() => 'AgentOperationResponseDtoReviewMetadataAssetMetadata[fields=$fields, sampleAssetIds=$sampleAssetIds, warnings=$warnings]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'fields'] = this.fields;
      json[r'sampleAssetIds'] = this.sampleAssetIds;
      json[r'warnings'] = this.warnings;
    return json;
  }

  /// Returns a new [AgentOperationResponseDtoReviewMetadataAssetMetadata] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationResponseDtoReviewMetadataAssetMetadata? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationResponseDtoReviewMetadataAssetMetadata");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationResponseDtoReviewMetadataAssetMetadata(
        fields: AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner.listFromJson(json[r'fields']),
        sampleAssetIds: json[r'sampleAssetIds'] is Iterable
            ? (json[r'sampleAssetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        warnings: json[r'warnings'] is Iterable
            ? (json[r'warnings'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AgentOperationResponseDtoReviewMetadataAssetMetadata> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationResponseDtoReviewMetadataAssetMetadata>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationResponseDtoReviewMetadataAssetMetadata.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationResponseDtoReviewMetadataAssetMetadata> mapFromJson(dynamic json) {
    final map = <String, AgentOperationResponseDtoReviewMetadataAssetMetadata>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationResponseDtoReviewMetadataAssetMetadata.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationResponseDtoReviewMetadataAssetMetadata-objects as value to a dart map
  static Map<String, List<AgentOperationResponseDtoReviewMetadataAssetMetadata>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationResponseDtoReviewMetadataAssetMetadata>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationResponseDtoReviewMetadataAssetMetadata.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'fields',
    'sampleAssetIds',
    'warnings',
  };
}


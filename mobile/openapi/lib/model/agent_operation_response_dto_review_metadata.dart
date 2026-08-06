//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationResponseDtoReviewMetadata {
  /// Returns a new [AgentOperationResponseDtoReviewMetadata] instance.
  AgentOperationResponseDtoReviewMetadata({
    this.assetMetadata = const Optional.absent(),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentOperationResponseDtoReviewMetadataAssetMetadata?> assetMetadata;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationResponseDtoReviewMetadata &&
    other.assetMetadata == assetMetadata;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetMetadata == null ? 0 : assetMetadata!.hashCode);

  @override
  String toString() => 'AgentOperationResponseDtoReviewMetadata[assetMetadata=$assetMetadata]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.assetMetadata.isPresent) {
      final value = this.assetMetadata.value;
      json[r'assetMetadata'] = value;
    }
    return json;
  }

  /// Returns a new [AgentOperationResponseDtoReviewMetadata] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationResponseDtoReviewMetadata? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationResponseDtoReviewMetadata");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationResponseDtoReviewMetadata(
        assetMetadata: json.containsKey(r'assetMetadata') ? Optional.present(AgentOperationResponseDtoReviewMetadataAssetMetadata.fromJson(json[r'assetMetadata'])) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentOperationResponseDtoReviewMetadata> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationResponseDtoReviewMetadata>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationResponseDtoReviewMetadata.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationResponseDtoReviewMetadata> mapFromJson(dynamic json) {
    final map = <String, AgentOperationResponseDtoReviewMetadata>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationResponseDtoReviewMetadata.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationResponseDtoReviewMetadata-objects as value to a dart map
  static Map<String, List<AgentOperationResponseDtoReviewMetadata>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationResponseDtoReviewMetadata>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationResponseDtoReviewMetadata.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


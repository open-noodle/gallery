//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner {
  /// Returns a new [AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner] instance.
  AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner({
    required this.assetId,
    required this.value,
    required this.valueKind,
  });

  String assetId;

  String? value;

  AgentOperationReviewMetadataValueKind valueKind;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner &&
    other.assetId == assetId &&
    other.value == value &&
    other.valueKind == valueKind;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetId.hashCode) +
    (value == null ? 0 : value!.hashCode) +
    (valueKind.hashCode);

  @override
  String toString() => 'AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner[assetId=$assetId, value=$value, valueKind=$valueKind]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetId'] = this.assetId;
    if (this.value != null) {
      json[r'value'] = this.value;
    } else {
    //  json[r'value'] = null;
    }
      json[r'valueKind'] = this.valueKind;
    return json;
  }

  /// Returns a new [AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner(
        assetId: mapValueOfType<String>(json, r'assetId')!,
        value: mapValueOfType<String>(json, r'value'),
        valueKind: AgentOperationReviewMetadataValueKind.fromJson(json[r'valueKind'])!,
      );
    }
    return null;
  }

  static List<AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner> mapFromJson(dynamic json) {
    final map = <String, AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner-objects as value to a dart map
  static Map<String, List<AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetId',
    'value',
    'valueKind',
  };
}


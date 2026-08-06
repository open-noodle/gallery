//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner {
  /// Returns a new [AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner] instance.
  AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner({
    required this.key,
    required this.label,
    this.previousValues = const [],
    required this.proposedValue,
    required this.proposedValueKind,
  });

  String key;

  String label;

  List<AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner> previousValues;

  String? proposedValue;

  AgentOperationReviewMetadataValueKind proposedValueKind;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner &&
    other.key == key &&
    other.label == label &&
    _deepEquality.equals(other.previousValues, previousValues) &&
    other.proposedValue == proposedValue &&
    other.proposedValueKind == proposedValueKind;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key.hashCode) +
    (label.hashCode) +
    (previousValues.hashCode) +
    (proposedValue == null ? 0 : proposedValue!.hashCode) +
    (proposedValueKind.hashCode);

  @override
  String toString() => 'AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner[key=$key, label=$label, previousValues=$previousValues, proposedValue=$proposedValue, proposedValueKind=$proposedValueKind]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'key'] = this.key;
      json[r'label'] = this.label;
      json[r'previousValues'] = this.previousValues;
    if (this.proposedValue != null) {
      json[r'proposedValue'] = this.proposedValue;
    } else {
    //  json[r'proposedValue'] = null;
    }
      json[r'proposedValueKind'] = this.proposedValueKind;
    return json;
  }

  /// Returns a new [AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner(
        key: mapValueOfType<String>(json, r'key')!,
        label: mapValueOfType<String>(json, r'label')!,
        previousValues: AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner.listFromJson(json[r'previousValues']),
        proposedValue: mapValueOfType<String>(json, r'proposedValue'),
        proposedValueKind: AgentOperationReviewMetadataValueKind.fromJson(json[r'proposedValueKind'])!,
      );
    }
    return null;
  }

  static List<AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner> mapFromJson(dynamic json) {
    final map = <String, AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner-objects as value to a dart map
  static Map<String, List<AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'key',
    'label',
    'previousValues',
    'proposedValue',
    'proposedValueKind',
  };
}


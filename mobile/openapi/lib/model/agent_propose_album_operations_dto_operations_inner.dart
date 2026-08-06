//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProposeAlbumOperationsDtoOperationsInner {
  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInner] instance.
  AgentProposeAlbumOperationsDtoOperationsInner({
    required this.type,
    required this.summary,
    required this.targetKind,
    this.temporaryTargetId = const Optional.absent(),
    this.riskLevel = const Optional.absent(),
    this.enabled = const Optional.present(true),
    required this.payload,
    this.targetId = const Optional.absent(),
    this.assetSource = const Optional.absent(),
    this.assetIds = const Optional.present(const []),
    this.assetSelectionHandleId = const Optional.absent(),
  });

  AgentPersonMergeOperationType type;

  String summary;

  AgentOperationPersonTargetKind targetKind;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> temporaryTargetId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentOperationRiskLevel?> riskLevel;

  Optional<bool?> enabled;

  AgentProposeAlbumOperationsDtoOperationsInnerOneOf34Payload payload;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> targetId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentOperationPlanningAssetSourceInput?> assetSource;

  Optional<List<String>?> assetIds;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> assetSelectionHandleId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProposeAlbumOperationsDtoOperationsInner &&
    other.type == type &&
    other.summary == summary &&
    other.targetKind == targetKind &&
    other.temporaryTargetId == temporaryTargetId &&
    other.riskLevel == riskLevel &&
    other.enabled == enabled &&
    other.payload == payload &&
    other.targetId == targetId &&
    other.assetSource == assetSource &&
    _deepEquality.equals(other.assetIds, assetIds) &&
    other.assetSelectionHandleId == assetSelectionHandleId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (type.hashCode) +
    (summary.hashCode) +
    (targetKind.hashCode) +
    (temporaryTargetId == null ? 0 : temporaryTargetId!.hashCode) +
    (riskLevel == null ? 0 : riskLevel!.hashCode) +
    (enabled.hashCode) +
    (payload.hashCode) +
    (targetId == null ? 0 : targetId!.hashCode) +
    (assetSource == null ? 0 : assetSource!.hashCode) +
    (assetIds.hashCode) +
    (assetSelectionHandleId == null ? 0 : assetSelectionHandleId!.hashCode);

  @override
  String toString() => 'AgentProposeAlbumOperationsDtoOperationsInner[type=$type, summary=$summary, targetKind=$targetKind, temporaryTargetId=$temporaryTargetId, riskLevel=$riskLevel, enabled=$enabled, payload=$payload, targetId=$targetId, assetSource=$assetSource, assetIds=$assetIds, assetSelectionHandleId=$assetSelectionHandleId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'type'] = this.type;
      json[r'summary'] = this.summary;
      json[r'targetKind'] = this.targetKind;
    if (this.temporaryTargetId.isPresent) {
      final value = this.temporaryTargetId.value;
      json[r'temporaryTargetId'] = value;
    }
    if (this.riskLevel.isPresent) {
      final value = this.riskLevel.value;
      json[r'riskLevel'] = value;
    }
    if (this.enabled.isPresent) {
      final value = this.enabled.value;
      json[r'enabled'] = value;
    }
      json[r'payload'] = this.payload;
    if (this.targetId.isPresent) {
      final value = this.targetId.value;
      json[r'targetId'] = value;
    }
    if (this.assetSource.isPresent) {
      final value = this.assetSource.value;
      json[r'assetSource'] = value;
    }
    if (this.assetIds.isPresent) {
      final value = this.assetIds.value;
      json[r'assetIds'] = value;
    }
    if (this.assetSelectionHandleId.isPresent) {
      final value = this.assetSelectionHandleId.value;
      json[r'assetSelectionHandleId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProposeAlbumOperationsDtoOperationsInner? fromJson(dynamic value) {
    upgradeDto(value, "AgentProposeAlbumOperationsDtoOperationsInner");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProposeAlbumOperationsDtoOperationsInner(
        type: AgentPersonMergeOperationType.fromJson(json[r'type'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        targetKind: AgentOperationPersonTargetKind.fromJson(json[r'targetKind'])!,
        temporaryTargetId: json.containsKey(r'temporaryTargetId') ? Optional.present(mapValueOfType<String>(json, r'temporaryTargetId')) : const Optional.absent(),
        riskLevel: json.containsKey(r'riskLevel') ? Optional.present(AgentOperationRiskLevel.fromJson(json[r'riskLevel'])) : const Optional.absent(),
        enabled: json.containsKey(r'enabled') ? Optional.present(mapValueOfType<bool>(json, r'enabled')) : const Optional.absent(),
        payload: AgentProposeAlbumOperationsDtoOperationsInnerOneOf34Payload.fromJson(json[r'payload'])!,
        targetId: json.containsKey(r'targetId') ? Optional.present(mapValueOfType<String>(json, r'targetId')) : const Optional.absent(),
        assetSource: json.containsKey(r'assetSource') ? Optional.present(AgentOperationPlanningAssetSourceInput.fromJson(json[r'assetSource'])) : const Optional.absent(),
        assetIds: json.containsKey(r'assetIds') ? Optional.present(json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        assetSelectionHandleId: json.containsKey(r'assetSelectionHandleId') ? Optional.present(mapValueOfType<String>(json, r'assetSelectionHandleId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentProposeAlbumOperationsDtoOperationsInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProposeAlbumOperationsDtoOperationsInner> mapFromJson(dynamic json) {
    final map = <String, AgentProposeAlbumOperationsDtoOperationsInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProposeAlbumOperationsDtoOperationsInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProposeAlbumOperationsDtoOperationsInner-objects as value to a dart map
  static Map<String, List<AgentProposeAlbumOperationsDtoOperationsInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProposeAlbumOperationsDtoOperationsInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProposeAlbumOperationsDtoOperationsInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'type',
    'summary',
    'targetKind',
    'payload',
  };
}


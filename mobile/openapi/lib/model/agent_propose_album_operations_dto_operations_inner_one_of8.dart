//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProposeAlbumOperationsDtoOperationsInnerOneOf8 {
  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf8] instance.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf8({
    required this.type,
    required this.summary,
    required this.targetKind,
    this.targetId = const Optional.absent(),
    this.riskLevel = const Optional.absent(),
    this.enabled = const Optional.present(true),
    required this.payload,
  });

  AgentSpaceUpdateDetailsOperationType type;

  String summary;

  AgentOperationExistingSpaceTargetKind targetKind;

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
  Optional<AgentOperationRiskLevel?> riskLevel;

  Optional<bool?> enabled;

  AgentProposeAlbumOperationsDtoOperationsInnerOneOf8Payload payload;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProposeAlbumOperationsDtoOperationsInnerOneOf8 &&
    other.type == type &&
    other.summary == summary &&
    other.targetKind == targetKind &&
    other.targetId == targetId &&
    other.riskLevel == riskLevel &&
    other.enabled == enabled &&
    other.payload == payload;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (type.hashCode) +
    (summary.hashCode) +
    (targetKind.hashCode) +
    (targetId == null ? 0 : targetId!.hashCode) +
    (riskLevel == null ? 0 : riskLevel!.hashCode) +
    (enabled.hashCode) +
    (payload.hashCode);

  @override
  String toString() => 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf8[type=$type, summary=$summary, targetKind=$targetKind, targetId=$targetId, riskLevel=$riskLevel, enabled=$enabled, payload=$payload]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'type'] = this.type;
      json[r'summary'] = this.summary;
      json[r'targetKind'] = this.targetKind;
    if (this.targetId.isPresent) {
      final value = this.targetId.value;
      json[r'targetId'] = value;
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
    return json;
  }

  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf8] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf8? fromJson(dynamic value) {
    upgradeDto(value, "AgentProposeAlbumOperationsDtoOperationsInnerOneOf8");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProposeAlbumOperationsDtoOperationsInnerOneOf8(
        type: AgentSpaceUpdateDetailsOperationType.fromJson(json[r'type'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        targetKind: AgentOperationExistingSpaceTargetKind.fromJson(json[r'targetKind'])!,
        targetId: json.containsKey(r'targetId') ? Optional.present(mapValueOfType<String>(json, r'targetId')) : const Optional.absent(),
        riskLevel: json.containsKey(r'riskLevel') ? Optional.present(AgentOperationRiskLevel.fromJson(json[r'riskLevel'])) : const Optional.absent(),
        enabled: json.containsKey(r'enabled') ? Optional.present(mapValueOfType<bool>(json, r'enabled')) : const Optional.absent(),
        payload: AgentProposeAlbumOperationsDtoOperationsInnerOneOf8Payload.fromJson(json[r'payload'])!,
      );
    }
    return null;
  }

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf8> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf8>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf8.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf8> mapFromJson(dynamic json) {
    final map = <String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf8>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf8.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProposeAlbumOperationsDtoOperationsInnerOneOf8-objects as value to a dart map
  static Map<String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf8>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf8>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProposeAlbumOperationsDtoOperationsInnerOneOf8.listFromJson(entry.value, growable: growable,);
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


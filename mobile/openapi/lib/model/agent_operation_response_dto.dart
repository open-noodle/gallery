//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationResponseDto {
  /// Returns a new [AgentOperationResponseDto] instance.
  AgentOperationResponseDto({
    this.assetIds = const [],
    required this.createdAt,
    this.dependencyIds = const [],
    required this.enabled,
    required this.error,
    required this.id,
    this.payload = const {},
    required this.planId,
    this.result = const {},
    this.reviewMetadata = const Optional.absent(),
    required this.riskLevel,
    required this.status,
    required this.summary,
    required this.targetId,
    required this.targetKind,
    required this.temporaryTargetId,
    required this.type,
    required this.updatedAt,
  });

  List<String> assetIds;

  DateTime createdAt;

  List<String> dependencyIds;

  bool enabled;

  String? error;

  String id;

  Map<String, Object> payload;

  String planId;

  Map<String, Object>? result;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentOperationResponseDtoReviewMetadata?> reviewMetadata;

  AgentOperationRiskLevel riskLevel;

  AgentOperationStatus status;

  String summary;

  String? targetId;

  AgentOperationTargetKind targetKind;

  String? temporaryTargetId;

  AgentOperationType type;

  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationResponseDto &&
    _deepEquality.equals(other.assetIds, assetIds) &&
    other.createdAt == createdAt &&
    _deepEquality.equals(other.dependencyIds, dependencyIds) &&
    other.enabled == enabled &&
    other.error == error &&
    other.id == id &&
    _deepEquality.equals(other.payload, payload) &&
    other.planId == planId &&
    _deepEquality.equals(other.result, result) &&
    other.reviewMetadata == reviewMetadata &&
    other.riskLevel == riskLevel &&
    other.status == status &&
    other.summary == summary &&
    other.targetId == targetId &&
    other.targetKind == targetKind &&
    other.temporaryTargetId == temporaryTargetId &&
    other.type == type &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetIds.hashCode) +
    (createdAt.hashCode) +
    (dependencyIds.hashCode) +
    (enabled.hashCode) +
    (error == null ? 0 : error!.hashCode) +
    (id.hashCode) +
    (payload.hashCode) +
    (planId.hashCode) +
    (result == null ? 0 : result!.hashCode) +
    (reviewMetadata == null ? 0 : reviewMetadata!.hashCode) +
    (riskLevel.hashCode) +
    (status.hashCode) +
    (summary.hashCode) +
    (targetId == null ? 0 : targetId!.hashCode) +
    (targetKind.hashCode) +
    (temporaryTargetId == null ? 0 : temporaryTargetId!.hashCode) +
    (type.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'AgentOperationResponseDto[assetIds=$assetIds, createdAt=$createdAt, dependencyIds=$dependencyIds, enabled=$enabled, error=$error, id=$id, payload=$payload, planId=$planId, result=$result, reviewMetadata=$reviewMetadata, riskLevel=$riskLevel, status=$status, summary=$summary, targetId=$targetId, targetKind=$targetKind, temporaryTargetId=$temporaryTargetId, type=$type, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetIds'] = this.assetIds;
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
      json[r'dependencyIds'] = this.dependencyIds;
      json[r'enabled'] = this.enabled;
    if (this.error != null) {
      json[r'error'] = this.error;
    } else {
      json[r'error'] = null;
    }
      json[r'id'] = this.id;
      json[r'payload'] = this.payload;
      json[r'planId'] = this.planId;
    if (this.result != null) {
      json[r'result'] = this.result;
    } else {
      json[r'result'] = null;
    }
    if (this.reviewMetadata.isPresent) {
      final value = this.reviewMetadata.value;
      json[r'reviewMetadata'] = value;
    }
      json[r'riskLevel'] = this.riskLevel;
      json[r'status'] = this.status;
      json[r'summary'] = this.summary;
    if (this.targetId != null) {
      json[r'targetId'] = this.targetId;
    } else {
      json[r'targetId'] = null;
    }
      json[r'targetKind'] = this.targetKind;
    if (this.temporaryTargetId != null) {
      json[r'temporaryTargetId'] = this.temporaryTargetId;
    } else {
      json[r'temporaryTargetId'] = null;
    }
      json[r'type'] = this.type;
      json[r'updatedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.updatedAt.millisecondsSinceEpoch
        : this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [AgentOperationResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationResponseDto(
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        dependencyIds: json[r'dependencyIds'] is Iterable
            ? (json[r'dependencyIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        error: mapValueOfType<String>(json, r'error'),
        id: mapValueOfType<String>(json, r'id')!,
        payload: mapCastOfType<String, Object>(json, r'payload')!,
        planId: mapValueOfType<String>(json, r'planId')!,
        result: mapCastOfType<String, Object>(json, r'result'),
        reviewMetadata: json.containsKey(r'reviewMetadata') ? Optional.present(AgentOperationResponseDtoReviewMetadata.fromJson(json[r'reviewMetadata'])) : const Optional.absent(),
        riskLevel: AgentOperationRiskLevel.fromJson(json[r'riskLevel'])!,
        status: AgentOperationStatus.fromJson(json[r'status'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        targetId: mapValueOfType<String>(json, r'targetId'),
        targetKind: AgentOperationTargetKind.fromJson(json[r'targetKind'])!,
        temporaryTargetId: mapValueOfType<String>(json, r'temporaryTargetId'),
        type: AgentOperationType.fromJson(json[r'type'])!,
        updatedAt: mapDateTime(json, r'updatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
      );
    }
    return null;
  }

  static List<AgentOperationResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentOperationResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationResponseDto-objects as value to a dart map
  static Map<String, List<AgentOperationResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetIds',
    'createdAt',
    'dependencyIds',
    'enabled',
    'error',
    'id',
    'payload',
    'planId',
    'result',
    'riskLevel',
    'status',
    'summary',
    'targetId',
    'targetKind',
    'temporaryTargetId',
    'type',
    'updatedAt',
  };
}


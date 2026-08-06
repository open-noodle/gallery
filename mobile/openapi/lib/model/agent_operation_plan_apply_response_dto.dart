//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationPlanApplyResponseDto {
  /// Returns a new [AgentOperationPlanApplyResponseDto] instance.
  AgentOperationPlanApplyResponseDto({
    this.appliedOperationIds = const [],
    this.failedOperationIds = const [],
    required this.plan,
    this.skippedOperationIds = const [],
    required this.status,
    required this.summary,
  });

  List<String> appliedOperationIds;

  List<String> failedOperationIds;

  AgentOperationPlanResponseDto plan;

  List<String> skippedOperationIds;

  AgentOperationApplyStatus status;

  String summary;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationPlanApplyResponseDto &&
    _deepEquality.equals(other.appliedOperationIds, appliedOperationIds) &&
    _deepEquality.equals(other.failedOperationIds, failedOperationIds) &&
    other.plan == plan &&
    _deepEquality.equals(other.skippedOperationIds, skippedOperationIds) &&
    other.status == status &&
    other.summary == summary;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (appliedOperationIds.hashCode) +
    (failedOperationIds.hashCode) +
    (plan.hashCode) +
    (skippedOperationIds.hashCode) +
    (status.hashCode) +
    (summary.hashCode);

  @override
  String toString() => 'AgentOperationPlanApplyResponseDto[appliedOperationIds=$appliedOperationIds, failedOperationIds=$failedOperationIds, plan=$plan, skippedOperationIds=$skippedOperationIds, status=$status, summary=$summary]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'appliedOperationIds'] = this.appliedOperationIds;
      json[r'failedOperationIds'] = this.failedOperationIds;
      json[r'plan'] = this.plan;
      json[r'skippedOperationIds'] = this.skippedOperationIds;
      json[r'status'] = this.status;
      json[r'summary'] = this.summary;
    return json;
  }

  /// Returns a new [AgentOperationPlanApplyResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationPlanApplyResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationPlanApplyResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationPlanApplyResponseDto(
        appliedOperationIds: json[r'appliedOperationIds'] is Iterable
            ? (json[r'appliedOperationIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        failedOperationIds: json[r'failedOperationIds'] is Iterable
            ? (json[r'failedOperationIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        plan: AgentOperationPlanResponseDto.fromJson(json[r'plan'])!,
        skippedOperationIds: json[r'skippedOperationIds'] is Iterable
            ? (json[r'skippedOperationIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        status: AgentOperationApplyStatus.fromJson(json[r'status'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
      );
    }
    return null;
  }

  static List<AgentOperationPlanApplyResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanApplyResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanApplyResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationPlanApplyResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentOperationPlanApplyResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationPlanApplyResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationPlanApplyResponseDto-objects as value to a dart map
  static Map<String, List<AgentOperationPlanApplyResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationPlanApplyResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationPlanApplyResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'appliedOperationIds',
    'failedOperationIds',
    'plan',
    'skippedOperationIds',
    'status',
    'summary',
  };
}


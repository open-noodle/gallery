//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSessionActivityEventResponseDto {
  /// Returns a new [AgentSessionActivityEventResponseDto] instance.
  AgentSessionActivityEventResponseDto({
    required this.counts,
    required this.createdAt,
    required this.id,
    required this.kind,
    required this.sessionId,
    required this.source_,
    required this.status,
    required this.summary,
  });

  AgentSessionActivityEventCounts? counts;

  DateTime createdAt;

  String id;

  AgentSessionActivityEventResponseDtoKindEnum kind;

  String sessionId;

  AgentSessionActivityEventSource source_;

  AgentSessionActivityEventStatus status;

  String? summary;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSessionActivityEventResponseDto &&
    other.counts == counts &&
    other.createdAt == createdAt &&
    other.id == id &&
    other.kind == kind &&
    other.sessionId == sessionId &&
    other.source_ == source_ &&
    other.status == status &&
    other.summary == summary;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (counts == null ? 0 : counts!.hashCode) +
    (createdAt.hashCode) +
    (id.hashCode) +
    (kind.hashCode) +
    (sessionId.hashCode) +
    (source_.hashCode) +
    (status.hashCode) +
    (summary == null ? 0 : summary!.hashCode);

  @override
  String toString() => 'AgentSessionActivityEventResponseDto[counts=$counts, createdAt=$createdAt, id=$id, kind=$kind, sessionId=$sessionId, source_=$source_, status=$status, summary=$summary]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.counts != null) {
      json[r'counts'] = this.counts;
    } else {
    //  json[r'counts'] = null;
    }
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
      json[r'id'] = this.id;
      json[r'kind'] = this.kind;
      json[r'sessionId'] = this.sessionId;
      json[r'source'] = this.source_;
      json[r'status'] = this.status;
    if (this.summary != null) {
      json[r'summary'] = this.summary;
    } else {
    //  json[r'summary'] = null;
    }
    return json;
  }

  /// Returns a new [AgentSessionActivityEventResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSessionActivityEventResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSessionActivityEventResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSessionActivityEventResponseDto(
        counts: AgentSessionActivityEventCounts.fromJson(json[r'counts']),
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        id: mapValueOfType<String>(json, r'id')!,
        kind: AgentSessionActivityEventResponseDtoKindEnum.fromJson(json[r'kind'])!,
        sessionId: mapValueOfType<String>(json, r'sessionId')!,
        source_: AgentSessionActivityEventSource.fromJson(json[r'source'])!,
        status: AgentSessionActivityEventStatus.fromJson(json[r'status'])!,
        summary: mapValueOfType<String>(json, r'summary'),
      );
    }
    return null;
  }

  static List<AgentSessionActivityEventResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSessionActivityEventResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSessionActivityEventResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSessionActivityEventResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentSessionActivityEventResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSessionActivityEventResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSessionActivityEventResponseDto-objects as value to a dart map
  static Map<String, List<AgentSessionActivityEventResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSessionActivityEventResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSessionActivityEventResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'counts',
    'createdAt',
    'id',
    'kind',
    'sessionId',
    'source',
    'status',
    'summary',
  };
}


class AgentSessionActivityEventResponseDtoKindEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSessionActivityEventResponseDtoKindEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const startProcessing = AgentSessionActivityEventResponseDtoKindEnum._(r'start-processing');
  static const planComposing = AgentSessionActivityEventResponseDtoKindEnum._(r'plan-composing');
  static const applyProgress = AgentSessionActivityEventResponseDtoKindEnum._(r'apply-progress');
  static const runnerRecovery = AgentSessionActivityEventResponseDtoKindEnum._(r'runner-recovery');
  static const strictRouterDecision = AgentSessionActivityEventResponseDtoKindEnum._(r'strict_router_decision');
  static const strictWorkflowOutcome = AgentSessionActivityEventResponseDtoKindEnum._(r'strict_workflow_outcome');
  static const strictSuccessGateBlock = AgentSessionActivityEventResponseDtoKindEnum._(r'strict_success_gate_block');
  static const strictContinuation = AgentSessionActivityEventResponseDtoKindEnum._(r'strict_continuation');
  static const unknown = AgentSessionActivityEventResponseDtoKindEnum._(r'unknown');

  /// List of all possible values in this [enum][AgentSessionActivityEventResponseDtoKindEnum].
  static const values = <AgentSessionActivityEventResponseDtoKindEnum>[
    startProcessing,
    planComposing,
    applyProgress,
    runnerRecovery,
    strictRouterDecision,
    strictWorkflowOutcome,
    strictSuccessGateBlock,
    strictContinuation,
    unknown,
  ];

  static AgentSessionActivityEventResponseDtoKindEnum? fromJson(dynamic value) => AgentSessionActivityEventResponseDtoKindEnumTypeTransformer().decode(value);

  static List<AgentSessionActivityEventResponseDtoKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSessionActivityEventResponseDtoKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSessionActivityEventResponseDtoKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSessionActivityEventResponseDtoKindEnum] to String,
/// and [decode] dynamic data back to [AgentSessionActivityEventResponseDtoKindEnum].
class AgentSessionActivityEventResponseDtoKindEnumTypeTransformer {
  factory AgentSessionActivityEventResponseDtoKindEnumTypeTransformer() => _instance ??= const AgentSessionActivityEventResponseDtoKindEnumTypeTransformer._();

  const AgentSessionActivityEventResponseDtoKindEnumTypeTransformer._();

  String encode(AgentSessionActivityEventResponseDtoKindEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSessionActivityEventResponseDtoKindEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSessionActivityEventResponseDtoKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'start-processing': return AgentSessionActivityEventResponseDtoKindEnum.startProcessing;
        case r'plan-composing': return AgentSessionActivityEventResponseDtoKindEnum.planComposing;
        case r'apply-progress': return AgentSessionActivityEventResponseDtoKindEnum.applyProgress;
        case r'runner-recovery': return AgentSessionActivityEventResponseDtoKindEnum.runnerRecovery;
        case r'strict_router_decision': return AgentSessionActivityEventResponseDtoKindEnum.strictRouterDecision;
        case r'strict_workflow_outcome': return AgentSessionActivityEventResponseDtoKindEnum.strictWorkflowOutcome;
        case r'strict_success_gate_block': return AgentSessionActivityEventResponseDtoKindEnum.strictSuccessGateBlock;
        case r'strict_continuation': return AgentSessionActivityEventResponseDtoKindEnum.strictContinuation;
        case r'unknown': return AgentSessionActivityEventResponseDtoKindEnum.unknown;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSessionActivityEventResponseDtoKindEnumTypeTransformer] instance.
  static AgentSessionActivityEventResponseDtoKindEnumTypeTransformer? _instance;
}



//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationPlanResponseDto {
  /// Returns a new [AgentOperationPlanResponseDto] instance.
  AgentOperationPlanResponseDto({
    required this.createdAt,
    required this.id,
    this.operations = const [],
    required this.revision,
    required this.sessionId,
    required this.status,
    required this.summary,
    required this.updatedAt,
  });

  DateTime createdAt;

  String id;

  List<AgentOperationResponseDto> operations;

  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  int revision;

  String sessionId;

  AgentOperationPlanStatus status;

  String summary;

  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationPlanResponseDto &&
    other.createdAt == createdAt &&
    other.id == id &&
    _deepEquality.equals(other.operations, operations) &&
    other.revision == revision &&
    other.sessionId == sessionId &&
    other.status == status &&
    other.summary == summary &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (createdAt.hashCode) +
    (id.hashCode) +
    (operations.hashCode) +
    (revision.hashCode) +
    (sessionId.hashCode) +
    (status.hashCode) +
    (summary.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'AgentOperationPlanResponseDto[createdAt=$createdAt, id=$id, operations=$operations, revision=$revision, sessionId=$sessionId, status=$status, summary=$summary, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
      json[r'id'] = this.id;
      json[r'operations'] = this.operations;
      json[r'revision'] = this.revision;
      json[r'sessionId'] = this.sessionId;
      json[r'status'] = this.status;
      json[r'summary'] = this.summary;
      json[r'updatedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.updatedAt.millisecondsSinceEpoch
        : this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [AgentOperationPlanResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationPlanResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationPlanResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationPlanResponseDto(
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        id: mapValueOfType<String>(json, r'id')!,
        operations: AgentOperationResponseDto.listFromJson(json[r'operations']),
        revision: mapValueOfType<int>(json, r'revision')!,
        sessionId: mapValueOfType<String>(json, r'sessionId')!,
        status: AgentOperationPlanStatus.fromJson(json[r'status'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        updatedAt: mapDateTime(json, r'updatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
      );
    }
    return null;
  }

  static List<AgentOperationPlanResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationPlanResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentOperationPlanResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationPlanResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationPlanResponseDto-objects as value to a dart map
  static Map<String, List<AgentOperationPlanResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationPlanResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationPlanResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'createdAt',
    'id',
    'operations',
    'revision',
    'sessionId',
    'status',
    'summary',
    'updatedAt',
  };
}


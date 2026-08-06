//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentToolCallResponseDto {
  /// Returns a new [AgentToolCallResponseDto] instance.
  AgentToolCallResponseDto({
    required this.albumCount,
    required this.approvalDecision,
    required this.assetCount,
    required this.completedAt,
    required this.dataClass,
    required this.error,
    required this.id,
    required this.requestSummary,
    required this.responseSummary,
    this.resultSize = const Optional.absent(),
    required this.sessionId,
    required this.startedAt,
    required this.status,
    required this.toolName,
  });

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int albumCount;

  AgentToolApprovalDecision? approvalDecision;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetCount;

  DateTime? completedAt;

  AgentToolDataClass dataClass;

  String? error;

  String id;

  String requestSummary;

  String? responseSummary;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentToolResultSize?> resultSize;

  String sessionId;

  DateTime startedAt;

  AgentToolCallStatus status;

  AgentToolName toolName;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentToolCallResponseDto &&
    other.albumCount == albumCount &&
    other.approvalDecision == approvalDecision &&
    other.assetCount == assetCount &&
    other.completedAt == completedAt &&
    other.dataClass == dataClass &&
    other.error == error &&
    other.id == id &&
    other.requestSummary == requestSummary &&
    other.responseSummary == responseSummary &&
    other.resultSize == resultSize &&
    other.sessionId == sessionId &&
    other.startedAt == startedAt &&
    other.status == status &&
    other.toolName == toolName;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albumCount.hashCode) +
    (approvalDecision == null ? 0 : approvalDecision!.hashCode) +
    (assetCount.hashCode) +
    (completedAt == null ? 0 : completedAt!.hashCode) +
    (dataClass.hashCode) +
    (error == null ? 0 : error!.hashCode) +
    (id.hashCode) +
    (requestSummary.hashCode) +
    (responseSummary == null ? 0 : responseSummary!.hashCode) +
    (resultSize == null ? 0 : resultSize!.hashCode) +
    (sessionId.hashCode) +
    (startedAt.hashCode) +
    (status.hashCode) +
    (toolName.hashCode);

  @override
  String toString() => 'AgentToolCallResponseDto[albumCount=$albumCount, approvalDecision=$approvalDecision, assetCount=$assetCount, completedAt=$completedAt, dataClass=$dataClass, error=$error, id=$id, requestSummary=$requestSummary, responseSummary=$responseSummary, resultSize=$resultSize, sessionId=$sessionId, startedAt=$startedAt, status=$status, toolName=$toolName]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albumCount'] = this.albumCount;
    if (this.approvalDecision != null) {
      json[r'approvalDecision'] = this.approvalDecision;
    } else {
    //  json[r'approvalDecision'] = null;
    }
      json[r'assetCount'] = this.assetCount;
    if (this.completedAt != null) {
      json[r'completedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.completedAt!.millisecondsSinceEpoch
        : this.completedAt!.toUtc().toIso8601String();
    } else {
    //  json[r'completedAt'] = null;
    }
      json[r'dataClass'] = this.dataClass;
    if (this.error != null) {
      json[r'error'] = this.error;
    } else {
    //  json[r'error'] = null;
    }
      json[r'id'] = this.id;
      json[r'requestSummary'] = this.requestSummary;
    if (this.responseSummary != null) {
      json[r'responseSummary'] = this.responseSummary;
    } else {
    //  json[r'responseSummary'] = null;
    }
    if (this.resultSize.isPresent) {
      final value = this.resultSize.value;
      json[r'resultSize'] = value;
    }
      json[r'sessionId'] = this.sessionId;
      json[r'startedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.startedAt.millisecondsSinceEpoch
        : this.startedAt.toUtc().toIso8601String();
      json[r'status'] = this.status;
      json[r'toolName'] = this.toolName;
    return json;
  }

  /// Returns a new [AgentToolCallResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentToolCallResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentToolCallResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentToolCallResponseDto(
        albumCount: mapValueOfType<int>(json, r'albumCount')!,
        approvalDecision: AgentToolApprovalDecision.fromJson(json[r'approvalDecision']),
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        completedAt: mapDateTime(json, r'completedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        dataClass: AgentToolDataClass.fromJson(json[r'dataClass'])!,
        error: mapValueOfType<String>(json, r'error'),
        id: mapValueOfType<String>(json, r'id')!,
        requestSummary: mapValueOfType<String>(json, r'requestSummary')!,
        responseSummary: mapValueOfType<String>(json, r'responseSummary'),
        resultSize: json.containsKey(r'resultSize') ? Optional.present(AgentToolResultSize.fromJson(json[r'resultSize'])) : const Optional.absent(),
        sessionId: mapValueOfType<String>(json, r'sessionId')!,
        startedAt: mapDateTime(json, r'startedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        status: AgentToolCallStatus.fromJson(json[r'status'])!,
        toolName: AgentToolName.fromJson(json[r'toolName'])!,
      );
    }
    return null;
  }

  static List<AgentToolCallResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentToolCallResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentToolCallResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentToolCallResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentToolCallResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentToolCallResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentToolCallResponseDto-objects as value to a dart map
  static Map<String, List<AgentToolCallResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentToolCallResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentToolCallResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albumCount',
    'approvalDecision',
    'assetCount',
    'completedAt',
    'dataClass',
    'error',
    'id',
    'requestSummary',
    'responseSummary',
    'sessionId',
    'startedAt',
    'status',
    'toolName',
  };
}


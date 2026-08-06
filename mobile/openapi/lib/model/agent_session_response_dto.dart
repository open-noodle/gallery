//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSessionResponseDto {
  /// Returns a new [AgentSessionResponseDto] instance.
  AgentSessionResponseDto({
    required this.approvalMode,
    required this.createdAt,
    required this.credentialSnapshot,
    required this.endedAt,
    required this.id,
    this.initialContextSnapshot = const {},
    required this.modelSnapshot,
    required this.permissionPlanSnapshot,
    required this.permissionPreset,
    required this.providerCredentialId,
    this.runnerCapabilitiesSnapshot = const {},
    required this.runnerEndpoint,
    required this.runnerSessionId,
    required this.status,
    this.title = const Optional.absent(),
    required this.updatedAt,
  });

  AgentApprovalMode approvalMode;

  DateTime createdAt;

  AgentCredentialSnapshot credentialSnapshot;

  DateTime? endedAt;

  String id;

  Map<String, Object> initialContextSnapshot;

  AgentModelSnapshot modelSnapshot;

  AgentPermissionPlan permissionPlanSnapshot;

  AgentPermissionPreset permissionPreset;

  String? providerCredentialId;

  Map<String, Object>? runnerCapabilitiesSnapshot;

  String? runnerEndpoint;

  String? runnerSessionId;

  AgentSessionStatus status;

  Optional<String?> title;

  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSessionResponseDto &&
    other.approvalMode == approvalMode &&
    other.createdAt == createdAt &&
    other.credentialSnapshot == credentialSnapshot &&
    other.endedAt == endedAt &&
    other.id == id &&
    _deepEquality.equals(other.initialContextSnapshot, initialContextSnapshot) &&
    other.modelSnapshot == modelSnapshot &&
    other.permissionPlanSnapshot == permissionPlanSnapshot &&
    other.permissionPreset == permissionPreset &&
    other.providerCredentialId == providerCredentialId &&
    _deepEquality.equals(other.runnerCapabilitiesSnapshot, runnerCapabilitiesSnapshot) &&
    other.runnerEndpoint == runnerEndpoint &&
    other.runnerSessionId == runnerSessionId &&
    other.status == status &&
    other.title == title &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (approvalMode.hashCode) +
    (createdAt.hashCode) +
    (credentialSnapshot.hashCode) +
    (endedAt == null ? 0 : endedAt!.hashCode) +
    (id.hashCode) +
    (initialContextSnapshot.hashCode) +
    (modelSnapshot.hashCode) +
    (permissionPlanSnapshot.hashCode) +
    (permissionPreset.hashCode) +
    (providerCredentialId == null ? 0 : providerCredentialId!.hashCode) +
    (runnerCapabilitiesSnapshot == null ? 0 : runnerCapabilitiesSnapshot!.hashCode) +
    (runnerEndpoint == null ? 0 : runnerEndpoint!.hashCode) +
    (runnerSessionId == null ? 0 : runnerSessionId!.hashCode) +
    (status.hashCode) +
    (title == null ? 0 : title!.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'AgentSessionResponseDto[approvalMode=$approvalMode, createdAt=$createdAt, credentialSnapshot=$credentialSnapshot, endedAt=$endedAt, id=$id, initialContextSnapshot=$initialContextSnapshot, modelSnapshot=$modelSnapshot, permissionPlanSnapshot=$permissionPlanSnapshot, permissionPreset=$permissionPreset, providerCredentialId=$providerCredentialId, runnerCapabilitiesSnapshot=$runnerCapabilitiesSnapshot, runnerEndpoint=$runnerEndpoint, runnerSessionId=$runnerSessionId, status=$status, title=$title, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'approvalMode'] = this.approvalMode;
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
      json[r'credentialSnapshot'] = this.credentialSnapshot;
    if (this.endedAt != null) {
      json[r'endedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.endedAt!.millisecondsSinceEpoch
        : this.endedAt!.toUtc().toIso8601String();
    } else {
      json[r'endedAt'] = null;
    }
      json[r'id'] = this.id;
      json[r'initialContextSnapshot'] = this.initialContextSnapshot;
      json[r'modelSnapshot'] = this.modelSnapshot;
      json[r'permissionPlanSnapshot'] = this.permissionPlanSnapshot;
      json[r'permissionPreset'] = this.permissionPreset;
    if (this.providerCredentialId != null) {
      json[r'providerCredentialId'] = this.providerCredentialId;
    } else {
      json[r'providerCredentialId'] = null;
    }
    if (this.runnerCapabilitiesSnapshot != null) {
      json[r'runnerCapabilitiesSnapshot'] = this.runnerCapabilitiesSnapshot;
    } else {
      json[r'runnerCapabilitiesSnapshot'] = null;
    }
    if (this.runnerEndpoint != null) {
      json[r'runnerEndpoint'] = this.runnerEndpoint;
    } else {
      json[r'runnerEndpoint'] = null;
    }
    if (this.runnerSessionId != null) {
      json[r'runnerSessionId'] = this.runnerSessionId;
    } else {
      json[r'runnerSessionId'] = null;
    }
      json[r'status'] = this.status;
    if (this.title.isPresent) {
      final value = this.title.value;
      json[r'title'] = value;
    }
      json[r'updatedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.updatedAt.millisecondsSinceEpoch
        : this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [AgentSessionResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSessionResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSessionResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSessionResponseDto(
        approvalMode: AgentApprovalMode.fromJson(json[r'approvalMode'])!,
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        credentialSnapshot: AgentCredentialSnapshot.fromJson(json[r'credentialSnapshot'])!,
        endedAt: mapDateTime(json, r'endedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        id: mapValueOfType<String>(json, r'id')!,
        initialContextSnapshot: mapCastOfType<String, Object>(json, r'initialContextSnapshot')!,
        modelSnapshot: AgentModelSnapshot.fromJson(json[r'modelSnapshot'])!,
        permissionPlanSnapshot: AgentPermissionPlan.fromJson(json[r'permissionPlanSnapshot'])!,
        permissionPreset: AgentPermissionPreset.fromJson(json[r'permissionPreset'])!,
        providerCredentialId: mapValueOfType<String>(json, r'providerCredentialId'),
        runnerCapabilitiesSnapshot: mapCastOfType<String, Object>(json, r'runnerCapabilitiesSnapshot'),
        runnerEndpoint: mapValueOfType<String>(json, r'runnerEndpoint'),
        runnerSessionId: mapValueOfType<String>(json, r'runnerSessionId'),
        status: AgentSessionStatus.fromJson(json[r'status'])!,
        title: json.containsKey(r'title') ? Optional.present(mapValueOfType<String>(json, r'title')) : const Optional.absent(),
        updatedAt: mapDateTime(json, r'updatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
      );
    }
    return null;
  }

  static List<AgentSessionResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSessionResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSessionResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSessionResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentSessionResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSessionResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSessionResponseDto-objects as value to a dart map
  static Map<String, List<AgentSessionResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSessionResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSessionResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'approvalMode',
    'createdAt',
    'credentialSnapshot',
    'endedAt',
    'id',
    'initialContextSnapshot',
    'modelSnapshot',
    'permissionPlanSnapshot',
    'permissionPreset',
    'providerCredentialId',
    'runnerCapabilitiesSnapshot',
    'runnerEndpoint',
    'runnerSessionId',
    'status',
    'updatedAt',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSessionCreateDto {
  /// Returns a new [AgentSessionCreateDto] instance.
  AgentSessionCreateDto({
    required this.approvalMode,
    this.initialContext = const Optional.present(const {}),
    required this.model,
    this.permissionPlan = const Optional.absent(),
    required this.permissionPreset,
    required this.providerCredentialId,
    this.runnerEndpoint = const Optional.absent(),
  });

  AgentApprovalMode approvalMode;

  Optional<Map<String, Object>?> initialContext;

  String model;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentPermissionPlan?> permissionPlan;

  AgentPermissionPreset permissionPreset;

  String providerCredentialId;

  Optional<String?> runnerEndpoint;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSessionCreateDto &&
    other.approvalMode == approvalMode &&
    _deepEquality.equals(other.initialContext, initialContext) &&
    other.model == model &&
    other.permissionPlan == permissionPlan &&
    other.permissionPreset == permissionPreset &&
    other.providerCredentialId == providerCredentialId &&
    other.runnerEndpoint == runnerEndpoint;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (approvalMode.hashCode) +
    (initialContext.hashCode) +
    (model.hashCode) +
    (permissionPlan == null ? 0 : permissionPlan!.hashCode) +
    (permissionPreset.hashCode) +
    (providerCredentialId.hashCode) +
    (runnerEndpoint == null ? 0 : runnerEndpoint!.hashCode);

  @override
  String toString() => 'AgentSessionCreateDto[approvalMode=$approvalMode, initialContext=$initialContext, model=$model, permissionPlan=$permissionPlan, permissionPreset=$permissionPreset, providerCredentialId=$providerCredentialId, runnerEndpoint=$runnerEndpoint]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'approvalMode'] = this.approvalMode;
    if (this.initialContext.isPresent) {
      final value = this.initialContext.value;
      json[r'initialContext'] = value;
    }
      json[r'model'] = this.model;
    if (this.permissionPlan.isPresent) {
      final value = this.permissionPlan.value;
      json[r'permissionPlan'] = value;
    }
      json[r'permissionPreset'] = this.permissionPreset;
      json[r'providerCredentialId'] = this.providerCredentialId;
    if (this.runnerEndpoint.isPresent) {
      final value = this.runnerEndpoint.value;
      json[r'runnerEndpoint'] = value;
    }
    return json;
  }

  /// Returns a new [AgentSessionCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSessionCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSessionCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSessionCreateDto(
        approvalMode: AgentApprovalMode.fromJson(json[r'approvalMode'])!,
        initialContext: json.containsKey(r'initialContext') ? Optional.present(mapCastOfType<String, Object>(json, r'initialContext')) : const Optional.absent(),
        model: mapValueOfType<String>(json, r'model')!,
        permissionPlan: json.containsKey(r'permissionPlan') ? Optional.present(AgentPermissionPlan.fromJson(json[r'permissionPlan'])) : const Optional.absent(),
        permissionPreset: AgentPermissionPreset.fromJson(json[r'permissionPreset'])!,
        providerCredentialId: mapValueOfType<String>(json, r'providerCredentialId')!,
        runnerEndpoint: json.containsKey(r'runnerEndpoint') ? Optional.present(mapValueOfType<String>(json, r'runnerEndpoint')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentSessionCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSessionCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSessionCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSessionCreateDto> mapFromJson(dynamic json) {
    final map = <String, AgentSessionCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSessionCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSessionCreateDto-objects as value to a dart map
  static Map<String, List<AgentSessionCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSessionCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSessionCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'approvalMode',
    'model',
    'permissionPreset',
    'providerCredentialId',
  };
}


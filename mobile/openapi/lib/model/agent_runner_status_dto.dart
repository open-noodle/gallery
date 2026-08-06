//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentRunnerStatusDto {
  /// Returns a new [AgentRunnerStatusDto] instance.
  AgentRunnerStatusDto({
    required this.capabilities,
    required this.checkedAt,
    required this.configured,
    required this.healthy,
    required this.reason,
    required this.version,
  });

  /// Normalized runner capabilities
  AgentRunnerCapabilitiesDto? capabilities;

  /// When this status was checked
  DateTime checkedAt;

  /// Whether a runner endpoint is configured
  bool configured;

  /// Whether the configured runner is reachable and healthy
  bool healthy;

  AgentRunnerStatusReason reason;

  /// Runner version when reported
  String? version;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentRunnerStatusDto &&
    other.capabilities == capabilities &&
    other.checkedAt == checkedAt &&
    other.configured == configured &&
    other.healthy == healthy &&
    other.reason == reason &&
    other.version == version;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (capabilities == null ? 0 : capabilities!.hashCode) +
    (checkedAt.hashCode) +
    (configured.hashCode) +
    (healthy.hashCode) +
    (reason.hashCode) +
    (version == null ? 0 : version!.hashCode);

  @override
  String toString() => 'AgentRunnerStatusDto[capabilities=$capabilities, checkedAt=$checkedAt, configured=$configured, healthy=$healthy, reason=$reason, version=$version]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.capabilities != null) {
      json[r'capabilities'] = this.capabilities;
    } else {
    //  json[r'capabilities'] = null;
    }
      json[r'checkedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.checkedAt.millisecondsSinceEpoch
        : this.checkedAt.toUtc().toIso8601String();
      json[r'configured'] = this.configured;
      json[r'healthy'] = this.healthy;
      json[r'reason'] = this.reason;
    if (this.version != null) {
      json[r'version'] = this.version;
    } else {
    //  json[r'version'] = null;
    }
    return json;
  }

  /// Returns a new [AgentRunnerStatusDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentRunnerStatusDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentRunnerStatusDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentRunnerStatusDto(
        capabilities: AgentRunnerCapabilitiesDto.fromJson(json[r'capabilities']),
        checkedAt: mapDateTime(json, r'checkedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        configured: mapValueOfType<bool>(json, r'configured')!,
        healthy: mapValueOfType<bool>(json, r'healthy')!,
        reason: AgentRunnerStatusReason.fromJson(json[r'reason'])!,
        version: mapValueOfType<String>(json, r'version'),
      );
    }
    return null;
  }

  static List<AgentRunnerStatusDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentRunnerStatusDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentRunnerStatusDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentRunnerStatusDto> mapFromJson(dynamic json) {
    final map = <String, AgentRunnerStatusDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentRunnerStatusDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentRunnerStatusDto-objects as value to a dart map
  static Map<String, List<AgentRunnerStatusDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentRunnerStatusDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentRunnerStatusDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'capabilities',
    'checkedAt',
    'configured',
    'healthy',
    'reason',
    'version',
  };
}


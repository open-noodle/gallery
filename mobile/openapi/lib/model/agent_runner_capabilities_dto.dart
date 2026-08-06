//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentRunnerCapabilitiesDto {
  /// Returns a new [AgentRunnerCapabilitiesDto] instance.
  AgentRunnerCapabilitiesDto({
    this.models = const [],
    required this.protocolVersion,
    required this.streaming,
    this.tools = const [],
  });

  /// Model IDs reported by the runner
  List<String> models;

  /// Runner protocol version
  String? protocolVersion;

  /// Whether the runner can stream events
  bool streaming;

  /// MCP tool or capability identifiers reported by the runner
  List<String> tools;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentRunnerCapabilitiesDto &&
    _deepEquality.equals(other.models, models) &&
    other.protocolVersion == protocolVersion &&
    other.streaming == streaming &&
    _deepEquality.equals(other.tools, tools);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (models.hashCode) +
    (protocolVersion == null ? 0 : protocolVersion!.hashCode) +
    (streaming.hashCode) +
    (tools.hashCode);

  @override
  String toString() => 'AgentRunnerCapabilitiesDto[models=$models, protocolVersion=$protocolVersion, streaming=$streaming, tools=$tools]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'models'] = this.models;
    if (this.protocolVersion != null) {
      json[r'protocolVersion'] = this.protocolVersion;
    } else {
    //  json[r'protocolVersion'] = null;
    }
      json[r'streaming'] = this.streaming;
      json[r'tools'] = this.tools;
    return json;
  }

  /// Returns a new [AgentRunnerCapabilitiesDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentRunnerCapabilitiesDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentRunnerCapabilitiesDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentRunnerCapabilitiesDto(
        models: json[r'models'] is Iterable
            ? (json[r'models'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        protocolVersion: mapValueOfType<String>(json, r'protocolVersion'),
        streaming: mapValueOfType<bool>(json, r'streaming')!,
        tools: json[r'tools'] is Iterable
            ? (json[r'tools'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AgentRunnerCapabilitiesDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentRunnerCapabilitiesDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentRunnerCapabilitiesDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentRunnerCapabilitiesDto> mapFromJson(dynamic json) {
    final map = <String, AgentRunnerCapabilitiesDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentRunnerCapabilitiesDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentRunnerCapabilitiesDto-objects as value to a dart map
  static Map<String, List<AgentRunnerCapabilitiesDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentRunnerCapabilitiesDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentRunnerCapabilitiesDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'models',
    'protocolVersion',
    'streaming',
    'tools',
  };
}


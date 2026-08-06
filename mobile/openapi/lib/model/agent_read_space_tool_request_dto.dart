//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadSpaceToolRequestDto {
  /// Returns a new [AgentReadSpaceToolRequestDto] instance.
  AgentReadSpaceToolRequestDto({
    this.spaceId = const Optional.absent(),
    this.toolCallId = const Optional.absent(),
  });

  /// Shared space id to inspect
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> spaceId;

  /// Approved tool call id when retrying after user approval
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> toolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadSpaceToolRequestDto &&
    other.spaceId == spaceId &&
    other.toolCallId == toolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (spaceId == null ? 0 : spaceId!.hashCode) +
    (toolCallId == null ? 0 : toolCallId!.hashCode);

  @override
  String toString() => 'AgentReadSpaceToolRequestDto[spaceId=$spaceId, toolCallId=$toolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.spaceId.isPresent) {
      final value = this.spaceId.value;
      json[r'spaceId'] = value;
    }
    if (this.toolCallId.isPresent) {
      final value = this.toolCallId.value;
      json[r'toolCallId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentReadSpaceToolRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadSpaceToolRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadSpaceToolRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadSpaceToolRequestDto(
        spaceId: json.containsKey(r'spaceId') ? Optional.present(mapValueOfType<String>(json, r'spaceId')) : const Optional.absent(),
        toolCallId: json.containsKey(r'toolCallId') ? Optional.present(mapValueOfType<String>(json, r'toolCallId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentReadSpaceToolRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadSpaceToolRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadSpaceToolRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadSpaceToolRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentReadSpaceToolRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadSpaceToolRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadSpaceToolRequestDto-objects as value to a dart map
  static Map<String, List<AgentReadSpaceToolRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadSpaceToolRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadSpaceToolRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


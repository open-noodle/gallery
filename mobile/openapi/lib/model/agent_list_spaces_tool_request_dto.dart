//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListSpacesToolRequestDto {
  /// Returns a new [AgentListSpacesToolRequestDto] instance.
  AgentListSpacesToolRequestDto({
    this.toolCallId = const Optional.absent(),
  });

  /// Approved tool call id when retrying after user approval
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> toolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListSpacesToolRequestDto &&
    other.toolCallId == toolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (toolCallId == null ? 0 : toolCallId!.hashCode);

  @override
  String toString() => 'AgentListSpacesToolRequestDto[toolCallId=$toolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.toolCallId.isPresent) {
      final value = this.toolCallId.value;
      json[r'toolCallId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentListSpacesToolRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListSpacesToolRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentListSpacesToolRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListSpacesToolRequestDto(
        toolCallId: json.containsKey(r'toolCallId') ? Optional.present(mapValueOfType<String>(json, r'toolCallId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentListSpacesToolRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListSpacesToolRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListSpacesToolRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListSpacesToolRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentListSpacesToolRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListSpacesToolRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListSpacesToolRequestDto-objects as value to a dart map
  static Map<String, List<AgentListSpacesToolRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListSpacesToolRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListSpacesToolRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


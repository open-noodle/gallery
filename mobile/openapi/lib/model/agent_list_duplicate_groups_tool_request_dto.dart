//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListDuplicateGroupsToolRequestDto {
  /// Returns a new [AgentListDuplicateGroupsToolRequestDto] instance.
  AgentListDuplicateGroupsToolRequestDto({
    this.maxGroups = const Optional.absent(),
    this.toolCallId = const Optional.absent(),
  });

  /// Maximum number of duplicate groups to return (default 50)
  ///
  /// Minimum value: 1
  /// Maximum value: 500
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> maxGroups;

  /// Approved tool call id when retrying after user approval
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> toolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListDuplicateGroupsToolRequestDto &&
    other.maxGroups == maxGroups &&
    other.toolCallId == toolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (maxGroups == null ? 0 : maxGroups!.hashCode) +
    (toolCallId == null ? 0 : toolCallId!.hashCode);

  @override
  String toString() => 'AgentListDuplicateGroupsToolRequestDto[maxGroups=$maxGroups, toolCallId=$toolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.maxGroups.isPresent) {
      final value = this.maxGroups.value;
      json[r'maxGroups'] = value;
    }
    if (this.toolCallId.isPresent) {
      final value = this.toolCallId.value;
      json[r'toolCallId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentListDuplicateGroupsToolRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListDuplicateGroupsToolRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentListDuplicateGroupsToolRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListDuplicateGroupsToolRequestDto(
        maxGroups: json.containsKey(r'maxGroups') ? Optional.present(json[r'maxGroups'] == null ? null : int.parse('${json[r'maxGroups']}')) : const Optional.absent(),
        toolCallId: json.containsKey(r'toolCallId') ? Optional.present(mapValueOfType<String>(json, r'toolCallId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentListDuplicateGroupsToolRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListDuplicateGroupsToolRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListDuplicateGroupsToolRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListDuplicateGroupsToolRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentListDuplicateGroupsToolRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListDuplicateGroupsToolRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListDuplicateGroupsToolRequestDto-objects as value to a dart map
  static Map<String, List<AgentListDuplicateGroupsToolRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListDuplicateGroupsToolRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListDuplicateGroupsToolRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


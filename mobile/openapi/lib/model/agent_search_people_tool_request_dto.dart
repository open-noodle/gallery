//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleToolRequestDto {
  /// Returns a new [AgentSearchPeopleToolRequestDto] instance.
  AgentSearchPeopleToolRequestDto({
    this.includeHidden = const Optional.absent(),
    this.name = const Optional.absent(),
    this.toolCallId = const Optional.absent(),
  });

  /// Set to true to include hidden people in results (for unhide flows)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> includeHidden;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> name;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> toolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleToolRequestDto &&
    other.includeHidden == includeHidden &&
    other.name == name &&
    other.toolCallId == toolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (includeHidden == null ? 0 : includeHidden!.hashCode) +
    (name == null ? 0 : name!.hashCode) +
    (toolCallId == null ? 0 : toolCallId!.hashCode);

  @override
  String toString() => 'AgentSearchPeopleToolRequestDto[includeHidden=$includeHidden, name=$name, toolCallId=$toolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.includeHidden.isPresent) {
      final value = this.includeHidden.value;
      json[r'includeHidden'] = value;
    }
    if (this.name.isPresent) {
      final value = this.name.value;
      json[r'name'] = value;
    }
    if (this.toolCallId.isPresent) {
      final value = this.toolCallId.value;
      json[r'toolCallId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentSearchPeopleToolRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleToolRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleToolRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleToolRequestDto(
        includeHidden: json.containsKey(r'includeHidden') ? Optional.present(mapValueOfType<bool>(json, r'includeHidden')) : const Optional.absent(),
        name: json.containsKey(r'name') ? Optional.present(mapValueOfType<String>(json, r'name')) : const Optional.absent(),
        toolCallId: json.containsKey(r'toolCallId') ? Optional.present(mapValueOfType<String>(json, r'toolCallId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentSearchPeopleToolRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleToolRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleToolRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleToolRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleToolRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleToolRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleToolRequestDto-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleToolRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleToolRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleToolRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


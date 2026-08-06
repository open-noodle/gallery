//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchUsersToolRequestDto {
  /// Returns a new [AgentSearchUsersToolRequestDto] instance.
  AgentSearchUsersToolRequestDto({
    this.limit = const Optional.absent(),
    this.query = const Optional.absent(),
    this.toolCallId = const Optional.absent(),
  });

  /// Minimum value: 1
  /// Maximum value: 20
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> limit;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> query;

  /// Approved tool call id when retrying after user approval
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> toolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchUsersToolRequestDto &&
    other.limit == limit &&
    other.query == query &&
    other.toolCallId == toolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (limit == null ? 0 : limit!.hashCode) +
    (query == null ? 0 : query!.hashCode) +
    (toolCallId == null ? 0 : toolCallId!.hashCode);

  @override
  String toString() => 'AgentSearchUsersToolRequestDto[limit=$limit, query=$query, toolCallId=$toolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.limit.isPresent) {
      final value = this.limit.value;
      json[r'limit'] = value;
    }
    if (this.query.isPresent) {
      final value = this.query.value;
      json[r'query'] = value;
    }
    if (this.toolCallId.isPresent) {
      final value = this.toolCallId.value;
      json[r'toolCallId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentSearchUsersToolRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchUsersToolRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchUsersToolRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchUsersToolRequestDto(
        limit: json.containsKey(r'limit') ? Optional.present(json[r'limit'] == null ? null : int.parse('${json[r'limit']}')) : const Optional.absent(),
        query: json.containsKey(r'query') ? Optional.present(mapValueOfType<String>(json, r'query')) : const Optional.absent(),
        toolCallId: json.containsKey(r'toolCallId') ? Optional.present(mapValueOfType<String>(json, r'toolCallId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentSearchUsersToolRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchUsersToolRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchUsersToolRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchUsersToolRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentSearchUsersToolRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchUsersToolRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchUsersToolRequestDto-objects as value to a dart map
  static Map<String, List<AgentSearchUsersToolRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchUsersToolRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchUsersToolRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessageCreateDto {
  /// Returns a new [AgentMessageCreateDto] instance.
  AgentMessageCreateDto({
    required this.content,
  });

  AgentUserMessageContent content;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessageCreateDto &&
    other.content == content;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (content.hashCode);

  @override
  String toString() => 'AgentMessageCreateDto[content=$content]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'content'] = this.content;
    return json;
  }

  /// Returns a new [AgentMessageCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessageCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessageCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessageCreateDto(
        content: AgentUserMessageContent.fromJson(json[r'content'])!,
      );
    }
    return null;
  }

  static List<AgentMessageCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessageCreateDto> mapFromJson(dynamic json) {
    final map = <String, AgentMessageCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessageCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessageCreateDto-objects as value to a dart map
  static Map<String, List<AgentMessageCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessageCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessageCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'content',
  };
}


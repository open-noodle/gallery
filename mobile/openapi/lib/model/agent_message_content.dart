//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessageContent {
  /// Returns a new [AgentMessageContent] instance.
  AgentMessageContent({
    this.blocks = const [],
  });

  List<AgentMessageBlock> blocks;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessageContent &&
    _deepEquality.equals(other.blocks, blocks);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (blocks.hashCode);

  @override
  String toString() => 'AgentMessageContent[blocks=$blocks]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'blocks'] = this.blocks;
    return json;
  }

  /// Returns a new [AgentMessageContent] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessageContent? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessageContent");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessageContent(
        blocks: AgentMessageBlock.listFromJson(json[r'blocks']),
      );
    }
    return null;
  }

  static List<AgentMessageContent> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageContent>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageContent.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessageContent> mapFromJson(dynamic json) {
    final map = <String, AgentMessageContent>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessageContent.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessageContent-objects as value to a dart map
  static Map<String, List<AgentMessageContent>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessageContent>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessageContent.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'blocks',
  };
}


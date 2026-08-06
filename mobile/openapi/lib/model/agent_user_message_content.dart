//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentUserMessageContent {
  /// Returns a new [AgentUserMessageContent] instance.
  AgentUserMessageContent({
    this.blocks = const [],
  });

  List<AgentMessageTextBlock> blocks;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentUserMessageContent &&
    _deepEquality.equals(other.blocks, blocks);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (blocks.hashCode);

  @override
  String toString() => 'AgentUserMessageContent[blocks=$blocks]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'blocks'] = this.blocks;
    return json;
  }

  /// Returns a new [AgentUserMessageContent] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentUserMessageContent? fromJson(dynamic value) {
    upgradeDto(value, "AgentUserMessageContent");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentUserMessageContent(
        blocks: AgentMessageTextBlock.listFromJson(json[r'blocks']),
      );
    }
    return null;
  }

  static List<AgentUserMessageContent> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentUserMessageContent>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentUserMessageContent.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentUserMessageContent> mapFromJson(dynamic json) {
    final map = <String, AgentUserMessageContent>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentUserMessageContent.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentUserMessageContent-objects as value to a dart map
  static Map<String, List<AgentUserMessageContent>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentUserMessageContent>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentUserMessageContent.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'blocks',
  };
}


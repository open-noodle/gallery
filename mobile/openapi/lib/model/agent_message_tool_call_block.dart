//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessageToolCallBlock {
  /// Returns a new [AgentMessageToolCallBlock] instance.
  AgentMessageToolCallBlock({
    this.summary = const Optional.absent(),
    required this.toolCallId,
    required this.type,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> summary;

  String toolCallId;

  AgentMessageToolCallBlockType type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessageToolCallBlock &&
    other.summary == summary &&
    other.toolCallId == toolCallId &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (summary == null ? 0 : summary!.hashCode) +
    (toolCallId.hashCode) +
    (type.hashCode);

  @override
  String toString() => 'AgentMessageToolCallBlock[summary=$summary, toolCallId=$toolCallId, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.summary.isPresent) {
      final value = this.summary.value;
      json[r'summary'] = value;
    }
      json[r'toolCallId'] = this.toolCallId;
      json[r'type'] = this.type;
    return json;
  }

  /// Returns a new [AgentMessageToolCallBlock] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessageToolCallBlock? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessageToolCallBlock");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessageToolCallBlock(
        summary: json.containsKey(r'summary') ? Optional.present(mapValueOfType<String>(json, r'summary')) : const Optional.absent(),
        toolCallId: mapValueOfType<String>(json, r'toolCallId')!,
        type: AgentMessageToolCallBlockType.fromJson(json[r'type'])!,
      );
    }
    return null;
  }

  static List<AgentMessageToolCallBlock> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageToolCallBlock>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageToolCallBlock.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessageToolCallBlock> mapFromJson(dynamic json) {
    final map = <String, AgentMessageToolCallBlock>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessageToolCallBlock.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessageToolCallBlock-objects as value to a dart map
  static Map<String, List<AgentMessageToolCallBlock>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessageToolCallBlock>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessageToolCallBlock.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'toolCallId',
    'type',
  };
}


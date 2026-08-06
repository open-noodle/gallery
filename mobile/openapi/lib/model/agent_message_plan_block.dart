//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessagePlanBlock {
  /// Returns a new [AgentMessagePlanBlock] instance.
  AgentMessagePlanBlock({
    this.label = const Optional.absent(),
    required this.planId,
    required this.type,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> label;

  String planId;

  AgentMessagePlanBlockType type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessagePlanBlock &&
    other.label == label &&
    other.planId == planId &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (label == null ? 0 : label!.hashCode) +
    (planId.hashCode) +
    (type.hashCode);

  @override
  String toString() => 'AgentMessagePlanBlock[label=$label, planId=$planId, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.label.isPresent) {
      final value = this.label.value;
      json[r'label'] = value;
    }
      json[r'planId'] = this.planId;
      json[r'type'] = this.type;
    return json;
  }

  /// Returns a new [AgentMessagePlanBlock] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessagePlanBlock? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessagePlanBlock");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessagePlanBlock(
        label: json.containsKey(r'label') ? Optional.present(mapValueOfType<String>(json, r'label')) : const Optional.absent(),
        planId: mapValueOfType<String>(json, r'planId')!,
        type: AgentMessagePlanBlockType.fromJson(json[r'type'])!,
      );
    }
    return null;
  }

  static List<AgentMessagePlanBlock> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessagePlanBlock>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessagePlanBlock.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessagePlanBlock> mapFromJson(dynamic json) {
    final map = <String, AgentMessagePlanBlock>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessagePlanBlock.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessagePlanBlock-objects as value to a dart map
  static Map<String, List<AgentMessagePlanBlock>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessagePlanBlock>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessagePlanBlock.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'planId',
    'type',
  };
}


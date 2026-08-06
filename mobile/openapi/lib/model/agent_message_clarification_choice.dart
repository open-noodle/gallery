//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessageClarificationChoice {
  /// Returns a new [AgentMessageClarificationChoice] instance.
  AgentMessageClarificationChoice({
    required this.choiceRef,
    this.description = const Optional.absent(),
    required this.label,
    this.thumbnailAssetId = const Optional.absent(),
  });

  String choiceRef;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> description;

  String label;

  Optional<String?> thumbnailAssetId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessageClarificationChoice &&
    other.choiceRef == choiceRef &&
    other.description == description &&
    other.label == label &&
    other.thumbnailAssetId == thumbnailAssetId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (choiceRef.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (label.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode);

  @override
  String toString() => 'AgentMessageClarificationChoice[choiceRef=$choiceRef, description=$description, label=$label, thumbnailAssetId=$thumbnailAssetId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'choiceRef'] = this.choiceRef;
    if (this.description.isPresent) {
      final value = this.description.value;
      json[r'description'] = value;
    }
      json[r'label'] = this.label;
    if (this.thumbnailAssetId.isPresent) {
      final value = this.thumbnailAssetId.value;
      json[r'thumbnailAssetId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentMessageClarificationChoice] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessageClarificationChoice? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessageClarificationChoice");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessageClarificationChoice(
        choiceRef: mapValueOfType<String>(json, r'choiceRef')!,
        description: json.containsKey(r'description') ? Optional.present(mapValueOfType<String>(json, r'description')) : const Optional.absent(),
        label: mapValueOfType<String>(json, r'label')!,
        thumbnailAssetId: json.containsKey(r'thumbnailAssetId') ? Optional.present(mapValueOfType<String>(json, r'thumbnailAssetId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentMessageClarificationChoice> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageClarificationChoice>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageClarificationChoice.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessageClarificationChoice> mapFromJson(dynamic json) {
    final map = <String, AgentMessageClarificationChoice>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessageClarificationChoice.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessageClarificationChoice-objects as value to a dart map
  static Map<String, List<AgentMessageClarificationChoice>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessageClarificationChoice>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessageClarificationChoice.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'choiceRef',
    'label',
  };
}


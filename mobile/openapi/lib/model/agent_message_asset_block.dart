//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessageAssetBlock {
  /// Returns a new [AgentMessageAssetBlock] instance.
  AgentMessageAssetBlock({
    required this.assetId,
    this.label = const Optional.absent(),
    required this.type,
  });

  String assetId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> label;

  AgentMessageAssetBlockType type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessageAssetBlock &&
    other.assetId == assetId &&
    other.label == label &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetId.hashCode) +
    (label == null ? 0 : label!.hashCode) +
    (type.hashCode);

  @override
  String toString() => 'AgentMessageAssetBlock[assetId=$assetId, label=$label, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetId'] = this.assetId;
    if (this.label.isPresent) {
      final value = this.label.value;
      json[r'label'] = value;
    }
      json[r'type'] = this.type;
    return json;
  }

  /// Returns a new [AgentMessageAssetBlock] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessageAssetBlock? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessageAssetBlock");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessageAssetBlock(
        assetId: mapValueOfType<String>(json, r'assetId')!,
        label: json.containsKey(r'label') ? Optional.present(mapValueOfType<String>(json, r'label')) : const Optional.absent(),
        type: AgentMessageAssetBlockType.fromJson(json[r'type'])!,
      );
    }
    return null;
  }

  static List<AgentMessageAssetBlock> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageAssetBlock>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageAssetBlock.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessageAssetBlock> mapFromJson(dynamic json) {
    final map = <String, AgentMessageAssetBlock>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessageAssetBlock.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessageAssetBlock-objects as value to a dart map
  static Map<String, List<AgentMessageAssetBlock>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessageAssetBlock>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessageAssetBlock.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetId',
    'type',
  };
}


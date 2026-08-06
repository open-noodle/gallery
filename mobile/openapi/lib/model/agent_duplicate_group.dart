//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentDuplicateGroup {
  /// Returns a new [AgentDuplicateGroup] instance.
  AgentDuplicateGroup({
    this.assets = const [],
    required this.duplicateId,
  });

  List<AgentDuplicateAsset> assets;

  String duplicateId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentDuplicateGroup &&
    _deepEquality.equals(other.assets, assets) &&
    other.duplicateId == duplicateId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assets.hashCode) +
    (duplicateId.hashCode);

  @override
  String toString() => 'AgentDuplicateGroup[assets=$assets, duplicateId=$duplicateId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assets'] = this.assets;
      json[r'duplicateId'] = this.duplicateId;
    return json;
  }

  /// Returns a new [AgentDuplicateGroup] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentDuplicateGroup? fromJson(dynamic value) {
    upgradeDto(value, "AgentDuplicateGroup");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentDuplicateGroup(
        assets: AgentDuplicateAsset.listFromJson(json[r'assets']),
        duplicateId: mapValueOfType<String>(json, r'duplicateId')!,
      );
    }
    return null;
  }

  static List<AgentDuplicateGroup> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentDuplicateGroup>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentDuplicateGroup.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentDuplicateGroup> mapFromJson(dynamic json) {
    final map = <String, AgentDuplicateGroup>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentDuplicateGroup.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentDuplicateGroup-objects as value to a dart map
  static Map<String, List<AgentDuplicateGroup>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentDuplicateGroup>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentDuplicateGroup.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assets',
    'duplicateId',
  };
}


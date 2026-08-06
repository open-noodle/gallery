//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentPermissionPlanAssetScope {
  /// Returns a new [AgentPermissionPlanAssetScope] instance.
  AgentPermissionPlanAssetScope({
    required this.locked,
    required this.owned,
    required this.sharedSpaces,
  });

  bool locked;

  bool owned;

  bool sharedSpaces;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentPermissionPlanAssetScope &&
    other.locked == locked &&
    other.owned == owned &&
    other.sharedSpaces == sharedSpaces;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (locked.hashCode) +
    (owned.hashCode) +
    (sharedSpaces.hashCode);

  @override
  String toString() => 'AgentPermissionPlanAssetScope[locked=$locked, owned=$owned, sharedSpaces=$sharedSpaces]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'locked'] = this.locked;
      json[r'owned'] = this.owned;
      json[r'sharedSpaces'] = this.sharedSpaces;
    return json;
  }

  /// Returns a new [AgentPermissionPlanAssetScope] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentPermissionPlanAssetScope? fromJson(dynamic value) {
    upgradeDto(value, "AgentPermissionPlanAssetScope");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentPermissionPlanAssetScope(
        locked: mapValueOfType<bool>(json, r'locked')!,
        owned: mapValueOfType<bool>(json, r'owned')!,
        sharedSpaces: mapValueOfType<bool>(json, r'sharedSpaces')!,
      );
    }
    return null;
  }

  static List<AgentPermissionPlanAssetScope> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentPermissionPlanAssetScope>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentPermissionPlanAssetScope.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentPermissionPlanAssetScope> mapFromJson(dynamic json) {
    final map = <String, AgentPermissionPlanAssetScope>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentPermissionPlanAssetScope.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentPermissionPlanAssetScope-objects as value to a dart map
  static Map<String, List<AgentPermissionPlanAssetScope>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentPermissionPlanAssetScope>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentPermissionPlanAssetScope.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'locked',
    'owned',
    'sharedSpaces',
  };
}


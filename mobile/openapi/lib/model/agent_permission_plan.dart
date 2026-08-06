//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentPermissionPlan {
  /// Returns a new [AgentPermissionPlan] instance.
  AgentPermissionPlan({
    required this.assetScope,
    required this.limits,
    required this.providerExposure,
    required this.read,
    required this.writeScope,
  });

  AgentPermissionPlanAssetScope assetScope;

  AgentPermissionPlanLimits limits;

  AgentPermissionPlanProviderExposure providerExposure;

  AgentPermissionPlanRead read;

  AgentPermissionPlanWriteScope writeScope;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentPermissionPlan &&
    other.assetScope == assetScope &&
    other.limits == limits &&
    other.providerExposure == providerExposure &&
    other.read == read &&
    other.writeScope == writeScope;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetScope.hashCode) +
    (limits.hashCode) +
    (providerExposure.hashCode) +
    (read.hashCode) +
    (writeScope.hashCode);

  @override
  String toString() => 'AgentPermissionPlan[assetScope=$assetScope, limits=$limits, providerExposure=$providerExposure, read=$read, writeScope=$writeScope]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetScope'] = this.assetScope;
      json[r'limits'] = this.limits;
      json[r'providerExposure'] = this.providerExposure;
      json[r'read'] = this.read;
      json[r'writeScope'] = this.writeScope;
    return json;
  }

  /// Returns a new [AgentPermissionPlan] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentPermissionPlan? fromJson(dynamic value) {
    upgradeDto(value, "AgentPermissionPlan");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentPermissionPlan(
        assetScope: AgentPermissionPlanAssetScope.fromJson(json[r'assetScope'])!,
        limits: AgentPermissionPlanLimits.fromJson(json[r'limits'])!,
        providerExposure: AgentPermissionPlanProviderExposure.fromJson(json[r'providerExposure'])!,
        read: AgentPermissionPlanRead.fromJson(json[r'read'])!,
        writeScope: AgentPermissionPlanWriteScope.fromJson(json[r'writeScope'])!,
      );
    }
    return null;
  }

  static List<AgentPermissionPlan> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentPermissionPlan>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentPermissionPlan.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentPermissionPlan> mapFromJson(dynamic json) {
    final map = <String, AgentPermissionPlan>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentPermissionPlan.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentPermissionPlan-objects as value to a dart map
  static Map<String, List<AgentPermissionPlan>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentPermissionPlan>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentPermissionPlan.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetScope',
    'limits',
    'providerExposure',
    'read',
    'writeScope',
  };
}


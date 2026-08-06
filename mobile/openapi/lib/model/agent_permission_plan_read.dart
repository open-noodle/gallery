//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentPermissionPlanRead {
  /// Returns a new [AgentPermissionPlanRead] instance.
  AgentPermissionPlanRead({
    required this.metadata,
    required this.originals,
    required this.previews,
  });

  bool metadata;

  bool originals;

  bool previews;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentPermissionPlanRead &&
    other.metadata == metadata &&
    other.originals == originals &&
    other.previews == previews;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (metadata.hashCode) +
    (originals.hashCode) +
    (previews.hashCode);

  @override
  String toString() => 'AgentPermissionPlanRead[metadata=$metadata, originals=$originals, previews=$previews]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'metadata'] = this.metadata;
      json[r'originals'] = this.originals;
      json[r'previews'] = this.previews;
    return json;
  }

  /// Returns a new [AgentPermissionPlanRead] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentPermissionPlanRead? fromJson(dynamic value) {
    upgradeDto(value, "AgentPermissionPlanRead");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentPermissionPlanRead(
        metadata: mapValueOfType<bool>(json, r'metadata')!,
        originals: mapValueOfType<bool>(json, r'originals')!,
        previews: mapValueOfType<bool>(json, r'previews')!,
      );
    }
    return null;
  }

  static List<AgentPermissionPlanRead> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentPermissionPlanRead>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentPermissionPlanRead.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentPermissionPlanRead> mapFromJson(dynamic json) {
    final map = <String, AgentPermissionPlanRead>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentPermissionPlanRead.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentPermissionPlanRead-objects as value to a dart map
  static Map<String, List<AgentPermissionPlanRead>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentPermissionPlanRead>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentPermissionPlanRead.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'metadata',
    'originals',
    'previews',
  };
}


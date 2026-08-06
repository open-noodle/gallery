//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentModelSnapshot {
  /// Returns a new [AgentModelSnapshot] instance.
  AgentModelSnapshot({
    required this.model,
    required this.providerCredentialId,
  });

  String model;

  String providerCredentialId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentModelSnapshot &&
    other.model == model &&
    other.providerCredentialId == providerCredentialId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (model.hashCode) +
    (providerCredentialId.hashCode);

  @override
  String toString() => 'AgentModelSnapshot[model=$model, providerCredentialId=$providerCredentialId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'model'] = this.model;
      json[r'providerCredentialId'] = this.providerCredentialId;
    return json;
  }

  /// Returns a new [AgentModelSnapshot] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentModelSnapshot? fromJson(dynamic value) {
    upgradeDto(value, "AgentModelSnapshot");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentModelSnapshot(
        model: mapValueOfType<String>(json, r'model')!,
        providerCredentialId: mapValueOfType<String>(json, r'providerCredentialId')!,
      );
    }
    return null;
  }

  static List<AgentModelSnapshot> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentModelSnapshot>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentModelSnapshot.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentModelSnapshot> mapFromJson(dynamic json) {
    final map = <String, AgentModelSnapshot>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentModelSnapshot.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentModelSnapshot-objects as value to a dart map
  static Map<String, List<AgentModelSnapshot>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentModelSnapshot>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentModelSnapshot.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'model',
    'providerCredentialId',
  };
}


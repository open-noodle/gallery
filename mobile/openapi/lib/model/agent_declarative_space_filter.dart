//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentDeclarativeSpaceFilter {
  /// Returns a new [AgentDeclarativeSpaceFilter] instance.
  AgentDeclarativeSpaceFilter({
    required this.name,
  });

  String name;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentDeclarativeSpaceFilter &&
    other.name == name;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name.hashCode);

  @override
  String toString() => 'AgentDeclarativeSpaceFilter[name=$name]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'name'] = this.name;
    return json;
  }

  /// Returns a new [AgentDeclarativeSpaceFilter] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentDeclarativeSpaceFilter? fromJson(dynamic value) {
    upgradeDto(value, "AgentDeclarativeSpaceFilter");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentDeclarativeSpaceFilter(
        name: mapValueOfType<String>(json, r'name')!,
      );
    }
    return null;
  }

  static List<AgentDeclarativeSpaceFilter> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentDeclarativeSpaceFilter>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentDeclarativeSpaceFilter.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentDeclarativeSpaceFilter> mapFromJson(dynamic json) {
    final map = <String, AgentDeclarativeSpaceFilter>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentDeclarativeSpaceFilter.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentDeclarativeSpaceFilter-objects as value to a dart map
  static Map<String, List<AgentDeclarativeSpaceFilter>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentDeclarativeSpaceFilter>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentDeclarativeSpaceFilter.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'name',
  };
}


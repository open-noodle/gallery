//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentDeclarativeNamedFilter {
  /// Returns a new [AgentDeclarativeNamedFilter] instance.
  AgentDeclarativeNamedFilter({
    this.choiceRefs = const Optional.present(const []),
    required this.match,
    this.names = const [],
  });

  Optional<List<String>?> choiceRefs;

  AgentDeclarativeNameMatch match;

  List<String> names;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentDeclarativeNamedFilter &&
    _deepEquality.equals(other.choiceRefs, choiceRefs) &&
    other.match == match &&
    _deepEquality.equals(other.names, names);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (choiceRefs.hashCode) +
    (match.hashCode) +
    (names.hashCode);

  @override
  String toString() => 'AgentDeclarativeNamedFilter[choiceRefs=$choiceRefs, match=$match, names=$names]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.choiceRefs.isPresent) {
      final value = this.choiceRefs.value;
      json[r'choiceRefs'] = value;
    }
      json[r'match'] = this.match;
      json[r'names'] = this.names;
    return json;
  }

  /// Returns a new [AgentDeclarativeNamedFilter] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentDeclarativeNamedFilter? fromJson(dynamic value) {
    upgradeDto(value, "AgentDeclarativeNamedFilter");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentDeclarativeNamedFilter(
        choiceRefs: json.containsKey(r'choiceRefs') ? Optional.present(json[r'choiceRefs'] is Iterable
            ? (json[r'choiceRefs'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        match: AgentDeclarativeNameMatch.fromJson(json[r'match'])!,
        names: json[r'names'] is Iterable
            ? (json[r'names'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AgentDeclarativeNamedFilter> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentDeclarativeNamedFilter>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentDeclarativeNamedFilter.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentDeclarativeNamedFilter> mapFromJson(dynamic json) {
    final map = <String, AgentDeclarativeNamedFilter>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentDeclarativeNamedFilter.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentDeclarativeNamedFilter-objects as value to a dart map
  static Map<String, List<AgentDeclarativeNamedFilter>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentDeclarativeNamedFilter>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentDeclarativeNamedFilter.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'match',
    'names',
  };
}


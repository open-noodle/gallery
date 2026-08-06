//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentDeclarativeCameraFilter {
  /// Returns a new [AgentDeclarativeCameraFilter] instance.
  AgentDeclarativeCameraFilter({
    this.lensModel = const Optional.absent(),
    this.make = const Optional.absent(),
    this.model = const Optional.absent(),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> lensModel;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> make;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> model;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentDeclarativeCameraFilter &&
    other.lensModel == lensModel &&
    other.make == make &&
    other.model == model;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (lensModel == null ? 0 : lensModel!.hashCode) +
    (make == null ? 0 : make!.hashCode) +
    (model == null ? 0 : model!.hashCode);

  @override
  String toString() => 'AgentDeclarativeCameraFilter[lensModel=$lensModel, make=$make, model=$model]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.lensModel.isPresent) {
      final value = this.lensModel.value;
      json[r'lensModel'] = value;
    }
    if (this.make.isPresent) {
      final value = this.make.value;
      json[r'make'] = value;
    }
    if (this.model.isPresent) {
      final value = this.model.value;
      json[r'model'] = value;
    }
    return json;
  }

  /// Returns a new [AgentDeclarativeCameraFilter] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentDeclarativeCameraFilter? fromJson(dynamic value) {
    upgradeDto(value, "AgentDeclarativeCameraFilter");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentDeclarativeCameraFilter(
        lensModel: json.containsKey(r'lensModel') ? Optional.present(mapValueOfType<String>(json, r'lensModel')) : const Optional.absent(),
        make: json.containsKey(r'make') ? Optional.present(mapValueOfType<String>(json, r'make')) : const Optional.absent(),
        model: json.containsKey(r'model') ? Optional.present(mapValueOfType<String>(json, r'model')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentDeclarativeCameraFilter> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentDeclarativeCameraFilter>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentDeclarativeCameraFilter.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentDeclarativeCameraFilter> mapFromJson(dynamic json) {
    final map = <String, AgentDeclarativeCameraFilter>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentDeclarativeCameraFilter.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentDeclarativeCameraFilter-objects as value to a dart map
  static Map<String, List<AgentDeclarativeCameraFilter>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentDeclarativeCameraFilter>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentDeclarativeCameraFilter.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


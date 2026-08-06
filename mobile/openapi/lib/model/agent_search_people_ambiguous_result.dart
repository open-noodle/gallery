//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleAmbiguousResult {
  /// Returns a new [AgentSearchPeopleAmbiguousResult] instance.
  AgentSearchPeopleAmbiguousResult({
    this.choices = const [],
    required this.status,
  });

  List<AgentSearchPeopleChoice> choices;

  AgentSearchPeopleAmbiguousResultStatusEnum status;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleAmbiguousResult &&
    _deepEquality.equals(other.choices, choices) &&
    other.status == status;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (choices.hashCode) +
    (status.hashCode);

  @override
  String toString() => 'AgentSearchPeopleAmbiguousResult[choices=$choices, status=$status]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'choices'] = this.choices;
      json[r'status'] = this.status;
    return json;
  }

  /// Returns a new [AgentSearchPeopleAmbiguousResult] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleAmbiguousResult? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleAmbiguousResult");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleAmbiguousResult(
        choices: AgentSearchPeopleChoice.listFromJson(json[r'choices']),
        status: AgentSearchPeopleAmbiguousResultStatusEnum.fromJson(json[r'status'])!,
      );
    }
    return null;
  }

  static List<AgentSearchPeopleAmbiguousResult> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleAmbiguousResult>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleAmbiguousResult.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleAmbiguousResult> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleAmbiguousResult>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleAmbiguousResult.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleAmbiguousResult-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleAmbiguousResult>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleAmbiguousResult>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleAmbiguousResult.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'choices',
    'status',
  };
}


enum AgentSearchPeopleAmbiguousResultStatusEnum {
  ambiguous._(r'ambiguous'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentSearchPeopleAmbiguousResultStatusEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentSearchPeopleAmbiguousResultStatusEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentSearchPeopleAmbiguousResultStatusEnum? fromJson(dynamic value) => AgentSearchPeopleAmbiguousResultStatusEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentSearchPeopleAmbiguousResultStatusEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentSearchPeopleAmbiguousResultStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleAmbiguousResultStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleAmbiguousResultStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchPeopleAmbiguousResultStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchPeopleAmbiguousResultStatusEnum].
class AgentSearchPeopleAmbiguousResultStatusEnumTypeTransformer {
  factory AgentSearchPeopleAmbiguousResultStatusEnumTypeTransformer() => _instance ??= const AgentSearchPeopleAmbiguousResultStatusEnumTypeTransformer._();

  const AgentSearchPeopleAmbiguousResultStatusEnumTypeTransformer._();

  String encode(AgentSearchPeopleAmbiguousResultStatusEnum data) => data._value;

  /// Returns the instance of [AgentSearchPeopleAmbiguousResultStatusEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchPeopleAmbiguousResultStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentSearchPeopleAmbiguousResultStatusEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'ambiguous': return AgentSearchPeopleAmbiguousResultStatusEnum.ambiguous;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentSearchPeopleAmbiguousResultStatusEnumTypeTransformer? _instance;
}



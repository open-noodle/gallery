//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleNotFoundResult {
  /// Returns a new [AgentSearchPeopleNotFoundResult] instance.
  AgentSearchPeopleNotFoundResult({
    required this.status,
  });

  AgentSearchPeopleNotFoundResultStatusEnum status;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleNotFoundResult &&
    other.status == status;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode);

  @override
  String toString() => 'AgentSearchPeopleNotFoundResult[status=$status]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
    return json;
  }

  /// Returns a new [AgentSearchPeopleNotFoundResult] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleNotFoundResult? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleNotFoundResult");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleNotFoundResult(
        status: AgentSearchPeopleNotFoundResultStatusEnum.fromJson(json[r'status'])!,
      );
    }
    return null;
  }

  static List<AgentSearchPeopleNotFoundResult> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleNotFoundResult>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleNotFoundResult.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleNotFoundResult> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleNotFoundResult>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleNotFoundResult.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleNotFoundResult-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleNotFoundResult>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleNotFoundResult>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleNotFoundResult.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
  };
}


class AgentSearchPeopleNotFoundResultStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchPeopleNotFoundResultStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const notFound = AgentSearchPeopleNotFoundResultStatusEnum._(r'not_found');

  /// List of all possible values in this [enum][AgentSearchPeopleNotFoundResultStatusEnum].
  static const values = <AgentSearchPeopleNotFoundResultStatusEnum>[
    notFound,
  ];

  static AgentSearchPeopleNotFoundResultStatusEnum? fromJson(dynamic value) => AgentSearchPeopleNotFoundResultStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchPeopleNotFoundResultStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleNotFoundResultStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleNotFoundResultStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchPeopleNotFoundResultStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchPeopleNotFoundResultStatusEnum].
class AgentSearchPeopleNotFoundResultStatusEnumTypeTransformer {
  factory AgentSearchPeopleNotFoundResultStatusEnumTypeTransformer() => _instance ??= const AgentSearchPeopleNotFoundResultStatusEnumTypeTransformer._();

  const AgentSearchPeopleNotFoundResultStatusEnumTypeTransformer._();

  String encode(AgentSearchPeopleNotFoundResultStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchPeopleNotFoundResultStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchPeopleNotFoundResultStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'not_found': return AgentSearchPeopleNotFoundResultStatusEnum.notFound;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchPeopleNotFoundResultStatusEnumTypeTransformer] instance.
  static AgentSearchPeopleNotFoundResultStatusEnumTypeTransformer? _instance;
}



//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSpaceCreateOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentSpaceCreateOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const spacePeriodCreate = AgentSpaceCreateOperationType._(r'space.create');

  /// List of all possible values in this [enum][AgentSpaceCreateOperationType].
  static const values = <AgentSpaceCreateOperationType>[
    spacePeriodCreate,
  ];

  static AgentSpaceCreateOperationType? fromJson(dynamic value) => AgentSpaceCreateOperationTypeTypeTransformer().decode(value);

  static List<AgentSpaceCreateOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSpaceCreateOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSpaceCreateOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSpaceCreateOperationType] to String,
/// and [decode] dynamic data back to [AgentSpaceCreateOperationType].
class AgentSpaceCreateOperationTypeTypeTransformer {
  factory AgentSpaceCreateOperationTypeTypeTransformer() => _instance ??= const AgentSpaceCreateOperationTypeTypeTransformer._();

  const AgentSpaceCreateOperationTypeTypeTransformer._();

  String encode(AgentSpaceCreateOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSpaceCreateOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSpaceCreateOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'space.create': return AgentSpaceCreateOperationType.spacePeriodCreate;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSpaceCreateOperationTypeTypeTransformer] instance.
  static AgentSpaceCreateOperationTypeTypeTransformer? _instance;
}


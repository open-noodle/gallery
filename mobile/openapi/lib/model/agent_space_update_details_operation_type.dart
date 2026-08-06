//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSpaceUpdateDetailsOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentSpaceUpdateDetailsOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const spacePeriodUpdateDetails = AgentSpaceUpdateDetailsOperationType._(r'space.updateDetails');

  /// List of all possible values in this [enum][AgentSpaceUpdateDetailsOperationType].
  static const values = <AgentSpaceUpdateDetailsOperationType>[
    spacePeriodUpdateDetails,
  ];

  static AgentSpaceUpdateDetailsOperationType? fromJson(dynamic value) => AgentSpaceUpdateDetailsOperationTypeTypeTransformer().decode(value);

  static List<AgentSpaceUpdateDetailsOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSpaceUpdateDetailsOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSpaceUpdateDetailsOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSpaceUpdateDetailsOperationType] to String,
/// and [decode] dynamic data back to [AgentSpaceUpdateDetailsOperationType].
class AgentSpaceUpdateDetailsOperationTypeTypeTransformer {
  factory AgentSpaceUpdateDetailsOperationTypeTypeTransformer() => _instance ??= const AgentSpaceUpdateDetailsOperationTypeTypeTransformer._();

  const AgentSpaceUpdateDetailsOperationTypeTypeTransformer._();

  String encode(AgentSpaceUpdateDetailsOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSpaceUpdateDetailsOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSpaceUpdateDetailsOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'space.updateDetails': return AgentSpaceUpdateDetailsOperationType.spacePeriodUpdateDetails;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSpaceUpdateDetailsOperationTypeTypeTransformer] instance.
  static AgentSpaceUpdateDetailsOperationTypeTypeTransformer? _instance;
}


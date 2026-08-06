//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentPersonMergeOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentPersonMergeOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const personPeriodMerge = AgentPersonMergeOperationType._(r'person.merge');

  /// List of all possible values in this [enum][AgentPersonMergeOperationType].
  static const values = <AgentPersonMergeOperationType>[
    personPeriodMerge,
  ];

  static AgentPersonMergeOperationType? fromJson(dynamic value) => AgentPersonMergeOperationTypeTypeTransformer().decode(value);

  static List<AgentPersonMergeOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentPersonMergeOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentPersonMergeOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentPersonMergeOperationType] to String,
/// and [decode] dynamic data back to [AgentPersonMergeOperationType].
class AgentPersonMergeOperationTypeTypeTransformer {
  factory AgentPersonMergeOperationTypeTypeTransformer() => _instance ??= const AgentPersonMergeOperationTypeTypeTransformer._();

  const AgentPersonMergeOperationTypeTypeTransformer._();

  String encode(AgentPersonMergeOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentPersonMergeOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentPersonMergeOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'person.merge': return AgentPersonMergeOperationType.personPeriodMerge;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentPersonMergeOperationTypeTypeTransformer] instance.
  static AgentPersonMergeOperationTypeTypeTransformer? _instance;
}


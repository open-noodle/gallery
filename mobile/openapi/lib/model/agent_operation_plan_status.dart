//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationPlanStatus {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationPlanStatus._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const proposed = AgentOperationPlanStatus._(r'proposed');
  static const superseded = AgentOperationPlanStatus._(r'superseded');
  static const applied = AgentOperationPlanStatus._(r'applied');
  static const cancelled = AgentOperationPlanStatus._(r'cancelled');

  /// List of all possible values in this [enum][AgentOperationPlanStatus].
  static const values = <AgentOperationPlanStatus>[
    proposed,
    superseded,
    applied,
    cancelled,
  ];

  static AgentOperationPlanStatus? fromJson(dynamic value) => AgentOperationPlanStatusTypeTransformer().decode(value);

  static List<AgentOperationPlanStatus> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanStatus>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanStatus.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationPlanStatus] to String,
/// and [decode] dynamic data back to [AgentOperationPlanStatus].
class AgentOperationPlanStatusTypeTransformer {
  factory AgentOperationPlanStatusTypeTransformer() => _instance ??= const AgentOperationPlanStatusTypeTransformer._();

  const AgentOperationPlanStatusTypeTransformer._();

  String encode(AgentOperationPlanStatus data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationPlanStatus.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationPlanStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'proposed': return AgentOperationPlanStatus.proposed;
        case r'superseded': return AgentOperationPlanStatus.superseded;
        case r'applied': return AgentOperationPlanStatus.applied;
        case r'cancelled': return AgentOperationPlanStatus.cancelled;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationPlanStatusTypeTransformer] instance.
  static AgentOperationPlanStatusTypeTransformer? _instance;
}


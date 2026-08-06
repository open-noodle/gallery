//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentMessagePlanBlockType {
  /// Instantiate a new enum with the provided [value].
  const AgentMessagePlanBlockType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const plan = AgentMessagePlanBlockType._(r'plan');

  /// List of all possible values in this [enum][AgentMessagePlanBlockType].
  static const values = <AgentMessagePlanBlockType>[
    plan,
  ];

  static AgentMessagePlanBlockType? fromJson(dynamic value) => AgentMessagePlanBlockTypeTypeTransformer().decode(value);

  static List<AgentMessagePlanBlockType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessagePlanBlockType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessagePlanBlockType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentMessagePlanBlockType] to String,
/// and [decode] dynamic data back to [AgentMessagePlanBlockType].
class AgentMessagePlanBlockTypeTypeTransformer {
  factory AgentMessagePlanBlockTypeTypeTransformer() => _instance ??= const AgentMessagePlanBlockTypeTypeTransformer._();

  const AgentMessagePlanBlockTypeTypeTransformer._();

  String encode(AgentMessagePlanBlockType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentMessagePlanBlockType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentMessagePlanBlockType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'plan': return AgentMessagePlanBlockType.plan;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentMessagePlanBlockTypeTypeTransformer] instance.
  static AgentMessagePlanBlockTypeTypeTransformer? _instance;
}


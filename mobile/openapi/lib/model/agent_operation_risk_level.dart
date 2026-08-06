//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationRiskLevel {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationRiskLevel._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const low = AgentOperationRiskLevel._(r'low');
  static const medium = AgentOperationRiskLevel._(r'medium');
  static const high = AgentOperationRiskLevel._(r'high');

  /// List of all possible values in this [enum][AgentOperationRiskLevel].
  static const values = <AgentOperationRiskLevel>[
    low,
    medium,
    high,
  ];

  static AgentOperationRiskLevel? fromJson(dynamic value) => AgentOperationRiskLevelTypeTransformer().decode(value);

  static List<AgentOperationRiskLevel> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationRiskLevel>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationRiskLevel.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationRiskLevel] to String,
/// and [decode] dynamic data back to [AgentOperationRiskLevel].
class AgentOperationRiskLevelTypeTransformer {
  factory AgentOperationRiskLevelTypeTransformer() => _instance ??= const AgentOperationRiskLevelTypeTransformer._();

  const AgentOperationRiskLevelTypeTransformer._();

  String encode(AgentOperationRiskLevel data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationRiskLevel.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationRiskLevel? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'low': return AgentOperationRiskLevel.low;
        case r'medium': return AgentOperationRiskLevel.medium;
        case r'high': return AgentOperationRiskLevel.high;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationRiskLevelTypeTransformer] instance.
  static AgentOperationRiskLevelTypeTransformer? _instance;
}


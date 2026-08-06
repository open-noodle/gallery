//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Agent runner availability reason
class AgentRunnerStatusReason {
  /// Instantiate a new enum with the provided [value].
  const AgentRunnerStatusReason._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const notConfigured = AgentRunnerStatusReason._(r'not-configured');
  static const healthy = AgentRunnerStatusReason._(r'healthy');
  static const unhealthy = AgentRunnerStatusReason._(r'unhealthy');
  static const timeout = AgentRunnerStatusReason._(r'timeout');
  static const invalidResponse = AgentRunnerStatusReason._(r'invalid-response');

  /// List of all possible values in this [enum][AgentRunnerStatusReason].
  static const values = <AgentRunnerStatusReason>[
    notConfigured,
    healthy,
    unhealthy,
    timeout,
    invalidResponse,
  ];

  static AgentRunnerStatusReason? fromJson(dynamic value) => AgentRunnerStatusReasonTypeTransformer().decode(value);

  static List<AgentRunnerStatusReason> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentRunnerStatusReason>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentRunnerStatusReason.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentRunnerStatusReason] to String,
/// and [decode] dynamic data back to [AgentRunnerStatusReason].
class AgentRunnerStatusReasonTypeTransformer {
  factory AgentRunnerStatusReasonTypeTransformer() => _instance ??= const AgentRunnerStatusReasonTypeTransformer._();

  const AgentRunnerStatusReasonTypeTransformer._();

  String encode(AgentRunnerStatusReason data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentRunnerStatusReason.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentRunnerStatusReason? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'not-configured': return AgentRunnerStatusReason.notConfigured;
        case r'healthy': return AgentRunnerStatusReason.healthy;
        case r'unhealthy': return AgentRunnerStatusReason.unhealthy;
        case r'timeout': return AgentRunnerStatusReason.timeout;
        case r'invalid-response': return AgentRunnerStatusReason.invalidResponse;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentRunnerStatusReasonTypeTransformer] instance.
  static AgentRunnerStatusReasonTypeTransformer? _instance;
}


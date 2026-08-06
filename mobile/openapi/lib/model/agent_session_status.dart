//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSessionStatus {
  /// Instantiate a new enum with the provided [value].
  const AgentSessionStatus._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const created = AgentSessionStatus._(r'created');
  static const running = AgentSessionStatus._(r'running');
  static const waitingForToolApproval = AgentSessionStatus._(r'waiting_for_tool_approval');
  static const waitingForPlanReview = AgentSessionStatus._(r'waiting_for_plan_review');
  static const applying = AgentSessionStatus._(r'applying');
  static const completed = AgentSessionStatus._(r'completed');
  static const cancelled = AgentSessionStatus._(r'cancelled');
  static const interrupted = AgentSessionStatus._(r'interrupted');
  static const failed = AgentSessionStatus._(r'failed');

  /// List of all possible values in this [enum][AgentSessionStatus].
  static const values = <AgentSessionStatus>[
    created,
    running,
    waitingForToolApproval,
    waitingForPlanReview,
    applying,
    completed,
    cancelled,
    interrupted,
    failed,
  ];

  static AgentSessionStatus? fromJson(dynamic value) => AgentSessionStatusTypeTransformer().decode(value);

  static List<AgentSessionStatus> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSessionStatus>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSessionStatus.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSessionStatus] to String,
/// and [decode] dynamic data back to [AgentSessionStatus].
class AgentSessionStatusTypeTransformer {
  factory AgentSessionStatusTypeTransformer() => _instance ??= const AgentSessionStatusTypeTransformer._();

  const AgentSessionStatusTypeTransformer._();

  String encode(AgentSessionStatus data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSessionStatus.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSessionStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'created': return AgentSessionStatus.created;
        case r'running': return AgentSessionStatus.running;
        case r'waiting_for_tool_approval': return AgentSessionStatus.waitingForToolApproval;
        case r'waiting_for_plan_review': return AgentSessionStatus.waitingForPlanReview;
        case r'applying': return AgentSessionStatus.applying;
        case r'completed': return AgentSessionStatus.completed;
        case r'cancelled': return AgentSessionStatus.cancelled;
        case r'interrupted': return AgentSessionStatus.interrupted;
        case r'failed': return AgentSessionStatus.failed;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSessionStatusTypeTransformer] instance.
  static AgentSessionStatusTypeTransformer? _instance;
}


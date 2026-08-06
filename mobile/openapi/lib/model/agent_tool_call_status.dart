//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentToolCallStatus {
  /// Instantiate a new enum with the provided [value].
  const AgentToolCallStatus._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const pendingApproval = AgentToolCallStatus._(r'pending_approval');
  static const approved = AgentToolCallStatus._(r'approved');
  static const executing = AgentToolCallStatus._(r'executing');
  static const denied = AgentToolCallStatus._(r'denied');
  static const completed = AgentToolCallStatus._(r'completed');
  static const failed = AgentToolCallStatus._(r'failed');

  /// List of all possible values in this [enum][AgentToolCallStatus].
  static const values = <AgentToolCallStatus>[
    pendingApproval,
    approved,
    executing,
    denied,
    completed,
    failed,
  ];

  static AgentToolCallStatus? fromJson(dynamic value) => AgentToolCallStatusTypeTransformer().decode(value);

  static List<AgentToolCallStatus> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentToolCallStatus>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentToolCallStatus.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentToolCallStatus] to String,
/// and [decode] dynamic data back to [AgentToolCallStatus].
class AgentToolCallStatusTypeTransformer {
  factory AgentToolCallStatusTypeTransformer() => _instance ??= const AgentToolCallStatusTypeTransformer._();

  const AgentToolCallStatusTypeTransformer._();

  String encode(AgentToolCallStatus data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentToolCallStatus.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentToolCallStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'pending_approval': return AgentToolCallStatus.pendingApproval;
        case r'approved': return AgentToolCallStatus.approved;
        case r'executing': return AgentToolCallStatus.executing;
        case r'denied': return AgentToolCallStatus.denied;
        case r'completed': return AgentToolCallStatus.completed;
        case r'failed': return AgentToolCallStatus.failed;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentToolCallStatusTypeTransformer] instance.
  static AgentToolCallStatusTypeTransformer? _instance;
}


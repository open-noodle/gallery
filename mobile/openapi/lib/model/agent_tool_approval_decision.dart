//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentToolApprovalDecision {
  /// Instantiate a new enum with the provided [value].
  const AgentToolApprovalDecision._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approved = AgentToolApprovalDecision._(r'approved');
  static const denied = AgentToolApprovalDecision._(r'denied');

  /// List of all possible values in this [enum][AgentToolApprovalDecision].
  static const values = <AgentToolApprovalDecision>[
    approved,
    denied,
  ];

  static AgentToolApprovalDecision? fromJson(dynamic value) => AgentToolApprovalDecisionTypeTransformer().decode(value);

  static List<AgentToolApprovalDecision> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentToolApprovalDecision>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentToolApprovalDecision.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentToolApprovalDecision] to String,
/// and [decode] dynamic data back to [AgentToolApprovalDecision].
class AgentToolApprovalDecisionTypeTransformer {
  factory AgentToolApprovalDecisionTypeTransformer() => _instance ??= const AgentToolApprovalDecisionTypeTransformer._();

  const AgentToolApprovalDecisionTypeTransformer._();

  String encode(AgentToolApprovalDecision data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentToolApprovalDecision.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentToolApprovalDecision? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approved': return AgentToolApprovalDecision.approved;
        case r'denied': return AgentToolApprovalDecision.denied;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentToolApprovalDecisionTypeTransformer] instance.
  static AgentToolApprovalDecisionTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentApprovalMode {
  /// Instantiate a new enum with the provided [value].
  const AgentApprovalMode._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const strict = AgentApprovalMode._(r'strict');
  static const askOnEscalation = AgentApprovalMode._(r'ask-on-escalation');
  static const planOnly = AgentApprovalMode._(r'plan-only');
  static const dangerouslySkipPermissions = AgentApprovalMode._(r'dangerously-skip-permissions');

  /// List of all possible values in this [enum][AgentApprovalMode].
  static const values = <AgentApprovalMode>[
    strict,
    askOnEscalation,
    planOnly,
    dangerouslySkipPermissions,
  ];

  static AgentApprovalMode? fromJson(dynamic value) => AgentApprovalModeTypeTransformer().decode(value);

  static List<AgentApprovalMode> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentApprovalMode>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentApprovalMode.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentApprovalMode] to String,
/// and [decode] dynamic data back to [AgentApprovalMode].
class AgentApprovalModeTypeTransformer {
  factory AgentApprovalModeTypeTransformer() => _instance ??= const AgentApprovalModeTypeTransformer._();

  const AgentApprovalModeTypeTransformer._();

  String encode(AgentApprovalMode data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentApprovalMode.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentApprovalMode? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'strict': return AgentApprovalMode.strict;
        case r'ask-on-escalation': return AgentApprovalMode.askOnEscalation;
        case r'plan-only': return AgentApprovalMode.planOnly;
        case r'dangerously-skip-permissions': return AgentApprovalMode.dangerouslySkipPermissions;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentApprovalModeTypeTransformer] instance.
  static AgentApprovalModeTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentApprovalMode {
  strict._(r'strict'),
  askOnEscalation._(r'ask-on-escalation'),
  planOnly._(r'plan-only'),
  dangerouslySkipPermissions._(r'dangerously-skip-permissions'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentApprovalMode._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentApprovalMode] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentApprovalMode? fromJson(dynamic value) => AgentApprovalModeTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentApprovalMode]
  /// that were successfully decoded from the passed [JSON][json].
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

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentApprovalMode data) => data._value;

  /// Returns the instance of [AgentApprovalMode] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentApprovalMode? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentApprovalMode) {
      return data;
    }
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

  /// The singleton instance of this transformer.
  static AgentApprovalModeTypeTransformer? _instance;
}


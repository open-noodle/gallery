//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentMessageRole {
  user._(r'user'),
  assistant._(r'assistant'),
  system._(r'system'),
  tool._(r'tool'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentMessageRole._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentMessageRole] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentMessageRole? fromJson(dynamic value) => AgentMessageRoleTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentMessageRole]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentMessageRole> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageRole>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageRole.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentMessageRole] to String,
/// and [decode] dynamic data back to [AgentMessageRole].
class AgentMessageRoleTypeTransformer {
  factory AgentMessageRoleTypeTransformer() => _instance ??= const AgentMessageRoleTypeTransformer._();

  const AgentMessageRoleTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentMessageRole data) => data._value;

  /// Returns the instance of [AgentMessageRole] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentMessageRole? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentMessageRole) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'user': return AgentMessageRole.user;
        case r'assistant': return AgentMessageRole.assistant;
        case r'system': return AgentMessageRole.system;
        case r'tool': return AgentMessageRole.tool;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentMessageRoleTypeTransformer? _instance;
}


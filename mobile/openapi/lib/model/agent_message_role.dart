//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentMessageRole {
  /// Instantiate a new enum with the provided [value].
  const AgentMessageRole._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const user = AgentMessageRole._(r'user');
  static const assistant = AgentMessageRole._(r'assistant');
  static const system = AgentMessageRole._(r'system');
  static const tool = AgentMessageRole._(r'tool');

  /// List of all possible values in this [enum][AgentMessageRole].
  static const values = <AgentMessageRole>[
    user,
    assistant,
    system,
    tool,
  ];

  static AgentMessageRole? fromJson(dynamic value) => AgentMessageRoleTypeTransformer().decode(value);

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

  String encode(AgentMessageRole data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentMessageRole.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentMessageRole? decode(dynamic data, {bool allowNull = true}) {
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

  /// Singleton [AgentMessageRoleTypeTransformer] instance.
  static AgentMessageRoleTypeTransformer? _instance;
}


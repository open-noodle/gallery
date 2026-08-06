//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentMessageClarificationBlockType {
  /// Instantiate a new enum with the provided [value].
  const AgentMessageClarificationBlockType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const clarification = AgentMessageClarificationBlockType._(r'clarification');

  /// List of all possible values in this [enum][AgentMessageClarificationBlockType].
  static const values = <AgentMessageClarificationBlockType>[
    clarification,
  ];

  static AgentMessageClarificationBlockType? fromJson(dynamic value) => AgentMessageClarificationBlockTypeTypeTransformer().decode(value);

  static List<AgentMessageClarificationBlockType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageClarificationBlockType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageClarificationBlockType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentMessageClarificationBlockType] to String,
/// and [decode] dynamic data back to [AgentMessageClarificationBlockType].
class AgentMessageClarificationBlockTypeTypeTransformer {
  factory AgentMessageClarificationBlockTypeTypeTransformer() => _instance ??= const AgentMessageClarificationBlockTypeTypeTransformer._();

  const AgentMessageClarificationBlockTypeTypeTransformer._();

  String encode(AgentMessageClarificationBlockType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentMessageClarificationBlockType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentMessageClarificationBlockType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'clarification': return AgentMessageClarificationBlockType.clarification;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentMessageClarificationBlockTypeTypeTransformer] instance.
  static AgentMessageClarificationBlockTypeTypeTransformer? _instance;
}


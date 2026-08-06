//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentProviderType {
  /// Instantiate a new enum with the provided [value].
  const AgentProviderType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const openai = AgentProviderType._(r'openai');
  static const anthropic = AgentProviderType._(r'anthropic');
  static const openaiCompatible = AgentProviderType._(r'openai-compatible');

  /// List of all possible values in this [enum][AgentProviderType].
  static const values = <AgentProviderType>[
    openai,
    anthropic,
    openaiCompatible,
  ];

  static AgentProviderType? fromJson(dynamic value) => AgentProviderTypeTypeTransformer().decode(value);

  static List<AgentProviderType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProviderType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProviderType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentProviderType] to String,
/// and [decode] dynamic data back to [AgentProviderType].
class AgentProviderTypeTypeTransformer {
  factory AgentProviderTypeTypeTransformer() => _instance ??= const AgentProviderTypeTypeTransformer._();

  const AgentProviderTypeTypeTransformer._();

  String encode(AgentProviderType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentProviderType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentProviderType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'openai': return AgentProviderType.openai;
        case r'anthropic': return AgentProviderType.anthropic;
        case r'openai-compatible': return AgentProviderType.openaiCompatible;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentProviderTypeTypeTransformer] instance.
  static AgentProviderTypeTypeTransformer? _instance;
}


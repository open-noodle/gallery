//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentMessageAssetBlockType {
  /// Instantiate a new enum with the provided [value].
  const AgentMessageAssetBlockType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const asset = AgentMessageAssetBlockType._(r'asset');

  /// List of all possible values in this [enum][AgentMessageAssetBlockType].
  static const values = <AgentMessageAssetBlockType>[
    asset,
  ];

  static AgentMessageAssetBlockType? fromJson(dynamic value) => AgentMessageAssetBlockTypeTypeTransformer().decode(value);

  static List<AgentMessageAssetBlockType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageAssetBlockType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageAssetBlockType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentMessageAssetBlockType] to String,
/// and [decode] dynamic data back to [AgentMessageAssetBlockType].
class AgentMessageAssetBlockTypeTypeTransformer {
  factory AgentMessageAssetBlockTypeTypeTransformer() => _instance ??= const AgentMessageAssetBlockTypeTypeTransformer._();

  const AgentMessageAssetBlockTypeTypeTransformer._();

  String encode(AgentMessageAssetBlockType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentMessageAssetBlockType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentMessageAssetBlockType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset': return AgentMessageAssetBlockType.asset;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentMessageAssetBlockTypeTypeTransformer] instance.
  static AgentMessageAssetBlockTypeTypeTransformer? _instance;
}


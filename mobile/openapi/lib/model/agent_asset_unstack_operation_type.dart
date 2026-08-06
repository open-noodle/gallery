//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetUnstackOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetUnstackOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const assetPeriodUnstack = AgentAssetUnstackOperationType._(r'asset.unstack');

  /// List of all possible values in this [enum][AgentAssetUnstackOperationType].
  static const values = <AgentAssetUnstackOperationType>[
    assetPeriodUnstack,
  ];

  static AgentAssetUnstackOperationType? fromJson(dynamic value) => AgentAssetUnstackOperationTypeTypeTransformer().decode(value);

  static List<AgentAssetUnstackOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetUnstackOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetUnstackOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetUnstackOperationType] to String,
/// and [decode] dynamic data back to [AgentAssetUnstackOperationType].
class AgentAssetUnstackOperationTypeTypeTransformer {
  factory AgentAssetUnstackOperationTypeTypeTransformer() => _instance ??= const AgentAssetUnstackOperationTypeTypeTransformer._();

  const AgentAssetUnstackOperationTypeTypeTransformer._();

  String encode(AgentAssetUnstackOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetUnstackOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetUnstackOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset.unstack': return AgentAssetUnstackOperationType.assetPeriodUnstack;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssetUnstackOperationTypeTypeTransformer] instance.
  static AgentAssetUnstackOperationTypeTypeTransformer? _instance;
}


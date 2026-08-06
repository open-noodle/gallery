//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetSetVisibilityOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetSetVisibilityOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const assetPeriodSetVisibility = AgentAssetSetVisibilityOperationType._(r'asset.setVisibility');

  /// List of all possible values in this [enum][AgentAssetSetVisibilityOperationType].
  static const values = <AgentAssetSetVisibilityOperationType>[
    assetPeriodSetVisibility,
  ];

  static AgentAssetSetVisibilityOperationType? fromJson(dynamic value) => AgentAssetSetVisibilityOperationTypeTypeTransformer().decode(value);

  static List<AgentAssetSetVisibilityOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetSetVisibilityOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetSetVisibilityOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetSetVisibilityOperationType] to String,
/// and [decode] dynamic data back to [AgentAssetSetVisibilityOperationType].
class AgentAssetSetVisibilityOperationTypeTypeTransformer {
  factory AgentAssetSetVisibilityOperationTypeTypeTransformer() => _instance ??= const AgentAssetSetVisibilityOperationTypeTypeTransformer._();

  const AgentAssetSetVisibilityOperationTypeTypeTransformer._();

  String encode(AgentAssetSetVisibilityOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetSetVisibilityOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetSetVisibilityOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset.setVisibility': return AgentAssetSetVisibilityOperationType.assetPeriodSetVisibility;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssetSetVisibilityOperationTypeTypeTransformer] instance.
  static AgentAssetSetVisibilityOperationTypeTypeTransformer? _instance;
}


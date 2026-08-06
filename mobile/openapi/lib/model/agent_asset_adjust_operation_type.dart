//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetAdjustOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetAdjustOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const assetPeriodAdjust = AgentAssetAdjustOperationType._(r'asset.adjust');

  /// List of all possible values in this [enum][AgentAssetAdjustOperationType].
  static const values = <AgentAssetAdjustOperationType>[
    assetPeriodAdjust,
  ];

  static AgentAssetAdjustOperationType? fromJson(dynamic value) => AgentAssetAdjustOperationTypeTypeTransformer().decode(value);

  static List<AgentAssetAdjustOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetAdjustOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetAdjustOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetAdjustOperationType] to String,
/// and [decode] dynamic data back to [AgentAssetAdjustOperationType].
class AgentAssetAdjustOperationTypeTypeTransformer {
  factory AgentAssetAdjustOperationTypeTypeTransformer() => _instance ??= const AgentAssetAdjustOperationTypeTypeTransformer._();

  const AgentAssetAdjustOperationTypeTypeTransformer._();

  String encode(AgentAssetAdjustOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetAdjustOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetAdjustOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset.adjust': return AgentAssetAdjustOperationType.assetPeriodAdjust;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssetAdjustOperationTypeTypeTransformer] instance.
  static AgentAssetAdjustOperationTypeTypeTransformer? _instance;
}


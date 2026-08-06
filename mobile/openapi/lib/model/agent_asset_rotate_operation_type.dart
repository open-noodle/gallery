//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetRotateOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetRotateOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const assetPeriodRotate = AgentAssetRotateOperationType._(r'asset.rotate');

  /// List of all possible values in this [enum][AgentAssetRotateOperationType].
  static const values = <AgentAssetRotateOperationType>[
    assetPeriodRotate,
  ];

  static AgentAssetRotateOperationType? fromJson(dynamic value) => AgentAssetRotateOperationTypeTypeTransformer().decode(value);

  static List<AgentAssetRotateOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetRotateOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetRotateOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetRotateOperationType] to String,
/// and [decode] dynamic data back to [AgentAssetRotateOperationType].
class AgentAssetRotateOperationTypeTypeTransformer {
  factory AgentAssetRotateOperationTypeTypeTransformer() => _instance ??= const AgentAssetRotateOperationTypeTypeTransformer._();

  const AgentAssetRotateOperationTypeTypeTransformer._();

  String encode(AgentAssetRotateOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetRotateOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetRotateOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset.rotate': return AgentAssetRotateOperationType.assetPeriodRotate;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssetRotateOperationTypeTypeTransformer] instance.
  static AgentAssetRotateOperationTypeTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetUpdateMetadataOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetUpdateMetadataOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const assetPeriodUpdateMetadata = AgentAssetUpdateMetadataOperationType._(r'asset.updateMetadata');

  /// List of all possible values in this [enum][AgentAssetUpdateMetadataOperationType].
  static const values = <AgentAssetUpdateMetadataOperationType>[
    assetPeriodUpdateMetadata,
  ];

  static AgentAssetUpdateMetadataOperationType? fromJson(dynamic value) => AgentAssetUpdateMetadataOperationTypeTypeTransformer().decode(value);

  static List<AgentAssetUpdateMetadataOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetUpdateMetadataOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetUpdateMetadataOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetUpdateMetadataOperationType] to String,
/// and [decode] dynamic data back to [AgentAssetUpdateMetadataOperationType].
class AgentAssetUpdateMetadataOperationTypeTypeTransformer {
  factory AgentAssetUpdateMetadataOperationTypeTypeTransformer() => _instance ??= const AgentAssetUpdateMetadataOperationTypeTypeTransformer._();

  const AgentAssetUpdateMetadataOperationTypeTypeTransformer._();

  String encode(AgentAssetUpdateMetadataOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetUpdateMetadataOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetUpdateMetadataOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset.updateMetadata': return AgentAssetUpdateMetadataOperationType.assetPeriodUpdateMetadata;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssetUpdateMetadataOperationTypeTypeTransformer] instance.
  static AgentAssetUpdateMetadataOperationTypeTypeTransformer? _instance;
}


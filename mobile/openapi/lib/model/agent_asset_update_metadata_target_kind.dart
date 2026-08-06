//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetUpdateMetadataTargetKind {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetUpdateMetadataTargetKind._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const assetBatch = AgentAssetUpdateMetadataTargetKind._(r'asset_batch');

  /// List of all possible values in this [enum][AgentAssetUpdateMetadataTargetKind].
  static const values = <AgentAssetUpdateMetadataTargetKind>[
    assetBatch,
  ];

  static AgentAssetUpdateMetadataTargetKind? fromJson(dynamic value) => AgentAssetUpdateMetadataTargetKindTypeTransformer().decode(value);

  static List<AgentAssetUpdateMetadataTargetKind> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetUpdateMetadataTargetKind>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetUpdateMetadataTargetKind.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetUpdateMetadataTargetKind] to String,
/// and [decode] dynamic data back to [AgentAssetUpdateMetadataTargetKind].
class AgentAssetUpdateMetadataTargetKindTypeTransformer {
  factory AgentAssetUpdateMetadataTargetKindTypeTransformer() => _instance ??= const AgentAssetUpdateMetadataTargetKindTypeTransformer._();

  const AgentAssetUpdateMetadataTargetKindTypeTransformer._();

  String encode(AgentAssetUpdateMetadataTargetKind data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetUpdateMetadataTargetKind.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetUpdateMetadataTargetKind? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset_batch': return AgentAssetUpdateMetadataTargetKind.assetBatch;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssetUpdateMetadataTargetKindTypeTransformer] instance.
  static AgentAssetUpdateMetadataTargetKindTypeTransformer? _instance;
}


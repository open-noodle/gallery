//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetRemoveTagOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetRemoveTagOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const assetPeriodRemoveTag = AgentAssetRemoveTagOperationType._(r'asset.removeTag');

  /// List of all possible values in this [enum][AgentAssetRemoveTagOperationType].
  static const values = <AgentAssetRemoveTagOperationType>[
    assetPeriodRemoveTag,
  ];

  static AgentAssetRemoveTagOperationType? fromJson(dynamic value) => AgentAssetRemoveTagOperationTypeTypeTransformer().decode(value);

  static List<AgentAssetRemoveTagOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetRemoveTagOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetRemoveTagOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetRemoveTagOperationType] to String,
/// and [decode] dynamic data back to [AgentAssetRemoveTagOperationType].
class AgentAssetRemoveTagOperationTypeTypeTransformer {
  factory AgentAssetRemoveTagOperationTypeTypeTransformer() => _instance ??= const AgentAssetRemoveTagOperationTypeTypeTransformer._();

  const AgentAssetRemoveTagOperationTypeTypeTransformer._();

  String encode(AgentAssetRemoveTagOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetRemoveTagOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetRemoveTagOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset.removeTag': return AgentAssetRemoveTagOperationType.assetPeriodRemoveTag;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssetRemoveTagOperationTypeTypeTransformer] instance.
  static AgentAssetRemoveTagOperationTypeTypeTransformer? _instance;
}


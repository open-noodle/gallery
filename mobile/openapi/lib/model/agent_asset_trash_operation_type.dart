//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetTrashOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetTrashOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const assetPeriodTrash = AgentAssetTrashOperationType._(r'asset.trash');

  /// List of all possible values in this [enum][AgentAssetTrashOperationType].
  static const values = <AgentAssetTrashOperationType>[
    assetPeriodTrash,
  ];

  static AgentAssetTrashOperationType? fromJson(dynamic value) => AgentAssetTrashOperationTypeTypeTransformer().decode(value);

  static List<AgentAssetTrashOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetTrashOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetTrashOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetTrashOperationType] to String,
/// and [decode] dynamic data back to [AgentAssetTrashOperationType].
class AgentAssetTrashOperationTypeTypeTransformer {
  factory AgentAssetTrashOperationTypeTypeTransformer() => _instance ??= const AgentAssetTrashOperationTypeTypeTransformer._();

  const AgentAssetTrashOperationTypeTypeTransformer._();

  String encode(AgentAssetTrashOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetTrashOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetTrashOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asset.trash': return AgentAssetTrashOperationType.assetPeriodTrash;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssetTrashOperationTypeTypeTransformer] instance.
  static AgentAssetTrashOperationTypeTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAlbumAddAssetsOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAlbumAddAssetsOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const albumPeriodAddAssets = AgentAlbumAddAssetsOperationType._(r'album.addAssets');

  /// List of all possible values in this [enum][AgentAlbumAddAssetsOperationType].
  static const values = <AgentAlbumAddAssetsOperationType>[
    albumPeriodAddAssets,
  ];

  static AgentAlbumAddAssetsOperationType? fromJson(dynamic value) => AgentAlbumAddAssetsOperationTypeTypeTransformer().decode(value);

  static List<AgentAlbumAddAssetsOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAlbumAddAssetsOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAlbumAddAssetsOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAlbumAddAssetsOperationType] to String,
/// and [decode] dynamic data back to [AgentAlbumAddAssetsOperationType].
class AgentAlbumAddAssetsOperationTypeTypeTransformer {
  factory AgentAlbumAddAssetsOperationTypeTypeTransformer() => _instance ??= const AgentAlbumAddAssetsOperationTypeTypeTransformer._();

  const AgentAlbumAddAssetsOperationTypeTypeTransformer._();

  String encode(AgentAlbumAddAssetsOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAlbumAddAssetsOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAlbumAddAssetsOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'album.addAssets': return AgentAlbumAddAssetsOperationType.albumPeriodAddAssets;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAlbumAddAssetsOperationTypeTypeTransformer] instance.
  static AgentAlbumAddAssetsOperationTypeTypeTransformer? _instance;
}


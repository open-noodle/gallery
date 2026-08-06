//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAlbumSetCoverOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAlbumSetCoverOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const albumPeriodSetCover = AgentAlbumSetCoverOperationType._(r'album.setCover');

  /// List of all possible values in this [enum][AgentAlbumSetCoverOperationType].
  static const values = <AgentAlbumSetCoverOperationType>[
    albumPeriodSetCover,
  ];

  static AgentAlbumSetCoverOperationType? fromJson(dynamic value) => AgentAlbumSetCoverOperationTypeTypeTransformer().decode(value);

  static List<AgentAlbumSetCoverOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAlbumSetCoverOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAlbumSetCoverOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAlbumSetCoverOperationType] to String,
/// and [decode] dynamic data back to [AgentAlbumSetCoverOperationType].
class AgentAlbumSetCoverOperationTypeTypeTransformer {
  factory AgentAlbumSetCoverOperationTypeTypeTransformer() => _instance ??= const AgentAlbumSetCoverOperationTypeTypeTransformer._();

  const AgentAlbumSetCoverOperationTypeTypeTransformer._();

  String encode(AgentAlbumSetCoverOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAlbumSetCoverOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAlbumSetCoverOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'album.setCover': return AgentAlbumSetCoverOperationType.albumPeriodSetCover;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAlbumSetCoverOperationTypeTypeTransformer] instance.
  static AgentAlbumSetCoverOperationTypeTypeTransformer? _instance;
}


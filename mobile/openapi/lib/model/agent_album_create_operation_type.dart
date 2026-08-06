//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAlbumCreateOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAlbumCreateOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const albumPeriodCreate = AgentAlbumCreateOperationType._(r'album.create');

  /// List of all possible values in this [enum][AgentAlbumCreateOperationType].
  static const values = <AgentAlbumCreateOperationType>[
    albumPeriodCreate,
  ];

  static AgentAlbumCreateOperationType? fromJson(dynamic value) => AgentAlbumCreateOperationTypeTypeTransformer().decode(value);

  static List<AgentAlbumCreateOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAlbumCreateOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAlbumCreateOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAlbumCreateOperationType] to String,
/// and [decode] dynamic data back to [AgentAlbumCreateOperationType].
class AgentAlbumCreateOperationTypeTypeTransformer {
  factory AgentAlbumCreateOperationTypeTypeTransformer() => _instance ??= const AgentAlbumCreateOperationTypeTypeTransformer._();

  const AgentAlbumCreateOperationTypeTypeTransformer._();

  String encode(AgentAlbumCreateOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAlbumCreateOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAlbumCreateOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'album.create': return AgentAlbumCreateOperationType.albumPeriodCreate;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAlbumCreateOperationTypeTypeTransformer] instance.
  static AgentAlbumCreateOperationTypeTypeTransformer? _instance;
}


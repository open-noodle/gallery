//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAlbumRemoveUsersOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAlbumRemoveUsersOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const albumPeriodRemoveUsers = AgentAlbumRemoveUsersOperationType._(r'album.removeUsers');

  /// List of all possible values in this [enum][AgentAlbumRemoveUsersOperationType].
  static const values = <AgentAlbumRemoveUsersOperationType>[
    albumPeriodRemoveUsers,
  ];

  static AgentAlbumRemoveUsersOperationType? fromJson(dynamic value) => AgentAlbumRemoveUsersOperationTypeTypeTransformer().decode(value);

  static List<AgentAlbumRemoveUsersOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAlbumRemoveUsersOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAlbumRemoveUsersOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAlbumRemoveUsersOperationType] to String,
/// and [decode] dynamic data back to [AgentAlbumRemoveUsersOperationType].
class AgentAlbumRemoveUsersOperationTypeTypeTransformer {
  factory AgentAlbumRemoveUsersOperationTypeTypeTransformer() => _instance ??= const AgentAlbumRemoveUsersOperationTypeTypeTransformer._();

  const AgentAlbumRemoveUsersOperationTypeTypeTransformer._();

  String encode(AgentAlbumRemoveUsersOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAlbumRemoveUsersOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAlbumRemoveUsersOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'album.removeUsers': return AgentAlbumRemoveUsersOperationType.albumPeriodRemoveUsers;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAlbumRemoveUsersOperationTypeTypeTransformer] instance.
  static AgentAlbumRemoveUsersOperationTypeTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAlbumUpdateUserRoleOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentAlbumUpdateUserRoleOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const albumPeriodUpdateUserRole = AgentAlbumUpdateUserRoleOperationType._(r'album.updateUserRole');

  /// List of all possible values in this [enum][AgentAlbumUpdateUserRoleOperationType].
  static const values = <AgentAlbumUpdateUserRoleOperationType>[
    albumPeriodUpdateUserRole,
  ];

  static AgentAlbumUpdateUserRoleOperationType? fromJson(dynamic value) => AgentAlbumUpdateUserRoleOperationTypeTypeTransformer().decode(value);

  static List<AgentAlbumUpdateUserRoleOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAlbumUpdateUserRoleOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAlbumUpdateUserRoleOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAlbumUpdateUserRoleOperationType] to String,
/// and [decode] dynamic data back to [AgentAlbumUpdateUserRoleOperationType].
class AgentAlbumUpdateUserRoleOperationTypeTypeTransformer {
  factory AgentAlbumUpdateUserRoleOperationTypeTypeTransformer() => _instance ??= const AgentAlbumUpdateUserRoleOperationTypeTypeTransformer._();

  const AgentAlbumUpdateUserRoleOperationTypeTypeTransformer._();

  String encode(AgentAlbumUpdateUserRoleOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAlbumUpdateUserRoleOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAlbumUpdateUserRoleOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'album.updateUserRole': return AgentAlbumUpdateUserRoleOperationType.albumPeriodUpdateUserRole;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAlbumUpdateUserRoleOperationTypeTypeTransformer] instance.
  static AgentAlbumUpdateUserRoleOperationTypeTypeTransformer? _instance;
}


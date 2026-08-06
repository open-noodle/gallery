//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssignableAlbumUserRole {
  /// Instantiate a new enum with the provided [value].
  const AgentAssignableAlbumUserRole._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const editor = AgentAssignableAlbumUserRole._(r'editor');
  static const viewer = AgentAssignableAlbumUserRole._(r'viewer');

  /// List of all possible values in this [enum][AgentAssignableAlbumUserRole].
  static const values = <AgentAssignableAlbumUserRole>[
    editor,
    viewer,
  ];

  static AgentAssignableAlbumUserRole? fromJson(dynamic value) => AgentAssignableAlbumUserRoleTypeTransformer().decode(value);

  static List<AgentAssignableAlbumUserRole> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssignableAlbumUserRole>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssignableAlbumUserRole.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssignableAlbumUserRole] to String,
/// and [decode] dynamic data back to [AgentAssignableAlbumUserRole].
class AgentAssignableAlbumUserRoleTypeTransformer {
  factory AgentAssignableAlbumUserRoleTypeTransformer() => _instance ??= const AgentAssignableAlbumUserRoleTypeTransformer._();

  const AgentAssignableAlbumUserRoleTypeTransformer._();

  String encode(AgentAssignableAlbumUserRole data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssignableAlbumUserRole.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssignableAlbumUserRole? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'editor': return AgentAssignableAlbumUserRole.editor;
        case r'viewer': return AgentAssignableAlbumUserRole.viewer;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssignableAlbumUserRoleTypeTransformer] instance.
  static AgentAssignableAlbumUserRoleTypeTransformer? _instance;
}


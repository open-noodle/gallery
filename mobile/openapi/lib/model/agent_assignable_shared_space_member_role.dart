//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssignableSharedSpaceMemberRole {
  /// Instantiate a new enum with the provided [value].
  const AgentAssignableSharedSpaceMemberRole._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const editor = AgentAssignableSharedSpaceMemberRole._(r'editor');
  static const viewer = AgentAssignableSharedSpaceMemberRole._(r'viewer');

  /// List of all possible values in this [enum][AgentAssignableSharedSpaceMemberRole].
  static const values = <AgentAssignableSharedSpaceMemberRole>[
    editor,
    viewer,
  ];

  static AgentAssignableSharedSpaceMemberRole? fromJson(dynamic value) => AgentAssignableSharedSpaceMemberRoleTypeTransformer().decode(value);

  static List<AgentAssignableSharedSpaceMemberRole> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssignableSharedSpaceMemberRole>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssignableSharedSpaceMemberRole.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssignableSharedSpaceMemberRole] to String,
/// and [decode] dynamic data back to [AgentAssignableSharedSpaceMemberRole].
class AgentAssignableSharedSpaceMemberRoleTypeTransformer {
  factory AgentAssignableSharedSpaceMemberRoleTypeTransformer() => _instance ??= const AgentAssignableSharedSpaceMemberRoleTypeTransformer._();

  const AgentAssignableSharedSpaceMemberRoleTypeTransformer._();

  String encode(AgentAssignableSharedSpaceMemberRole data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssignableSharedSpaceMemberRole.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssignableSharedSpaceMemberRole? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'editor': return AgentAssignableSharedSpaceMemberRole.editor;
        case r'viewer': return AgentAssignableSharedSpaceMemberRole.viewer;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentAssignableSharedSpaceMemberRoleTypeTransformer] instance.
  static AgentAssignableSharedSpaceMemberRoleTypeTransformer? _instance;
}


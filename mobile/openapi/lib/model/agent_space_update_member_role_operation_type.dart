//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSpaceUpdateMemberRoleOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentSpaceUpdateMemberRoleOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const spacePeriodUpdateMemberRole = AgentSpaceUpdateMemberRoleOperationType._(r'space.updateMemberRole');

  /// List of all possible values in this [enum][AgentSpaceUpdateMemberRoleOperationType].
  static const values = <AgentSpaceUpdateMemberRoleOperationType>[
    spacePeriodUpdateMemberRole,
  ];

  static AgentSpaceUpdateMemberRoleOperationType? fromJson(dynamic value) => AgentSpaceUpdateMemberRoleOperationTypeTypeTransformer().decode(value);

  static List<AgentSpaceUpdateMemberRoleOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSpaceUpdateMemberRoleOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSpaceUpdateMemberRoleOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSpaceUpdateMemberRoleOperationType] to String,
/// and [decode] dynamic data back to [AgentSpaceUpdateMemberRoleOperationType].
class AgentSpaceUpdateMemberRoleOperationTypeTypeTransformer {
  factory AgentSpaceUpdateMemberRoleOperationTypeTypeTransformer() => _instance ??= const AgentSpaceUpdateMemberRoleOperationTypeTypeTransformer._();

  const AgentSpaceUpdateMemberRoleOperationTypeTypeTransformer._();

  String encode(AgentSpaceUpdateMemberRoleOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSpaceUpdateMemberRoleOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSpaceUpdateMemberRoleOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'space.updateMemberRole': return AgentSpaceUpdateMemberRoleOperationType.spacePeriodUpdateMemberRole;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSpaceUpdateMemberRoleOperationTypeTypeTransformer] instance.
  static AgentSpaceUpdateMemberRoleOperationTypeTypeTransformer? _instance;
}


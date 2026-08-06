//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSpaceRemoveMembersOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentSpaceRemoveMembersOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const spacePeriodRemoveMembers = AgentSpaceRemoveMembersOperationType._(r'space.removeMembers');

  /// List of all possible values in this [enum][AgentSpaceRemoveMembersOperationType].
  static const values = <AgentSpaceRemoveMembersOperationType>[
    spacePeriodRemoveMembers,
  ];

  static AgentSpaceRemoveMembersOperationType? fromJson(dynamic value) => AgentSpaceRemoveMembersOperationTypeTypeTransformer().decode(value);

  static List<AgentSpaceRemoveMembersOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSpaceRemoveMembersOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSpaceRemoveMembersOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSpaceRemoveMembersOperationType] to String,
/// and [decode] dynamic data back to [AgentSpaceRemoveMembersOperationType].
class AgentSpaceRemoveMembersOperationTypeTypeTransformer {
  factory AgentSpaceRemoveMembersOperationTypeTypeTransformer() => _instance ??= const AgentSpaceRemoveMembersOperationTypeTypeTransformer._();

  const AgentSpaceRemoveMembersOperationTypeTypeTransformer._();

  String encode(AgentSpaceRemoveMembersOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSpaceRemoveMembersOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSpaceRemoveMembersOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'space.removeMembers': return AgentSpaceRemoveMembersOperationType.spacePeriodRemoveMembers;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSpaceRemoveMembersOperationTypeTypeTransformer] instance.
  static AgentSpaceRemoveMembersOperationTypeTypeTransformer? _instance;
}


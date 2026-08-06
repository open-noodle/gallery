//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationApplyStatus {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationApplyStatus._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const applied = AgentOperationApplyStatus._(r'applied');
  static const partiallyApplied = AgentOperationApplyStatus._(r'partially_applied');
  static const failed = AgentOperationApplyStatus._(r'failed');

  /// List of all possible values in this [enum][AgentOperationApplyStatus].
  static const values = <AgentOperationApplyStatus>[
    applied,
    partiallyApplied,
    failed,
  ];

  static AgentOperationApplyStatus? fromJson(dynamic value) => AgentOperationApplyStatusTypeTransformer().decode(value);

  static List<AgentOperationApplyStatus> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationApplyStatus>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationApplyStatus.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationApplyStatus] to String,
/// and [decode] dynamic data back to [AgentOperationApplyStatus].
class AgentOperationApplyStatusTypeTransformer {
  factory AgentOperationApplyStatusTypeTransformer() => _instance ??= const AgentOperationApplyStatusTypeTransformer._();

  const AgentOperationApplyStatusTypeTransformer._();

  String encode(AgentOperationApplyStatus data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationApplyStatus.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationApplyStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'applied': return AgentOperationApplyStatus.applied;
        case r'partially_applied': return AgentOperationApplyStatus.partiallyApplied;
        case r'failed': return AgentOperationApplyStatus.failed;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationApplyStatusTypeTransformer] instance.
  static AgentOperationApplyStatusTypeTransformer? _instance;
}


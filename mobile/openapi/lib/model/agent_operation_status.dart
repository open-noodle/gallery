//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationStatus {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationStatus._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const proposed = AgentOperationStatus._(r'proposed');
  static const applied = AgentOperationStatus._(r'applied');
  static const skipped = AgentOperationStatus._(r'skipped');
  static const failed = AgentOperationStatus._(r'failed');

  /// List of all possible values in this [enum][AgentOperationStatus].
  static const values = <AgentOperationStatus>[
    proposed,
    applied,
    skipped,
    failed,
  ];

  static AgentOperationStatus? fromJson(dynamic value) => AgentOperationStatusTypeTransformer().decode(value);

  static List<AgentOperationStatus> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationStatus>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationStatus.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationStatus] to String,
/// and [decode] dynamic data back to [AgentOperationStatus].
class AgentOperationStatusTypeTransformer {
  factory AgentOperationStatusTypeTransformer() => _instance ??= const AgentOperationStatusTypeTransformer._();

  const AgentOperationStatusTypeTransformer._();

  String encode(AgentOperationStatus data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationStatus.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'proposed': return AgentOperationStatus.proposed;
        case r'applied': return AgentOperationStatus.applied;
        case r'skipped': return AgentOperationStatus.skipped;
        case r'failed': return AgentOperationStatus.failed;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationStatusTypeTransformer] instance.
  static AgentOperationStatusTypeTransformer? _instance;
}


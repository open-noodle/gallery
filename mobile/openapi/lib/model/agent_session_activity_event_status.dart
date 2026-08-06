//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSessionActivityEventStatus {
  /// Instantiate a new enum with the provided [value].
  const AgentSessionActivityEventStatus._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const running = AgentSessionActivityEventStatus._(r'running');
  static const completed = AgentSessionActivityEventStatus._(r'completed');
  static const failed = AgentSessionActivityEventStatus._(r'failed');
  static const skipped = AgentSessionActivityEventStatus._(r'skipped');

  /// List of all possible values in this [enum][AgentSessionActivityEventStatus].
  static const values = <AgentSessionActivityEventStatus>[
    running,
    completed,
    failed,
    skipped,
  ];

  static AgentSessionActivityEventStatus? fromJson(dynamic value) => AgentSessionActivityEventStatusTypeTransformer().decode(value);

  static List<AgentSessionActivityEventStatus> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSessionActivityEventStatus>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSessionActivityEventStatus.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSessionActivityEventStatus] to String,
/// and [decode] dynamic data back to [AgentSessionActivityEventStatus].
class AgentSessionActivityEventStatusTypeTransformer {
  factory AgentSessionActivityEventStatusTypeTransformer() => _instance ??= const AgentSessionActivityEventStatusTypeTransformer._();

  const AgentSessionActivityEventStatusTypeTransformer._();

  String encode(AgentSessionActivityEventStatus data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSessionActivityEventStatus.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSessionActivityEventStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'running': return AgentSessionActivityEventStatus.running;
        case r'completed': return AgentSessionActivityEventStatus.completed;
        case r'failed': return AgentSessionActivityEventStatus.failed;
        case r'skipped': return AgentSessionActivityEventStatus.skipped;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSessionActivityEventStatusTypeTransformer] instance.
  static AgentSessionActivityEventStatusTypeTransformer? _instance;
}


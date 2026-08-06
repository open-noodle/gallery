//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSessionActivityEventSource {
  /// Instantiate a new enum with the provided [value].
  const AgentSessionActivityEventSource._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const server = AgentSessionActivityEventSource._(r'server');
  static const runner = AgentSessionActivityEventSource._(r'runner');

  /// List of all possible values in this [enum][AgentSessionActivityEventSource].
  static const values = <AgentSessionActivityEventSource>[
    server,
    runner,
  ];

  static AgentSessionActivityEventSource? fromJson(dynamic value) => AgentSessionActivityEventSourceTypeTransformer().decode(value);

  static List<AgentSessionActivityEventSource> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSessionActivityEventSource>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSessionActivityEventSource.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSessionActivityEventSource] to String,
/// and [decode] dynamic data back to [AgentSessionActivityEventSource].
class AgentSessionActivityEventSourceTypeTransformer {
  factory AgentSessionActivityEventSourceTypeTransformer() => _instance ??= const AgentSessionActivityEventSourceTypeTransformer._();

  const AgentSessionActivityEventSourceTypeTransformer._();

  String encode(AgentSessionActivityEventSource data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSessionActivityEventSource.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSessionActivityEventSource? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'server': return AgentSessionActivityEventSource.server;
        case r'runner': return AgentSessionActivityEventSource.runner;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSessionActivityEventSourceTypeTransformer] instance.
  static AgentSessionActivityEventSourceTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentSessionActivityEventStatus {
  running._(r'running'),
  completed._(r'completed'),
  failed._(r'failed'),
  skipped._(r'skipped'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentSessionActivityEventStatus._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentSessionActivityEventStatus] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentSessionActivityEventStatus? fromJson(dynamic value) => AgentSessionActivityEventStatusTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentSessionActivityEventStatus]
  /// that were successfully decoded from the passed [JSON][json].
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

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentSessionActivityEventStatus data) => data._value;

  /// Returns the instance of [AgentSessionActivityEventStatus] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSessionActivityEventStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentSessionActivityEventStatus) {
      return data;
    }
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

  /// The singleton instance of this transformer.
  static AgentSessionActivityEventStatusTypeTransformer? _instance;
}


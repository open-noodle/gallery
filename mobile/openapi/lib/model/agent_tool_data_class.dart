//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentToolDataClass {
  metadata._(r'metadata'),
  previews._(r'previews'),
  originals._(r'originals'),
  plan._(r'plan'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentToolDataClass._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentToolDataClass] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentToolDataClass? fromJson(dynamic value) => AgentToolDataClassTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentToolDataClass]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentToolDataClass> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentToolDataClass>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentToolDataClass.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentToolDataClass] to String,
/// and [decode] dynamic data back to [AgentToolDataClass].
class AgentToolDataClassTypeTransformer {
  factory AgentToolDataClassTypeTransformer() => _instance ??= const AgentToolDataClassTypeTransformer._();

  const AgentToolDataClassTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentToolDataClass data) => data._value;

  /// Returns the instance of [AgentToolDataClass] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentToolDataClass? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentToolDataClass) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'metadata': return AgentToolDataClass.metadata;
        case r'previews': return AgentToolDataClass.previews;
        case r'originals': return AgentToolDataClass.originals;
        case r'plan': return AgentToolDataClass.plan;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentToolDataClassTypeTransformer? _instance;
}


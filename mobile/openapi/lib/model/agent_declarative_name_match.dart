//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentDeclarativeNameMatch {
  /// Instantiate a new enum with the provided [value].
  const AgentDeclarativeNameMatch._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const any = AgentDeclarativeNameMatch._(r'any');
  static const all = AgentDeclarativeNameMatch._(r'all');

  /// List of all possible values in this [enum][AgentDeclarativeNameMatch].
  static const values = <AgentDeclarativeNameMatch>[
    any,
    all,
  ];

  static AgentDeclarativeNameMatch? fromJson(dynamic value) => AgentDeclarativeNameMatchTypeTransformer().decode(value);

  static List<AgentDeclarativeNameMatch> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentDeclarativeNameMatch>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentDeclarativeNameMatch.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentDeclarativeNameMatch] to String,
/// and [decode] dynamic data back to [AgentDeclarativeNameMatch].
class AgentDeclarativeNameMatchTypeTransformer {
  factory AgentDeclarativeNameMatchTypeTransformer() => _instance ??= const AgentDeclarativeNameMatchTypeTransformer._();

  const AgentDeclarativeNameMatchTypeTransformer._();

  String encode(AgentDeclarativeNameMatch data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentDeclarativeNameMatch.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentDeclarativeNameMatch? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'any': return AgentDeclarativeNameMatch.any;
        case r'all': return AgentDeclarativeNameMatch.all;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentDeclarativeNameMatchTypeTransformer] instance.
  static AgentDeclarativeNameMatchTypeTransformer? _instance;
}


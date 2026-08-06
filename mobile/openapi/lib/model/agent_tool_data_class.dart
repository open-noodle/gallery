//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentToolDataClass {
  /// Instantiate a new enum with the provided [value].
  const AgentToolDataClass._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const metadata = AgentToolDataClass._(r'metadata');
  static const previews = AgentToolDataClass._(r'previews');
  static const originals = AgentToolDataClass._(r'originals');
  static const plan = AgentToolDataClass._(r'plan');

  /// List of all possible values in this [enum][AgentToolDataClass].
  static const values = <AgentToolDataClass>[
    metadata,
    previews,
    originals,
    plan,
  ];

  static AgentToolDataClass? fromJson(dynamic value) => AgentToolDataClassTypeTransformer().decode(value);

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

  String encode(AgentToolDataClass data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentToolDataClass.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentToolDataClass? decode(dynamic data, {bool allowNull = true}) {
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

  /// Singleton [AgentToolDataClassTypeTransformer] instance.
  static AgentToolDataClassTypeTransformer? _instance;
}


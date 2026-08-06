//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Signed adjustment level
class TonalLevel {
  /// Instantiate a new enum with the provided [value].
  const TonalLevel._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const strongDecrease = TonalLevel._(r'strong_decrease');
  static const moderateDecrease = TonalLevel._(r'moderate_decrease');
  static const slightDecrease = TonalLevel._(r'slight_decrease');
  static const slightIncrease = TonalLevel._(r'slight_increase');
  static const moderateIncrease = TonalLevel._(r'moderate_increase');
  static const strongIncrease = TonalLevel._(r'strong_increase');

  /// List of all possible values in this [enum][TonalLevel].
  static const values = <TonalLevel>[
    strongDecrease,
    moderateDecrease,
    slightDecrease,
    slightIncrease,
    moderateIncrease,
    strongIncrease,
  ];

  static TonalLevel? fromJson(dynamic value) => TonalLevelTypeTransformer().decode(value);

  static List<TonalLevel> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TonalLevel>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TonalLevel.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [TonalLevel] to String,
/// and [decode] dynamic data back to [TonalLevel].
class TonalLevelTypeTransformer {
  factory TonalLevelTypeTransformer() => _instance ??= const TonalLevelTypeTransformer._();

  const TonalLevelTypeTransformer._();

  String encode(TonalLevel data) => data.value;

  /// Decodes a [dynamic value][data] to a TonalLevel.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  TonalLevel? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'strong_decrease': return TonalLevel.strongDecrease;
        case r'moderate_decrease': return TonalLevel.moderateDecrease;
        case r'slight_decrease': return TonalLevel.slightDecrease;
        case r'slight_increase': return TonalLevel.slightIncrease;
        case r'moderate_increase': return TonalLevel.moderateIncrease;
        case r'strong_increase': return TonalLevel.strongIncrease;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [TonalLevelTypeTransformer] instance.
  static TonalLevelTypeTransformer? _instance;
}


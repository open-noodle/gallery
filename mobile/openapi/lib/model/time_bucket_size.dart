//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Timeline bucket granularity
class TimeBucketSize {
  /// Instantiate a new enum with the provided [value].
  const TimeBucketSize._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const year = TimeBucketSize._(r'year');
  static const month = TimeBucketSize._(r'month');
  static const day = TimeBucketSize._(r'day');

  /// List of all possible values in this [enum][TimeBucketSize].
  static const values = <TimeBucketSize>[
    year,
    month,
    day,
  ];

  static TimeBucketSize? fromJson(dynamic value) => TimeBucketSizeTypeTransformer().decode(value);

  static List<TimeBucketSize> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimeBucketSize>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimeBucketSize.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [TimeBucketSize] to String,
/// and [decode] dynamic data back to [TimeBucketSize].
class TimeBucketSizeTypeTransformer {
  factory TimeBucketSizeTypeTransformer() => _instance ??= const TimeBucketSizeTypeTransformer._();

  const TimeBucketSizeTypeTransformer._();

  String encode(TimeBucketSize data) => data.value;

  /// Decodes a [dynamic value][data] to a TimeBucketSize.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  TimeBucketSize? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'year': return TimeBucketSize.year;
        case r'month': return TimeBucketSize.month;
        case r'day': return TimeBucketSize.day;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [TimeBucketSizeTypeTransformer] instance.
  static TimeBucketSizeTypeTransformer? _instance;
}


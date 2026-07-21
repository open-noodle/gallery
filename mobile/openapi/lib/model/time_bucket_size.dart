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
enum TimeBucketSize {
  year._(r'year'),
  month._(r'month'),
  day._(r'day'),
  ;

  /// Instantiate a new enum with the provided value.
  const TimeBucketSize._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [TimeBucketSize] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static TimeBucketSize? fromJson(dynamic value) => TimeBucketSizeTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [TimeBucketSize]
  /// that were successfully decoded from the passed [JSON][json].
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

  /// Encodes this enum as a value suitable for JSON.
  String encode(TimeBucketSize data) => data._value;

  /// Returns the instance of [TimeBucketSize] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  TimeBucketSize? decode(dynamic data, {bool allowNull = true}) {
    if (data is TimeBucketSize) {
      return data;
    }
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

  /// The singleton instance of this transformer.
  static TimeBucketSizeTypeTransformer? _instance;
}


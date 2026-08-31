//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum FamilyAccessLevel {
  none._(r'none'),
  view._(r'view'),
  contribute._(r'contribute'),
  ;

  /// Instantiate a new enum with the provided value.
  const FamilyAccessLevel._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [FamilyAccessLevel] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static FamilyAccessLevel? fromJson(dynamic value) => FamilyAccessLevelTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [FamilyAccessLevel]
  /// that were successfully decoded from the passed [JSON][json].
  static List<FamilyAccessLevel> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyAccessLevel>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyAccessLevel.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [FamilyAccessLevel] to String,
/// and [decode] dynamic data back to [FamilyAccessLevel].
class FamilyAccessLevelTypeTransformer {
  factory FamilyAccessLevelTypeTransformer() => _instance ??= const FamilyAccessLevelTypeTransformer._();

  const FamilyAccessLevelTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(FamilyAccessLevel data) => data._value;

  /// Returns the instance of [FamilyAccessLevel] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  FamilyAccessLevel? decode(dynamic data, {bool allowNull = true}) {
    if (data is FamilyAccessLevel) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'none': return FamilyAccessLevel.none;
        case r'view': return FamilyAccessLevel.view;
        case r'contribute': return FamilyAccessLevel.contribute;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static FamilyAccessLevelTypeTransformer? _instance;
}


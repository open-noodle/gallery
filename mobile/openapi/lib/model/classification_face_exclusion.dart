//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Face exclusion rule for this classification category
enum ClassificationFaceExclusion {
  off._(r'off'),
  anyAssignedFace._(r'any_assigned_face'),
  namedPeople._(r'named_people'),
  namedVisiblePeople._(r'named_visible_people'),
  ;

  /// Instantiate a new enum with the provided value.
  const ClassificationFaceExclusion._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [ClassificationFaceExclusion] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static ClassificationFaceExclusion? fromJson(dynamic value) => ClassificationFaceExclusionTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [ClassificationFaceExclusion]
  /// that were successfully decoded from the passed [JSON][json].
  static List<ClassificationFaceExclusion> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ClassificationFaceExclusion>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ClassificationFaceExclusion.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ClassificationFaceExclusion] to String,
/// and [decode] dynamic data back to [ClassificationFaceExclusion].
class ClassificationFaceExclusionTypeTransformer {
  factory ClassificationFaceExclusionTypeTransformer() => _instance ??= const ClassificationFaceExclusionTypeTransformer._();

  const ClassificationFaceExclusionTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(ClassificationFaceExclusion data) => data._value;

  /// Returns the instance of [ClassificationFaceExclusion] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ClassificationFaceExclusion? decode(dynamic data, {bool allowNull = true}) {
    if (data is ClassificationFaceExclusion) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'off': return ClassificationFaceExclusion.off;
        case r'any_assigned_face': return ClassificationFaceExclusion.anyAssignedFace;
        case r'named_people': return ClassificationFaceExclusion.namedPeople;
        case r'named_visible_people': return ClassificationFaceExclusion.namedVisiblePeople;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static ClassificationFaceExclusionTypeTransformer? _instance;
}


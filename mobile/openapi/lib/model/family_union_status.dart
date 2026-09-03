//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum FamilyUnionStatus {
  married._(r'married'),
  partnered._(r'partnered'),
  separated._(r'separated'),
  divorced._(r'divorced'),
  widowed._(r'widowed'),
  ;

  /// Instantiate a new enum with the provided value.
  const FamilyUnionStatus._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [FamilyUnionStatus] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static FamilyUnionStatus? fromJson(dynamic value) => FamilyUnionStatusTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [FamilyUnionStatus]
  /// that were successfully decoded from the passed [JSON][json].
  static List<FamilyUnionStatus> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyUnionStatus>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyUnionStatus.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [FamilyUnionStatus] to String,
/// and [decode] dynamic data back to [FamilyUnionStatus].
class FamilyUnionStatusTypeTransformer {
  factory FamilyUnionStatusTypeTransformer() => _instance ??= const FamilyUnionStatusTypeTransformer._();

  const FamilyUnionStatusTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(FamilyUnionStatus data) => data._value;

  /// Returns the instance of [FamilyUnionStatus] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  FamilyUnionStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data is FamilyUnionStatus) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'married': return FamilyUnionStatus.married;
        case r'partnered': return FamilyUnionStatus.partnered;
        case r'separated': return FamilyUnionStatus.separated;
        case r'divorced': return FamilyUnionStatus.divorced;
        case r'widowed': return FamilyUnionStatus.widowed;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static FamilyUnionStatusTypeTransformer? _instance;
}


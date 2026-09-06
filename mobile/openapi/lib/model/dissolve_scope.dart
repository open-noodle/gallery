//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Which faces a dissolve touches
enum DissolveScope {
  all._(r'all'),
  exif._(r'exif'),
  machineLearning._(r'machine-learning'),
  withoutEmbedding._(r'without-embedding'),
  ;

  /// Instantiate a new enum with the provided value.
  const DissolveScope._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [DissolveScope] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static DissolveScope? fromJson(dynamic value) => DissolveScopeTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [DissolveScope]
  /// that were successfully decoded from the passed [JSON][json].
  static List<DissolveScope> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <DissolveScope>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = DissolveScope.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [DissolveScope] to String,
/// and [decode] dynamic data back to [DissolveScope].
class DissolveScopeTypeTransformer {
  factory DissolveScopeTypeTransformer() => _instance ??= const DissolveScopeTypeTransformer._();

  const DissolveScopeTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(DissolveScope data) => data._value;

  /// Returns the instance of [DissolveScope] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  DissolveScope? decode(dynamic data, {bool allowNull = true}) {
    if (data is DissolveScope) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'all': return DissolveScope.all;
        case r'exif': return DissolveScope.exif;
        case r'machine-learning': return DissolveScope.machineLearning;
        case r'without-embedding': return DissolveScope.withoutEmbedding;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static DissolveScopeTypeTransformer? _instance;
}


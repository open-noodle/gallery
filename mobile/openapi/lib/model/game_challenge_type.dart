//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum GameChallengeType {
  mixed._(r'mixed'),
  location._(r'location'),
  date._(r'date'),
  ;

  /// Instantiate a new enum with the provided value.
  const GameChallengeType._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [GameChallengeType] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static GameChallengeType? fromJson(dynamic value) => GameChallengeTypeTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [GameChallengeType]
  /// that were successfully decoded from the passed [JSON][json].
  static List<GameChallengeType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameChallengeType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameChallengeType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [GameChallengeType] to String,
/// and [decode] dynamic data back to [GameChallengeType].
class GameChallengeTypeTypeTransformer {
  factory GameChallengeTypeTypeTransformer() => _instance ??= const GameChallengeTypeTypeTransformer._();

  const GameChallengeTypeTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(GameChallengeType data) => data._value;

  /// Returns the instance of [GameChallengeType] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  GameChallengeType? decode(dynamic data, {bool allowNull = true}) {
    if (data is GameChallengeType) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'mixed': return GameChallengeType.mixed;
        case r'location': return GameChallengeType.location;
        case r'date': return GameChallengeType.date;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static GameChallengeTypeTypeTransformer? _instance;
}


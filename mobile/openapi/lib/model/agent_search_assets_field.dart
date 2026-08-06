//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentSearchAssetsField {
  type._(r'type'),
  dates._(r'dates'),
  location._(r'location'),
  camera._(r'camera'),
  tags._(r'tags'),
  rating._(r'rating'),
  filename._(r'filename'),
  favorite._(r'favorite'),
  visibility._(r'visibility'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentSearchAssetsField._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentSearchAssetsField] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentSearchAssetsField? fromJson(dynamic value) => AgentSearchAssetsFieldTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentSearchAssetsField]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentSearchAssetsField> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsField>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsField.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetsField] to String,
/// and [decode] dynamic data back to [AgentSearchAssetsField].
class AgentSearchAssetsFieldTypeTransformer {
  factory AgentSearchAssetsFieldTypeTransformer() => _instance ??= const AgentSearchAssetsFieldTypeTransformer._();

  const AgentSearchAssetsFieldTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentSearchAssetsField data) => data._value;

  /// Returns the instance of [AgentSearchAssetsField] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetsField? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentSearchAssetsField) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'type': return AgentSearchAssetsField.type;
        case r'dates': return AgentSearchAssetsField.dates;
        case r'location': return AgentSearchAssetsField.location;
        case r'camera': return AgentSearchAssetsField.camera;
        case r'tags': return AgentSearchAssetsField.tags;
        case r'rating': return AgentSearchAssetsField.rating;
        case r'filename': return AgentSearchAssetsField.filename;
        case r'favorite': return AgentSearchAssetsField.favorite;
        case r'visibility': return AgentSearchAssetsField.visibility;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentSearchAssetsFieldTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentAssetMetadataField {
  type._(r'type'),
  dates._(r'dates'),
  location._(r'location'),
  camera._(r'camera'),
  tags._(r'tags'),
  rating._(r'rating'),
  filename._(r'filename'),
  favorite._(r'favorite'),
  visibility._(r'visibility'),
  quality._(r'quality'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentAssetMetadataField._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentAssetMetadataField] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentAssetMetadataField? fromJson(dynamic value) => AgentAssetMetadataFieldTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentAssetMetadataField]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentAssetMetadataField> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetMetadataField>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetMetadataField.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetMetadataField] to String,
/// and [decode] dynamic data back to [AgentAssetMetadataField].
class AgentAssetMetadataFieldTypeTransformer {
  factory AgentAssetMetadataFieldTypeTransformer() => _instance ??= const AgentAssetMetadataFieldTypeTransformer._();

  const AgentAssetMetadataFieldTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentAssetMetadataField data) => data._value;

  /// Returns the instance of [AgentAssetMetadataField] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetMetadataField? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentAssetMetadataField) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'type': return AgentAssetMetadataField.type;
        case r'dates': return AgentAssetMetadataField.dates;
        case r'location': return AgentAssetMetadataField.location;
        case r'camera': return AgentAssetMetadataField.camera;
        case r'tags': return AgentAssetMetadataField.tags;
        case r'rating': return AgentAssetMetadataField.rating;
        case r'filename': return AgentAssetMetadataField.filename;
        case r'favorite': return AgentAssetMetadataField.favorite;
        case r'visibility': return AgentAssetMetadataField.visibility;
        case r'quality': return AgentAssetMetadataField.quality;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentAssetMetadataFieldTypeTransformer? _instance;
}


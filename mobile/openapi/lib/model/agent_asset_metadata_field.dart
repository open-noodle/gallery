//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetMetadataField {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetMetadataField._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const type = AgentAssetMetadataField._(r'type');
  static const dates = AgentAssetMetadataField._(r'dates');
  static const location = AgentAssetMetadataField._(r'location');
  static const camera = AgentAssetMetadataField._(r'camera');
  static const tags = AgentAssetMetadataField._(r'tags');
  static const rating = AgentAssetMetadataField._(r'rating');
  static const filename = AgentAssetMetadataField._(r'filename');
  static const favorite = AgentAssetMetadataField._(r'favorite');
  static const visibility = AgentAssetMetadataField._(r'visibility');
  static const quality = AgentAssetMetadataField._(r'quality');

  /// List of all possible values in this [enum][AgentAssetMetadataField].
  static const values = <AgentAssetMetadataField>[
    type,
    dates,
    location,
    camera,
    tags,
    rating,
    filename,
    favorite,
    visibility,
    quality,
  ];

  static AgentAssetMetadataField? fromJson(dynamic value) => AgentAssetMetadataFieldTypeTransformer().decode(value);

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

  String encode(AgentAssetMetadataField data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetMetadataField.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetMetadataField? decode(dynamic data, {bool allowNull = true}) {
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

  /// Singleton [AgentAssetMetadataFieldTypeTransformer] instance.
  static AgentAssetMetadataFieldTypeTransformer? _instance;
}


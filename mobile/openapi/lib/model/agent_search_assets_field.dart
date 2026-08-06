//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSearchAssetsField {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetsField._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const type = AgentSearchAssetsField._(r'type');
  static const dates = AgentSearchAssetsField._(r'dates');
  static const location = AgentSearchAssetsField._(r'location');
  static const camera = AgentSearchAssetsField._(r'camera');
  static const tags = AgentSearchAssetsField._(r'tags');
  static const rating = AgentSearchAssetsField._(r'rating');
  static const filename = AgentSearchAssetsField._(r'filename');
  static const favorite = AgentSearchAssetsField._(r'favorite');
  static const visibility = AgentSearchAssetsField._(r'visibility');

  /// List of all possible values in this [enum][AgentSearchAssetsField].
  static const values = <AgentSearchAssetsField>[
    type,
    dates,
    location,
    camera,
    tags,
    rating,
    filename,
    favorite,
    visibility,
  ];

  static AgentSearchAssetsField? fromJson(dynamic value) => AgentSearchAssetsFieldTypeTransformer().decode(value);

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

  String encode(AgentSearchAssetsField data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetsField.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetsField? decode(dynamic data, {bool allowNull = true}) {
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

  /// Singleton [AgentSearchAssetsFieldTypeTransformer] instance.
  static AgentSearchAssetsFieldTypeTransformer? _instance;
}


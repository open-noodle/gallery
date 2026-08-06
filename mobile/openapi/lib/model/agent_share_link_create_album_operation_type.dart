//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentShareLinkCreateAlbumOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentShareLinkCreateAlbumOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const shareLinkPeriodCreateAlbum = AgentShareLinkCreateAlbumOperationType._(r'shareLink.createAlbum');

  /// List of all possible values in this [enum][AgentShareLinkCreateAlbumOperationType].
  static const values = <AgentShareLinkCreateAlbumOperationType>[
    shareLinkPeriodCreateAlbum,
  ];

  static AgentShareLinkCreateAlbumOperationType? fromJson(dynamic value) => AgentShareLinkCreateAlbumOperationTypeTypeTransformer().decode(value);

  static List<AgentShareLinkCreateAlbumOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentShareLinkCreateAlbumOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentShareLinkCreateAlbumOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentShareLinkCreateAlbumOperationType] to String,
/// and [decode] dynamic data back to [AgentShareLinkCreateAlbumOperationType].
class AgentShareLinkCreateAlbumOperationTypeTypeTransformer {
  factory AgentShareLinkCreateAlbumOperationTypeTypeTransformer() => _instance ??= const AgentShareLinkCreateAlbumOperationTypeTypeTransformer._();

  const AgentShareLinkCreateAlbumOperationTypeTypeTransformer._();

  String encode(AgentShareLinkCreateAlbumOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentShareLinkCreateAlbumOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentShareLinkCreateAlbumOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'shareLink.createAlbum': return AgentShareLinkCreateAlbumOperationType.shareLinkPeriodCreateAlbum;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentShareLinkCreateAlbumOperationTypeTypeTransformer] instance.
  static AgentShareLinkCreateAlbumOperationTypeTypeTransformer? _instance;
}


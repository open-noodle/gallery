//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationNewAlbumTargetKind {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationNewAlbumTargetKind._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const newAlbum = AgentOperationNewAlbumTargetKind._(r'new_album');

  /// List of all possible values in this [enum][AgentOperationNewAlbumTargetKind].
  static const values = <AgentOperationNewAlbumTargetKind>[
    newAlbum,
  ];

  static AgentOperationNewAlbumTargetKind? fromJson(dynamic value) => AgentOperationNewAlbumTargetKindTypeTransformer().decode(value);

  static List<AgentOperationNewAlbumTargetKind> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationNewAlbumTargetKind>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationNewAlbumTargetKind.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationNewAlbumTargetKind] to String,
/// and [decode] dynamic data back to [AgentOperationNewAlbumTargetKind].
class AgentOperationNewAlbumTargetKindTypeTransformer {
  factory AgentOperationNewAlbumTargetKindTypeTransformer() => _instance ??= const AgentOperationNewAlbumTargetKindTypeTransformer._();

  const AgentOperationNewAlbumTargetKindTypeTransformer._();

  String encode(AgentOperationNewAlbumTargetKind data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationNewAlbumTargetKind.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationNewAlbumTargetKind? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'new_album': return AgentOperationNewAlbumTargetKind.newAlbum;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationNewAlbumTargetKindTypeTransformer] instance.
  static AgentOperationNewAlbumTargetKindTypeTransformer? _instance;
}


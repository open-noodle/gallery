//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationExistingAlbumTargetKind {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationExistingAlbumTargetKind._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const existingAlbum = AgentOperationExistingAlbumTargetKind._(r'existing_album');

  /// List of all possible values in this [enum][AgentOperationExistingAlbumTargetKind].
  static const values = <AgentOperationExistingAlbumTargetKind>[
    existingAlbum,
  ];

  static AgentOperationExistingAlbumTargetKind? fromJson(dynamic value) => AgentOperationExistingAlbumTargetKindTypeTransformer().decode(value);

  static List<AgentOperationExistingAlbumTargetKind> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationExistingAlbumTargetKind>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationExistingAlbumTargetKind.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationExistingAlbumTargetKind] to String,
/// and [decode] dynamic data back to [AgentOperationExistingAlbumTargetKind].
class AgentOperationExistingAlbumTargetKindTypeTransformer {
  factory AgentOperationExistingAlbumTargetKindTypeTransformer() => _instance ??= const AgentOperationExistingAlbumTargetKindTypeTransformer._();

  const AgentOperationExistingAlbumTargetKindTypeTransformer._();

  String encode(AgentOperationExistingAlbumTargetKind data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationExistingAlbumTargetKind.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationExistingAlbumTargetKind? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'existing_album': return AgentOperationExistingAlbumTargetKind.existingAlbum;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationExistingAlbumTargetKindTypeTransformer] instance.
  static AgentOperationExistingAlbumTargetKindTypeTransformer? _instance;
}


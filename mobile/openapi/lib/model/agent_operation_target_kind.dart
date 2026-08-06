//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentOperationTargetKind {
  newAlbum._(r'new_album'),
  existingAlbum._(r'existing_album'),
  newSpace._(r'new_space'),
  existingSpace._(r'existing_space'),
  assetBatch._(r'asset_batch'),
  imageEditBatch._(r'image_edit_batch'),
  person._(r'person'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentOperationTargetKind._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentOperationTargetKind] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentOperationTargetKind? fromJson(dynamic value) => AgentOperationTargetKindTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentOperationTargetKind]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentOperationTargetKind> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationTargetKind>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationTargetKind.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationTargetKind] to String,
/// and [decode] dynamic data back to [AgentOperationTargetKind].
class AgentOperationTargetKindTypeTransformer {
  factory AgentOperationTargetKindTypeTransformer() => _instance ??= const AgentOperationTargetKindTypeTransformer._();

  const AgentOperationTargetKindTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentOperationTargetKind data) => data._value;

  /// Returns the instance of [AgentOperationTargetKind] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationTargetKind? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentOperationTargetKind) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'new_album': return AgentOperationTargetKind.newAlbum;
        case r'existing_album': return AgentOperationTargetKind.existingAlbum;
        case r'new_space': return AgentOperationTargetKind.newSpace;
        case r'existing_space': return AgentOperationTargetKind.existingSpace;
        case r'asset_batch': return AgentOperationTargetKind.assetBatch;
        case r'image_edit_batch': return AgentOperationTargetKind.imageEditBatch;
        case r'person': return AgentOperationTargetKind.person;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentOperationTargetKindTypeTransformer? _instance;
}


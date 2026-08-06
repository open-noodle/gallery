//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentOperationItemKind {
  asset._(r'asset'),
  album._(r'album'),
  space._(r'space'),
  person._(r'person'),
  tag._(r'tag'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentOperationItemKind._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentOperationItemKind] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentOperationItemKind? fromJson(dynamic value) => AgentOperationItemKindTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentOperationItemKind]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentOperationItemKind> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemKind>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemKind.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationItemKind] to String,
/// and [decode] dynamic data back to [AgentOperationItemKind].
class AgentOperationItemKindTypeTransformer {
  factory AgentOperationItemKindTypeTransformer() => _instance ??= const AgentOperationItemKindTypeTransformer._();

  const AgentOperationItemKindTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentOperationItemKind data) => data._value;

  /// Returns the instance of [AgentOperationItemKind] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationItemKind? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentOperationItemKind) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'asset': return AgentOperationItemKind.asset;
        case r'album': return AgentOperationItemKind.album;
        case r'space': return AgentOperationItemKind.space;
        case r'person': return AgentOperationItemKind.person;
        case r'tag': return AgentOperationItemKind.tag;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentOperationItemKindTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationItemKind {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationItemKind._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const asset = AgentOperationItemKind._(r'asset');
  static const album = AgentOperationItemKind._(r'album');
  static const space = AgentOperationItemKind._(r'space');
  static const person = AgentOperationItemKind._(r'person');
  static const tag = AgentOperationItemKind._(r'tag');

  /// List of all possible values in this [enum][AgentOperationItemKind].
  static const values = <AgentOperationItemKind>[
    asset,
    album,
    space,
    person,
    tag,
  ];

  static AgentOperationItemKind? fromJson(dynamic value) => AgentOperationItemKindTypeTransformer().decode(value);

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

  String encode(AgentOperationItemKind data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationItemKind.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationItemKind? decode(dynamic data, {bool allowNull = true}) {
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

  /// Singleton [AgentOperationItemKindTypeTransformer] instance.
  static AgentOperationItemKindTypeTransformer? _instance;
}


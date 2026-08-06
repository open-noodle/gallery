//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSearchAssetsDetail {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetsDetail._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const handle = AgentSearchAssetsDetail._(r'handle');
  static const summary = AgentSearchAssetsDetail._(r'summary');
  static const metadata = AgentSearchAssetsDetail._(r'metadata');

  /// List of all possible values in this [enum][AgentSearchAssetsDetail].
  static const values = <AgentSearchAssetsDetail>[
    handle,
    summary,
    metadata,
  ];

  static AgentSearchAssetsDetail? fromJson(dynamic value) => AgentSearchAssetsDetailTypeTransformer().decode(value);

  static List<AgentSearchAssetsDetail> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsDetail>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsDetail.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetsDetail] to String,
/// and [decode] dynamic data back to [AgentSearchAssetsDetail].
class AgentSearchAssetsDetailTypeTransformer {
  factory AgentSearchAssetsDetailTypeTransformer() => _instance ??= const AgentSearchAssetsDetailTypeTransformer._();

  const AgentSearchAssetsDetailTypeTransformer._();

  String encode(AgentSearchAssetsDetail data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetsDetail.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetsDetail? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'handle': return AgentSearchAssetsDetail.handle;
        case r'summary': return AgentSearchAssetsDetail.summary;
        case r'metadata': return AgentSearchAssetsDetail.metadata;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetsDetailTypeTransformer] instance.
  static AgentSearchAssetsDetailTypeTransformer? _instance;
}


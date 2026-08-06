//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentSearchAssetsRequestDetail {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetsRequestDetail._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const ids = AgentSearchAssetsRequestDetail._(r'ids');
  static const handle = AgentSearchAssetsRequestDetail._(r'handle');
  static const summary = AgentSearchAssetsRequestDetail._(r'summary');
  static const metadata = AgentSearchAssetsRequestDetail._(r'metadata');

  /// List of all possible values in this [enum][AgentSearchAssetsRequestDetail].
  static const values = <AgentSearchAssetsRequestDetail>[
    ids,
    handle,
    summary,
    metadata,
  ];

  static AgentSearchAssetsRequestDetail? fromJson(dynamic value) => AgentSearchAssetsRequestDetailTypeTransformer().decode(value);

  static List<AgentSearchAssetsRequestDetail> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsRequestDetail>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsRequestDetail.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetsRequestDetail] to String,
/// and [decode] dynamic data back to [AgentSearchAssetsRequestDetail].
class AgentSearchAssetsRequestDetailTypeTransformer {
  factory AgentSearchAssetsRequestDetailTypeTransformer() => _instance ??= const AgentSearchAssetsRequestDetailTypeTransformer._();

  const AgentSearchAssetsRequestDetailTypeTransformer._();

  String encode(AgentSearchAssetsRequestDetail data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetsRequestDetail.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetsRequestDetail? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'ids': return AgentSearchAssetsRequestDetail.ids;
        case r'handle': return AgentSearchAssetsRequestDetail.handle;
        case r'summary': return AgentSearchAssetsRequestDetail.summary;
        case r'metadata': return AgentSearchAssetsRequestDetail.metadata;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetsRequestDetailTypeTransformer] instance.
  static AgentSearchAssetsRequestDetailTypeTransformer? _instance;
}


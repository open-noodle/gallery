//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentSearchAssetsRequestDetail {
  ids._(r'ids'),
  handle._(r'handle'),
  summary._(r'summary'),
  metadata._(r'metadata'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentSearchAssetsRequestDetail._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentSearchAssetsRequestDetail] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentSearchAssetsRequestDetail? fromJson(dynamic value) => AgentSearchAssetsRequestDetailTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentSearchAssetsRequestDetail]
  /// that were successfully decoded from the passed [JSON][json].
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

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentSearchAssetsRequestDetail data) => data._value;

  /// Returns the instance of [AgentSearchAssetsRequestDetail] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetsRequestDetail? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentSearchAssetsRequestDetail) {
      return data;
    }
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

  /// The singleton instance of this transformer.
  static AgentSearchAssetsRequestDetailTypeTransformer? _instance;
}


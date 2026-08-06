//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentAssetMetadataDetail {
  basic._(r'basic'),
  descriptive._(r'descriptive'),
  technical._(r'technical'),
  allSafe._(r'allSafe'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentAssetMetadataDetail._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentAssetMetadataDetail] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentAssetMetadataDetail? fromJson(dynamic value) => AgentAssetMetadataDetailTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentAssetMetadataDetail]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentAssetMetadataDetail> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetMetadataDetail>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetMetadataDetail.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetMetadataDetail] to String,
/// and [decode] dynamic data back to [AgentAssetMetadataDetail].
class AgentAssetMetadataDetailTypeTransformer {
  factory AgentAssetMetadataDetailTypeTransformer() => _instance ??= const AgentAssetMetadataDetailTypeTransformer._();

  const AgentAssetMetadataDetailTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentAssetMetadataDetail data) => data._value;

  /// Returns the instance of [AgentAssetMetadataDetail] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetMetadataDetail? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentAssetMetadataDetail) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'basic': return AgentAssetMetadataDetail.basic;
        case r'descriptive': return AgentAssetMetadataDetail.descriptive;
        case r'technical': return AgentAssetMetadataDetail.technical;
        case r'allSafe': return AgentAssetMetadataDetail.allSafe;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentAssetMetadataDetailTypeTransformer? _instance;
}


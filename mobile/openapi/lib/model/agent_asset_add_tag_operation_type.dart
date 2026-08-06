//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentAssetAddTagOperationType {
  assetPeriodAddTag._(r'asset.addTag'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentAssetAddTagOperationType._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentAssetAddTagOperationType] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentAssetAddTagOperationType? fromJson(dynamic value) => AgentAssetAddTagOperationTypeTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentAssetAddTagOperationType]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentAssetAddTagOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetAddTagOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetAddTagOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetAddTagOperationType] to String,
/// and [decode] dynamic data back to [AgentAssetAddTagOperationType].
class AgentAssetAddTagOperationTypeTypeTransformer {
  factory AgentAssetAddTagOperationTypeTypeTransformer() => _instance ??= const AgentAssetAddTagOperationTypeTypeTransformer._();

  const AgentAssetAddTagOperationTypeTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentAssetAddTagOperationType data) => data._value;

  /// Returns the instance of [AgentAssetAddTagOperationType] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetAddTagOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentAssetAddTagOperationType) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'asset.addTag': return AgentAssetAddTagOperationType.assetPeriodAddTag;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentAssetAddTagOperationTypeTypeTransformer? _instance;
}


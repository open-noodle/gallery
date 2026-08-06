//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentOperationReviewMetadataValueKind {
  known._(r'known'),
  empty._(r'empty'),
  clear._(r'clear'),
  relative._(r'relative'),
  unknown._(r'unknown'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentOperationReviewMetadataValueKind._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentOperationReviewMetadataValueKind] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentOperationReviewMetadataValueKind? fromJson(dynamic value) => AgentOperationReviewMetadataValueKindTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentOperationReviewMetadataValueKind]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentOperationReviewMetadataValueKind> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationReviewMetadataValueKind>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationReviewMetadataValueKind.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationReviewMetadataValueKind] to String,
/// and [decode] dynamic data back to [AgentOperationReviewMetadataValueKind].
class AgentOperationReviewMetadataValueKindTypeTransformer {
  factory AgentOperationReviewMetadataValueKindTypeTransformer() => _instance ??= const AgentOperationReviewMetadataValueKindTypeTransformer._();

  const AgentOperationReviewMetadataValueKindTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentOperationReviewMetadataValueKind data) => data._value;

  /// Returns the instance of [AgentOperationReviewMetadataValueKind] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationReviewMetadataValueKind? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentOperationReviewMetadataValueKind) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'known': return AgentOperationReviewMetadataValueKind.known;
        case r'empty': return AgentOperationReviewMetadataValueKind.empty;
        case r'clear': return AgentOperationReviewMetadataValueKind.clear;
        case r'relative': return AgentOperationReviewMetadataValueKind.relative;
        case r'unknown': return AgentOperationReviewMetadataValueKind.unknown;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentOperationReviewMetadataValueKindTypeTransformer? _instance;
}


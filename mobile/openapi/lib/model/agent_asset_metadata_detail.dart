//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentAssetMetadataDetail {
  /// Instantiate a new enum with the provided [value].
  const AgentAssetMetadataDetail._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const basic = AgentAssetMetadataDetail._(r'basic');
  static const descriptive = AgentAssetMetadataDetail._(r'descriptive');
  static const technical = AgentAssetMetadataDetail._(r'technical');
  static const allSafe = AgentAssetMetadataDetail._(r'allSafe');

  /// List of all possible values in this [enum][AgentAssetMetadataDetail].
  static const values = <AgentAssetMetadataDetail>[
    basic,
    descriptive,
    technical,
    allSafe,
  ];

  static AgentAssetMetadataDetail? fromJson(dynamic value) => AgentAssetMetadataDetailTypeTransformer().decode(value);

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

  String encode(AgentAssetMetadataDetail data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentAssetMetadataDetail.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetMetadataDetail? decode(dynamic data, {bool allowNull = true}) {
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

  /// Singleton [AgentAssetMetadataDetailTypeTransformer] instance.
  static AgentAssetMetadataDetailTypeTransformer? _instance;
}


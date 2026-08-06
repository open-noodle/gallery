//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentExplicitAssetsAssetSourceInput {
  /// Returns a new [AgentExplicitAssetsAssetSourceInput] instance.
  AgentExplicitAssetsAssetSourceInput({
    this.assetIds = const [],
    required this.kind,
  });

  List<String> assetIds;

  AgentExplicitAssetsAssetSourceInputKindEnum kind;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentExplicitAssetsAssetSourceInput &&
    _deepEquality.equals(other.assetIds, assetIds) &&
    other.kind == kind;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetIds.hashCode) +
    (kind.hashCode);

  @override
  String toString() => 'AgentExplicitAssetsAssetSourceInput[assetIds=$assetIds, kind=$kind]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetIds'] = this.assetIds;
      json[r'kind'] = this.kind;
    return json;
  }

  /// Returns a new [AgentExplicitAssetsAssetSourceInput] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentExplicitAssetsAssetSourceInput? fromJson(dynamic value) {
    upgradeDto(value, "AgentExplicitAssetsAssetSourceInput");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentExplicitAssetsAssetSourceInput(
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        kind: AgentExplicitAssetsAssetSourceInputKindEnum.fromJson(json[r'kind'])!,
      );
    }
    return null;
  }

  static List<AgentExplicitAssetsAssetSourceInput> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentExplicitAssetsAssetSourceInput>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentExplicitAssetsAssetSourceInput.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentExplicitAssetsAssetSourceInput> mapFromJson(dynamic json) {
    final map = <String, AgentExplicitAssetsAssetSourceInput>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentExplicitAssetsAssetSourceInput.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentExplicitAssetsAssetSourceInput-objects as value to a dart map
  static Map<String, List<AgentExplicitAssetsAssetSourceInput>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentExplicitAssetsAssetSourceInput>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentExplicitAssetsAssetSourceInput.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetIds',
    'kind',
  };
}


class AgentExplicitAssetsAssetSourceInputKindEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentExplicitAssetsAssetSourceInputKindEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const explicitAssets = AgentExplicitAssetsAssetSourceInputKindEnum._(r'explicitAssets');

  /// List of all possible values in this [enum][AgentExplicitAssetsAssetSourceInputKindEnum].
  static const values = <AgentExplicitAssetsAssetSourceInputKindEnum>[
    explicitAssets,
  ];

  static AgentExplicitAssetsAssetSourceInputKindEnum? fromJson(dynamic value) => AgentExplicitAssetsAssetSourceInputKindEnumTypeTransformer().decode(value);

  static List<AgentExplicitAssetsAssetSourceInputKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentExplicitAssetsAssetSourceInputKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentExplicitAssetsAssetSourceInputKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentExplicitAssetsAssetSourceInputKindEnum] to String,
/// and [decode] dynamic data back to [AgentExplicitAssetsAssetSourceInputKindEnum].
class AgentExplicitAssetsAssetSourceInputKindEnumTypeTransformer {
  factory AgentExplicitAssetsAssetSourceInputKindEnumTypeTransformer() => _instance ??= const AgentExplicitAssetsAssetSourceInputKindEnumTypeTransformer._();

  const AgentExplicitAssetsAssetSourceInputKindEnumTypeTransformer._();

  String encode(AgentExplicitAssetsAssetSourceInputKindEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentExplicitAssetsAssetSourceInputKindEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentExplicitAssetsAssetSourceInputKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'explicitAssets': return AgentExplicitAssetsAssetSourceInputKindEnum.explicitAssets;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentExplicitAssetsAssetSourceInputKindEnumTypeTransformer] instance.
  static AgentExplicitAssetsAssetSourceInputKindEnumTypeTransformer? _instance;
}



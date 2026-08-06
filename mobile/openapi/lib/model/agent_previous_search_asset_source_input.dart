//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentPreviousSearchAssetSourceInput {
  /// Returns a new [AgentPreviousSearchAssetSourceInput] instance.
  AgentPreviousSearchAssetSourceInput({
    required this.kind,
    required this.sourceRef,
  });

  AgentPreviousSearchAssetSourceInputKindEnum kind;

  String sourceRef;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentPreviousSearchAssetSourceInput &&
    other.kind == kind &&
    other.sourceRef == sourceRef;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (kind.hashCode) +
    (sourceRef.hashCode);

  @override
  String toString() => 'AgentPreviousSearchAssetSourceInput[kind=$kind, sourceRef=$sourceRef]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'kind'] = this.kind;
      json[r'sourceRef'] = this.sourceRef;
    return json;
  }

  /// Returns a new [AgentPreviousSearchAssetSourceInput] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentPreviousSearchAssetSourceInput? fromJson(dynamic value) {
    upgradeDto(value, "AgentPreviousSearchAssetSourceInput");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentPreviousSearchAssetSourceInput(
        kind: AgentPreviousSearchAssetSourceInputKindEnum.fromJson(json[r'kind'])!,
        sourceRef: mapValueOfType<String>(json, r'sourceRef')!,
      );
    }
    return null;
  }

  static List<AgentPreviousSearchAssetSourceInput> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentPreviousSearchAssetSourceInput>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentPreviousSearchAssetSourceInput.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentPreviousSearchAssetSourceInput> mapFromJson(dynamic json) {
    final map = <String, AgentPreviousSearchAssetSourceInput>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentPreviousSearchAssetSourceInput.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentPreviousSearchAssetSourceInput-objects as value to a dart map
  static Map<String, List<AgentPreviousSearchAssetSourceInput>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentPreviousSearchAssetSourceInput>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentPreviousSearchAssetSourceInput.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'kind',
    'sourceRef',
  };
}


class AgentPreviousSearchAssetSourceInputKindEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentPreviousSearchAssetSourceInputKindEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const previousSearch = AgentPreviousSearchAssetSourceInputKindEnum._(r'previousSearch');

  /// List of all possible values in this [enum][AgentPreviousSearchAssetSourceInputKindEnum].
  static const values = <AgentPreviousSearchAssetSourceInputKindEnum>[
    previousSearch,
  ];

  static AgentPreviousSearchAssetSourceInputKindEnum? fromJson(dynamic value) => AgentPreviousSearchAssetSourceInputKindEnumTypeTransformer().decode(value);

  static List<AgentPreviousSearchAssetSourceInputKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentPreviousSearchAssetSourceInputKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentPreviousSearchAssetSourceInputKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentPreviousSearchAssetSourceInputKindEnum] to String,
/// and [decode] dynamic data back to [AgentPreviousSearchAssetSourceInputKindEnum].
class AgentPreviousSearchAssetSourceInputKindEnumTypeTransformer {
  factory AgentPreviousSearchAssetSourceInputKindEnumTypeTransformer() => _instance ??= const AgentPreviousSearchAssetSourceInputKindEnumTypeTransformer._();

  const AgentPreviousSearchAssetSourceInputKindEnumTypeTransformer._();

  String encode(AgentPreviousSearchAssetSourceInputKindEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentPreviousSearchAssetSourceInputKindEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentPreviousSearchAssetSourceInputKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'previousSearch': return AgentPreviousSearchAssetSourceInputKindEnum.previousSearch;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentPreviousSearchAssetSourceInputKindEnumTypeTransformer] instance.
  static AgentPreviousSearchAssetSourceInputKindEnumTypeTransformer? _instance;
}



//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSelectionHandleAssetSourceInput {
  /// Returns a new [AgentSelectionHandleAssetSourceInput] instance.
  AgentSelectionHandleAssetSourceInput({
    required this.kind,
    required this.selectionHandleId,
  });

  AgentSelectionHandleAssetSourceInputKindEnum kind;

  String selectionHandleId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSelectionHandleAssetSourceInput &&
    other.kind == kind &&
    other.selectionHandleId == selectionHandleId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (kind.hashCode) +
    (selectionHandleId.hashCode);

  @override
  String toString() => 'AgentSelectionHandleAssetSourceInput[kind=$kind, selectionHandleId=$selectionHandleId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'kind'] = this.kind;
      json[r'selectionHandleId'] = this.selectionHandleId;
    return json;
  }

  /// Returns a new [AgentSelectionHandleAssetSourceInput] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSelectionHandleAssetSourceInput? fromJson(dynamic value) {
    upgradeDto(value, "AgentSelectionHandleAssetSourceInput");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSelectionHandleAssetSourceInput(
        kind: AgentSelectionHandleAssetSourceInputKindEnum.fromJson(json[r'kind'])!,
        selectionHandleId: mapValueOfType<String>(json, r'selectionHandleId')!,
      );
    }
    return null;
  }

  static List<AgentSelectionHandleAssetSourceInput> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSelectionHandleAssetSourceInput>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSelectionHandleAssetSourceInput.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSelectionHandleAssetSourceInput> mapFromJson(dynamic json) {
    final map = <String, AgentSelectionHandleAssetSourceInput>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSelectionHandleAssetSourceInput.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSelectionHandleAssetSourceInput-objects as value to a dart map
  static Map<String, List<AgentSelectionHandleAssetSourceInput>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSelectionHandleAssetSourceInput>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSelectionHandleAssetSourceInput.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'kind',
    'selectionHandleId',
  };
}


class AgentSelectionHandleAssetSourceInputKindEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSelectionHandleAssetSourceInputKindEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const selectionHandle = AgentSelectionHandleAssetSourceInputKindEnum._(r'selectionHandle');

  /// List of all possible values in this [enum][AgentSelectionHandleAssetSourceInputKindEnum].
  static const values = <AgentSelectionHandleAssetSourceInputKindEnum>[
    selectionHandle,
  ];

  static AgentSelectionHandleAssetSourceInputKindEnum? fromJson(dynamic value) => AgentSelectionHandleAssetSourceInputKindEnumTypeTransformer().decode(value);

  static List<AgentSelectionHandleAssetSourceInputKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSelectionHandleAssetSourceInputKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSelectionHandleAssetSourceInputKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSelectionHandleAssetSourceInputKindEnum] to String,
/// and [decode] dynamic data back to [AgentSelectionHandleAssetSourceInputKindEnum].
class AgentSelectionHandleAssetSourceInputKindEnumTypeTransformer {
  factory AgentSelectionHandleAssetSourceInputKindEnumTypeTransformer() => _instance ??= const AgentSelectionHandleAssetSourceInputKindEnumTypeTransformer._();

  const AgentSelectionHandleAssetSourceInputKindEnumTypeTransformer._();

  String encode(AgentSelectionHandleAssetSourceInputKindEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSelectionHandleAssetSourceInputKindEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSelectionHandleAssetSourceInputKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'selectionHandle': return AgentSelectionHandleAssetSourceInputKindEnum.selectionHandle;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSelectionHandleAssetSourceInputKindEnumTypeTransformer] instance.
  static AgentSelectionHandleAssetSourceInputKindEnumTypeTransformer? _instance;
}



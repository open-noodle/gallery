//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationItemSelection {
  /// Returns a new [AgentOperationItemSelection] instance.
  AgentOperationItemSelection({
    required this.itemKind,
    required this.mode,
    this.itemIds = const [],
  });

  AgentOperationItemKind itemKind;

  AgentOperationItemSelectionModeEnum mode;

  List<String> itemIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationItemSelection &&
    other.itemKind == itemKind &&
    other.mode == mode &&
    _deepEquality.equals(other.itemIds, itemIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (itemKind.hashCode) +
    (mode.hashCode) +
    (itemIds.hashCode);

  @override
  String toString() => 'AgentOperationItemSelection[itemKind=$itemKind, mode=$mode, itemIds=$itemIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'itemKind'] = this.itemKind;
      json[r'mode'] = this.mode;
      json[r'itemIds'] = this.itemIds;
    return json;
  }

  /// Returns a new [AgentOperationItemSelection] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationItemSelection? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationItemSelection");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationItemSelection(
        itemKind: AgentOperationItemKind.fromJson(json[r'itemKind'])!,
        mode: AgentOperationItemSelectionModeEnum.fromJson(json[r'mode'])!,
        itemIds: json[r'itemIds'] is Iterable
            ? (json[r'itemIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AgentOperationItemSelection> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelection>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelection.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationItemSelection> mapFromJson(dynamic json) {
    final map = <String, AgentOperationItemSelection>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationItemSelection.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationItemSelection-objects as value to a dart map
  static Map<String, List<AgentOperationItemSelection>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationItemSelection>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationItemSelection.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'itemKind',
    'mode',
    'itemIds',
  };
}


class AgentOperationItemSelectionModeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationItemSelectionModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const none = AgentOperationItemSelectionModeEnum._(r'none');

  /// List of all possible values in this [enum][AgentOperationItemSelectionModeEnum].
  static const values = <AgentOperationItemSelectionModeEnum>[
    none,
  ];

  static AgentOperationItemSelectionModeEnum? fromJson(dynamic value) => AgentOperationItemSelectionModeEnumTypeTransformer().decode(value);

  static List<AgentOperationItemSelectionModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationItemSelectionModeEnum] to String,
/// and [decode] dynamic data back to [AgentOperationItemSelectionModeEnum].
class AgentOperationItemSelectionModeEnumTypeTransformer {
  factory AgentOperationItemSelectionModeEnumTypeTransformer() => _instance ??= const AgentOperationItemSelectionModeEnumTypeTransformer._();

  const AgentOperationItemSelectionModeEnumTypeTransformer._();

  String encode(AgentOperationItemSelectionModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationItemSelectionModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationItemSelectionModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'none': return AgentOperationItemSelectionModeEnum.none;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationItemSelectionModeEnumTypeTransformer] instance.
  static AgentOperationItemSelectionModeEnumTypeTransformer? _instance;
}



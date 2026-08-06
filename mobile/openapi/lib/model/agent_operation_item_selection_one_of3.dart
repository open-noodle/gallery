//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationItemSelectionOneOf3 {
  /// Returns a new [AgentOperationItemSelectionOneOf3] instance.
  AgentOperationItemSelectionOneOf3({
    required this.itemKind,
    required this.mode,
    this.itemIds = const Optional.present(const []),
  });

  AgentOperationItemKind itemKind;

  AgentOperationItemSelectionOneOf3ModeEnum mode;

  Optional<List<String>?> itemIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationItemSelectionOneOf3 &&
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
  String toString() => 'AgentOperationItemSelectionOneOf3[itemKind=$itemKind, mode=$mode, itemIds=$itemIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'itemKind'] = this.itemKind;
      json[r'mode'] = this.mode;
    if (this.itemIds.isPresent) {
      final value = this.itemIds.value;
      json[r'itemIds'] = value;
    }
    return json;
  }

  /// Returns a new [AgentOperationItemSelectionOneOf3] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationItemSelectionOneOf3? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationItemSelectionOneOf3");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationItemSelectionOneOf3(
        itemKind: AgentOperationItemKind.fromJson(json[r'itemKind'])!,
        mode: AgentOperationItemSelectionOneOf3ModeEnum.fromJson(json[r'mode'])!,
        itemIds: json.containsKey(r'itemIds') ? Optional.present(json[r'itemIds'] is Iterable
            ? (json[r'itemIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentOperationItemSelectionOneOf3> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionOneOf3>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionOneOf3.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationItemSelectionOneOf3> mapFromJson(dynamic json) {
    final map = <String, AgentOperationItemSelectionOneOf3>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationItemSelectionOneOf3.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationItemSelectionOneOf3-objects as value to a dart map
  static Map<String, List<AgentOperationItemSelectionOneOf3>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationItemSelectionOneOf3>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationItemSelectionOneOf3.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'itemKind',
    'mode',
  };
}


class AgentOperationItemSelectionOneOf3ModeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationItemSelectionOneOf3ModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const none = AgentOperationItemSelectionOneOf3ModeEnum._(r'none');

  /// List of all possible values in this [enum][AgentOperationItemSelectionOneOf3ModeEnum].
  static const values = <AgentOperationItemSelectionOneOf3ModeEnum>[
    none,
  ];

  static AgentOperationItemSelectionOneOf3ModeEnum? fromJson(dynamic value) => AgentOperationItemSelectionOneOf3ModeEnumTypeTransformer().decode(value);

  static List<AgentOperationItemSelectionOneOf3ModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionOneOf3ModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionOneOf3ModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationItemSelectionOneOf3ModeEnum] to String,
/// and [decode] dynamic data back to [AgentOperationItemSelectionOneOf3ModeEnum].
class AgentOperationItemSelectionOneOf3ModeEnumTypeTransformer {
  factory AgentOperationItemSelectionOneOf3ModeEnumTypeTransformer() => _instance ??= const AgentOperationItemSelectionOneOf3ModeEnumTypeTransformer._();

  const AgentOperationItemSelectionOneOf3ModeEnumTypeTransformer._();

  String encode(AgentOperationItemSelectionOneOf3ModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationItemSelectionOneOf3ModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationItemSelectionOneOf3ModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'none': return AgentOperationItemSelectionOneOf3ModeEnum.none;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationItemSelectionOneOf3ModeEnumTypeTransformer] instance.
  static AgentOperationItemSelectionOneOf3ModeEnumTypeTransformer? _instance;
}



//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationItemSelectionOneOf1 {
  /// Returns a new [AgentOperationItemSelectionOneOf1] instance.
  AgentOperationItemSelectionOneOf1({
    required this.itemKind,
    required this.mode,
    this.itemIds = const [],
  });

  AgentOperationItemKind itemKind;

  AgentOperationItemSelectionOneOf1ModeEnum mode;

  List<String> itemIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationItemSelectionOneOf1 &&
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
  String toString() => 'AgentOperationItemSelectionOneOf1[itemKind=$itemKind, mode=$mode, itemIds=$itemIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'itemKind'] = this.itemKind;
      json[r'mode'] = this.mode;
      json[r'itemIds'] = this.itemIds;
    return json;
  }

  /// Returns a new [AgentOperationItemSelectionOneOf1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationItemSelectionOneOf1? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationItemSelectionOneOf1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationItemSelectionOneOf1(
        itemKind: AgentOperationItemKind.fromJson(json[r'itemKind'])!,
        mode: AgentOperationItemSelectionOneOf1ModeEnum.fromJson(json[r'mode'])!,
        itemIds: json[r'itemIds'] is Iterable
            ? (json[r'itemIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AgentOperationItemSelectionOneOf1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionOneOf1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionOneOf1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationItemSelectionOneOf1> mapFromJson(dynamic json) {
    final map = <String, AgentOperationItemSelectionOneOf1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationItemSelectionOneOf1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationItemSelectionOneOf1-objects as value to a dart map
  static Map<String, List<AgentOperationItemSelectionOneOf1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationItemSelectionOneOf1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationItemSelectionOneOf1.listFromJson(entry.value, growable: growable,);
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


class AgentOperationItemSelectionOneOf1ModeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationItemSelectionOneOf1ModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const allExcept = AgentOperationItemSelectionOneOf1ModeEnum._(r'allExcept');

  /// List of all possible values in this [enum][AgentOperationItemSelectionOneOf1ModeEnum].
  static const values = <AgentOperationItemSelectionOneOf1ModeEnum>[
    allExcept,
  ];

  static AgentOperationItemSelectionOneOf1ModeEnum? fromJson(dynamic value) => AgentOperationItemSelectionOneOf1ModeEnumTypeTransformer().decode(value);

  static List<AgentOperationItemSelectionOneOf1ModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionOneOf1ModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionOneOf1ModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationItemSelectionOneOf1ModeEnum] to String,
/// and [decode] dynamic data back to [AgentOperationItemSelectionOneOf1ModeEnum].
class AgentOperationItemSelectionOneOf1ModeEnumTypeTransformer {
  factory AgentOperationItemSelectionOneOf1ModeEnumTypeTransformer() => _instance ??= const AgentOperationItemSelectionOneOf1ModeEnumTypeTransformer._();

  const AgentOperationItemSelectionOneOf1ModeEnumTypeTransformer._();

  String encode(AgentOperationItemSelectionOneOf1ModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationItemSelectionOneOf1ModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationItemSelectionOneOf1ModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'allExcept': return AgentOperationItemSelectionOneOf1ModeEnum.allExcept;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationItemSelectionOneOf1ModeEnumTypeTransformer] instance.
  static AgentOperationItemSelectionOneOf1ModeEnumTypeTransformer? _instance;
}



//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationItemSelectionOneOf2 {
  /// Returns a new [AgentOperationItemSelectionOneOf2] instance.
  AgentOperationItemSelectionOneOf2({
    required this.itemKind,
    required this.mode,
    this.itemIds = const [],
  });

  AgentOperationItemKind itemKind;

  AgentOperationItemSelectionOneOf2ModeEnum mode;

  List<String> itemIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationItemSelectionOneOf2 &&
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
  String toString() => 'AgentOperationItemSelectionOneOf2[itemKind=$itemKind, mode=$mode, itemIds=$itemIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'itemKind'] = this.itemKind;
      json[r'mode'] = this.mode;
      json[r'itemIds'] = this.itemIds;
    return json;
  }

  /// Returns a new [AgentOperationItemSelectionOneOf2] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationItemSelectionOneOf2? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationItemSelectionOneOf2");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationItemSelectionOneOf2(
        itemKind: AgentOperationItemKind.fromJson(json[r'itemKind'])!,
        mode: AgentOperationItemSelectionOneOf2ModeEnum.fromJson(json[r'mode'])!,
        itemIds: json[r'itemIds'] is Iterable
            ? (json[r'itemIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AgentOperationItemSelectionOneOf2> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionOneOf2>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionOneOf2.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationItemSelectionOneOf2> mapFromJson(dynamic json) {
    final map = <String, AgentOperationItemSelectionOneOf2>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationItemSelectionOneOf2.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationItemSelectionOneOf2-objects as value to a dart map
  static Map<String, List<AgentOperationItemSelectionOneOf2>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationItemSelectionOneOf2>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationItemSelectionOneOf2.listFromJson(entry.value, growable: growable,);
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


class AgentOperationItemSelectionOneOf2ModeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationItemSelectionOneOf2ModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const only = AgentOperationItemSelectionOneOf2ModeEnum._(r'only');

  /// List of all possible values in this [enum][AgentOperationItemSelectionOneOf2ModeEnum].
  static const values = <AgentOperationItemSelectionOneOf2ModeEnum>[
    only,
  ];

  static AgentOperationItemSelectionOneOf2ModeEnum? fromJson(dynamic value) => AgentOperationItemSelectionOneOf2ModeEnumTypeTransformer().decode(value);

  static List<AgentOperationItemSelectionOneOf2ModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionOneOf2ModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionOneOf2ModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationItemSelectionOneOf2ModeEnum] to String,
/// and [decode] dynamic data back to [AgentOperationItemSelectionOneOf2ModeEnum].
class AgentOperationItemSelectionOneOf2ModeEnumTypeTransformer {
  factory AgentOperationItemSelectionOneOf2ModeEnumTypeTransformer() => _instance ??= const AgentOperationItemSelectionOneOf2ModeEnumTypeTransformer._();

  const AgentOperationItemSelectionOneOf2ModeEnumTypeTransformer._();

  String encode(AgentOperationItemSelectionOneOf2ModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationItemSelectionOneOf2ModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationItemSelectionOneOf2ModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'only': return AgentOperationItemSelectionOneOf2ModeEnum.only;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationItemSelectionOneOf2ModeEnumTypeTransformer] instance.
  static AgentOperationItemSelectionOneOf2ModeEnumTypeTransformer? _instance;
}



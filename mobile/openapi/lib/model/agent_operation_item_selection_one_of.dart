//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationItemSelectionOneOf {
  /// Returns a new [AgentOperationItemSelectionOneOf] instance.
  AgentOperationItemSelectionOneOf({
    required this.itemKind,
    required this.mode,
    this.itemIds = const Optional.present(const []),
  });

  AgentOperationItemKind itemKind;

  AgentOperationItemSelectionOneOfModeEnum mode;

  Optional<List<String>?> itemIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationItemSelectionOneOf &&
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
  String toString() => 'AgentOperationItemSelectionOneOf[itemKind=$itemKind, mode=$mode, itemIds=$itemIds]';

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

  /// Returns a new [AgentOperationItemSelectionOneOf] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationItemSelectionOneOf? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationItemSelectionOneOf");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationItemSelectionOneOf(
        itemKind: AgentOperationItemKind.fromJson(json[r'itemKind'])!,
        mode: AgentOperationItemSelectionOneOfModeEnum.fromJson(json[r'mode'])!,
        itemIds: json.containsKey(r'itemIds') ? Optional.present(json[r'itemIds'] is Iterable
            ? (json[r'itemIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentOperationItemSelectionOneOf> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionOneOf>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionOneOf.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationItemSelectionOneOf> mapFromJson(dynamic json) {
    final map = <String, AgentOperationItemSelectionOneOf>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationItemSelectionOneOf.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationItemSelectionOneOf-objects as value to a dart map
  static Map<String, List<AgentOperationItemSelectionOneOf>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationItemSelectionOneOf>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationItemSelectionOneOf.listFromJson(entry.value, growable: growable,);
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


class AgentOperationItemSelectionOneOfModeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationItemSelectionOneOfModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const all = AgentOperationItemSelectionOneOfModeEnum._(r'all');

  /// List of all possible values in this [enum][AgentOperationItemSelectionOneOfModeEnum].
  static const values = <AgentOperationItemSelectionOneOfModeEnum>[
    all,
  ];

  static AgentOperationItemSelectionOneOfModeEnum? fromJson(dynamic value) => AgentOperationItemSelectionOneOfModeEnumTypeTransformer().decode(value);

  static List<AgentOperationItemSelectionOneOfModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationItemSelectionOneOfModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationItemSelectionOneOfModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationItemSelectionOneOfModeEnum] to String,
/// and [decode] dynamic data back to [AgentOperationItemSelectionOneOfModeEnum].
class AgentOperationItemSelectionOneOfModeEnumTypeTransformer {
  factory AgentOperationItemSelectionOneOfModeEnumTypeTransformer() => _instance ??= const AgentOperationItemSelectionOneOfModeEnumTypeTransformer._();

  const AgentOperationItemSelectionOneOfModeEnumTypeTransformer._();

  String encode(AgentOperationItemSelectionOneOfModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationItemSelectionOneOfModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationItemSelectionOneOfModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'all': return AgentOperationItemSelectionOneOfModeEnum.all;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationItemSelectionOneOfModeEnumTypeTransformer] instance.
  static AgentOperationItemSelectionOneOfModeEnumTypeTransformer? _instance;
}



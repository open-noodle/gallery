//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentPermissionPreset {
  /// Instantiate a new enum with the provided [value].
  const AgentPermissionPreset._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const careful = AgentPermissionPreset._(r'careful');
  static const visualOrganizer = AgentPermissionPreset._(r'visual-organizer');
  static const localPowerUser = AgentPermissionPreset._(r'local-power-user');
  static const custom = AgentPermissionPreset._(r'custom');

  /// List of all possible values in this [enum][AgentPermissionPreset].
  static const values = <AgentPermissionPreset>[
    careful,
    visualOrganizer,
    localPowerUser,
    custom,
  ];

  static AgentPermissionPreset? fromJson(dynamic value) => AgentPermissionPresetTypeTransformer().decode(value);

  static List<AgentPermissionPreset> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentPermissionPreset>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentPermissionPreset.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentPermissionPreset] to String,
/// and [decode] dynamic data back to [AgentPermissionPreset].
class AgentPermissionPresetTypeTransformer {
  factory AgentPermissionPresetTypeTransformer() => _instance ??= const AgentPermissionPresetTypeTransformer._();

  const AgentPermissionPresetTypeTransformer._();

  String encode(AgentPermissionPreset data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentPermissionPreset.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentPermissionPreset? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'careful': return AgentPermissionPreset.careful;
        case r'visual-organizer': return AgentPermissionPreset.visualOrganizer;
        case r'local-power-user': return AgentPermissionPreset.localPowerUser;
        case r'custom': return AgentPermissionPreset.custom;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentPermissionPresetTypeTransformer] instance.
  static AgentPermissionPresetTypeTransformer? _instance;
}


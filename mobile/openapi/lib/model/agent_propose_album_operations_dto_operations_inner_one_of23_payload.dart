//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload {
  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload] instance.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload({
    required this.visibility,
  });

  AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum visibility;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload &&
    other.visibility == visibility;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (visibility.hashCode);

  @override
  String toString() => 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload[visibility=$visibility]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'visibility'] = this.visibility;
    return json;
  }

  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload? fromJson(dynamic value) {
    upgradeDto(value, "AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload(
        visibility: AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum.fromJson(json[r'visibility'])!,
      );
    }
    return null;
  }

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload> mapFromJson(dynamic json) {
    final map = <String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload-objects as value to a dart map
  static Map<String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'visibility',
  };
}


class AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const locked = AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum._(r'locked');

  /// List of all possible values in this [enum][AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum].
  static const values = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum>[
    locked,
  ];

  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum? fromJson(dynamic value) => AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnumTypeTransformer().decode(value);

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum] to String,
/// and [decode] dynamic data back to [AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum].
class AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnumTypeTransformer {
  factory AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnumTypeTransformer() => _instance ??= const AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnumTypeTransformer._();

  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnumTypeTransformer._();

  String encode(AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'locked': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnum.locked;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnumTypeTransformer] instance.
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf23PayloadVisibilityEnumTypeTransformer? _instance;
}



//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload {
  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload] instance.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload({
    required this.axis,
  });

  AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum axis;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload &&
    other.axis == axis;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (axis.hashCode);

  @override
  String toString() => 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload[axis=$axis]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'axis'] = this.axis;
    return json;
  }

  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload? fromJson(dynamic value) {
    upgradeDto(value, "AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload(
        axis: AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum.fromJson(json[r'axis'])!,
      );
    }
    return null;
  }

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload> mapFromJson(dynamic json) {
    final map = <String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload-objects as value to a dart map
  static Map<String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'axis',
  };
}


class AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const horizontal = AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum._(r'horizontal');
  static const vertical = AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum._(r'vertical');

  /// List of all possible values in this [enum][AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum].
  static const values = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum>[
    horizontal,
    vertical,
  ];

  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum? fromJson(dynamic value) => AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnumTypeTransformer().decode(value);

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum] to String,
/// and [decode] dynamic data back to [AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum].
class AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnumTypeTransformer {
  factory AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnumTypeTransformer() => _instance ??= const AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnumTypeTransformer._();

  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnumTypeTransformer._();

  String encode(AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'horizontal': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum.horizontal;
        case r'vertical': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnum.vertical;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnumTypeTransformer] instance.
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf20PayloadAxisEnumTypeTransformer? _instance;
}



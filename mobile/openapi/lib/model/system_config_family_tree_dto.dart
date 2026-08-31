//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigFamilyTreeDto {
  /// Returns a new [SystemConfigFamilyTreeDto] instance.
  SystemConfigFamilyTreeDto({
    required this.defaultAccess,
    required this.enabled,
  });

  /// Family tree access for users without an explicit grant
  SystemConfigFamilyTreeDtoDefaultAccessEnum defaultAccess;

  /// Enable family relationships
  bool enabled;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigFamilyTreeDto &&
    other.defaultAccess == defaultAccess &&
    other.enabled == enabled;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (defaultAccess.hashCode) +
    (enabled.hashCode);

  @override
  String toString() => 'SystemConfigFamilyTreeDto[defaultAccess=$defaultAccess, enabled=$enabled]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'defaultAccess'] = this.defaultAccess;
      json[r'enabled'] = this.enabled;
    return json;
  }

  /// Returns a new [SystemConfigFamilyTreeDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigFamilyTreeDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigFamilyTreeDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigFamilyTreeDto(
        defaultAccess: SystemConfigFamilyTreeDtoDefaultAccessEnum.fromJson(json[r'defaultAccess'])!,
        enabled: mapValueOfType<bool>(json, r'enabled')!,
      );
    }
    return null;
  }

  static List<SystemConfigFamilyTreeDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigFamilyTreeDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigFamilyTreeDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigFamilyTreeDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigFamilyTreeDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigFamilyTreeDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigFamilyTreeDto-objects as value to a dart map
  static Map<String, List<SystemConfigFamilyTreeDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigFamilyTreeDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigFamilyTreeDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'defaultAccess',
    'enabled',
  };
}

/// Family tree access for users without an explicit grant
enum SystemConfigFamilyTreeDtoDefaultAccessEnum {
  none._(r'none'),
  view._(r'view'),
  contribute._(r'contribute'),
  ;

  /// Instantiate a new enum with the provided value.
  const SystemConfigFamilyTreeDtoDefaultAccessEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [SystemConfigFamilyTreeDtoDefaultAccessEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static SystemConfigFamilyTreeDtoDefaultAccessEnum? fromJson(dynamic value) => SystemConfigFamilyTreeDtoDefaultAccessEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [SystemConfigFamilyTreeDtoDefaultAccessEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<SystemConfigFamilyTreeDtoDefaultAccessEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigFamilyTreeDtoDefaultAccessEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigFamilyTreeDtoDefaultAccessEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SystemConfigFamilyTreeDtoDefaultAccessEnum] to String,
/// and [decode] dynamic data back to [SystemConfigFamilyTreeDtoDefaultAccessEnum].
class SystemConfigFamilyTreeDtoDefaultAccessEnumTypeTransformer {
  factory SystemConfigFamilyTreeDtoDefaultAccessEnumTypeTransformer() => _instance ??= const SystemConfigFamilyTreeDtoDefaultAccessEnumTypeTransformer._();

  const SystemConfigFamilyTreeDtoDefaultAccessEnumTypeTransformer._();

  String encode(SystemConfigFamilyTreeDtoDefaultAccessEnum data) => data._value;

  /// Returns the instance of [SystemConfigFamilyTreeDtoDefaultAccessEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SystemConfigFamilyTreeDtoDefaultAccessEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is SystemConfigFamilyTreeDtoDefaultAccessEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'none': return SystemConfigFamilyTreeDtoDefaultAccessEnum.none;
        case r'view': return SystemConfigFamilyTreeDtoDefaultAccessEnum.view;
        case r'contribute': return SystemConfigFamilyTreeDtoDefaultAccessEnum.contribute;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static SystemConfigFamilyTreeDtoDefaultAccessEnumTypeTransformer? _instance;
}



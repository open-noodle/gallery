//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpacePersonReassignDtoTarget {
  /// Returns a new [SharedSpacePersonReassignDtoTarget] instance.
  SharedSpacePersonReassignDtoTarget({
    required this.type,
    required this.profile,
  });

  SharedSpacePersonReassignDtoTargetTypeEnum type;

  ScopedPersonProfileRefDto profile;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpacePersonReassignDtoTarget &&
    other.type == type &&
    other.profile == profile;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (type.hashCode) +
    (profile.hashCode);

  @override
  String toString() => 'SharedSpacePersonReassignDtoTarget[type=$type, profile=$profile]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'type'] = this.type;
      json[r'profile'] = this.profile;
    return json;
  }

  /// Returns a new [SharedSpacePersonReassignDtoTarget] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpacePersonReassignDtoTarget? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpacePersonReassignDtoTarget");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpacePersonReassignDtoTarget(
        type: SharedSpacePersonReassignDtoTargetTypeEnum.fromJson(json[r'type'])!,
        profile: ScopedPersonProfileRefDto.fromJson(json[r'profile'])!,
      );
    }
    return null;
  }

  static List<SharedSpacePersonReassignDtoTarget> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonReassignDtoTarget>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonReassignDtoTarget.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpacePersonReassignDtoTarget> mapFromJson(dynamic json) {
    final map = <String, SharedSpacePersonReassignDtoTarget>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpacePersonReassignDtoTarget.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpacePersonReassignDtoTarget-objects as value to a dart map
  static Map<String, List<SharedSpacePersonReassignDtoTarget>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpacePersonReassignDtoTarget>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpacePersonReassignDtoTarget.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'type',
    'profile',
  };
}


enum SharedSpacePersonReassignDtoTargetTypeEnum {
  new_._(r'new'),
  existing._(r'existing'),
  ;

  /// Instantiate a new enum with the provided value.
  const SharedSpacePersonReassignDtoTargetTypeEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [SharedSpacePersonReassignDtoTargetTypeEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static SharedSpacePersonReassignDtoTargetTypeEnum? fromJson(dynamic value) => SharedSpacePersonReassignDtoTargetTypeEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [SharedSpacePersonReassignDtoTargetTypeEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<SharedSpacePersonReassignDtoTargetTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonReassignDtoTargetTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonReassignDtoTargetTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SharedSpacePersonReassignDtoTargetTypeEnum] to String,
/// and [decode] dynamic data back to [SharedSpacePersonReassignDtoTargetTypeEnum].
class SharedSpacePersonReassignDtoTargetTypeEnumTypeTransformer {
  factory SharedSpacePersonReassignDtoTargetTypeEnumTypeTransformer() => _instance ??= const SharedSpacePersonReassignDtoTargetTypeEnumTypeTransformer._();

  const SharedSpacePersonReassignDtoTargetTypeEnumTypeTransformer._();

  String encode(SharedSpacePersonReassignDtoTargetTypeEnum data) => data._value;

  /// Returns the instance of [SharedSpacePersonReassignDtoTargetTypeEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SharedSpacePersonReassignDtoTargetTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is SharedSpacePersonReassignDtoTargetTypeEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'new': return SharedSpacePersonReassignDtoTargetTypeEnum.new_;
        case r'existing': return SharedSpacePersonReassignDtoTargetTypeEnum.existing;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static SharedSpacePersonReassignDtoTargetTypeEnumTypeTransformer? _instance;
}



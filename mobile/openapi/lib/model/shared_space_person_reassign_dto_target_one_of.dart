//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpacePersonReassignDtoTargetOneOf {
  /// Returns a new [SharedSpacePersonReassignDtoTargetOneOf] instance.
  SharedSpacePersonReassignDtoTargetOneOf({
    required this.type,
  });

  SharedSpacePersonReassignDtoTargetOneOfTypeEnum type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpacePersonReassignDtoTargetOneOf &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (type.hashCode);

  @override
  String toString() => 'SharedSpacePersonReassignDtoTargetOneOf[type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'type'] = this.type;
    return json;
  }

  /// Returns a new [SharedSpacePersonReassignDtoTargetOneOf] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpacePersonReassignDtoTargetOneOf? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpacePersonReassignDtoTargetOneOf");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpacePersonReassignDtoTargetOneOf(
        type: SharedSpacePersonReassignDtoTargetOneOfTypeEnum.fromJson(json[r'type'])!,
      );
    }
    return null;
  }

  static List<SharedSpacePersonReassignDtoTargetOneOf> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonReassignDtoTargetOneOf>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonReassignDtoTargetOneOf.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpacePersonReassignDtoTargetOneOf> mapFromJson(dynamic json) {
    final map = <String, SharedSpacePersonReassignDtoTargetOneOf>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpacePersonReassignDtoTargetOneOf.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpacePersonReassignDtoTargetOneOf-objects as value to a dart map
  static Map<String, List<SharedSpacePersonReassignDtoTargetOneOf>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpacePersonReassignDtoTargetOneOf>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpacePersonReassignDtoTargetOneOf.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'type',
  };
}


enum SharedSpacePersonReassignDtoTargetOneOfTypeEnum {
  new_._(r'new'),
  ;

  /// Instantiate a new enum with the provided value.
  const SharedSpacePersonReassignDtoTargetOneOfTypeEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [SharedSpacePersonReassignDtoTargetOneOfTypeEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static SharedSpacePersonReassignDtoTargetOneOfTypeEnum? fromJson(dynamic value) => SharedSpacePersonReassignDtoTargetOneOfTypeEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [SharedSpacePersonReassignDtoTargetOneOfTypeEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<SharedSpacePersonReassignDtoTargetOneOfTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonReassignDtoTargetOneOfTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonReassignDtoTargetOneOfTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SharedSpacePersonReassignDtoTargetOneOfTypeEnum] to String,
/// and [decode] dynamic data back to [SharedSpacePersonReassignDtoTargetOneOfTypeEnum].
class SharedSpacePersonReassignDtoTargetOneOfTypeEnumTypeTransformer {
  factory SharedSpacePersonReassignDtoTargetOneOfTypeEnumTypeTransformer() => _instance ??= const SharedSpacePersonReassignDtoTargetOneOfTypeEnumTypeTransformer._();

  const SharedSpacePersonReassignDtoTargetOneOfTypeEnumTypeTransformer._();

  String encode(SharedSpacePersonReassignDtoTargetOneOfTypeEnum data) => data._value;

  /// Returns the instance of [SharedSpacePersonReassignDtoTargetOneOfTypeEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SharedSpacePersonReassignDtoTargetOneOfTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is SharedSpacePersonReassignDtoTargetOneOfTypeEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'new': return SharedSpacePersonReassignDtoTargetOneOfTypeEnum.new_;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static SharedSpacePersonReassignDtoTargetOneOfTypeEnumTypeTransformer? _instance;
}



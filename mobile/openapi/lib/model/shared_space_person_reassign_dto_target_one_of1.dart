//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpacePersonReassignDtoTargetOneOf1 {
  /// Returns a new [SharedSpacePersonReassignDtoTargetOneOf1] instance.
  SharedSpacePersonReassignDtoTargetOneOf1({
    required this.type,
    required this.profile,
  });

  SharedSpacePersonReassignDtoTargetOneOf1TypeEnum type;

  ScopedPersonProfileRefDto profile;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpacePersonReassignDtoTargetOneOf1 &&
    other.type == type &&
    other.profile == profile;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (type.hashCode) +
    (profile.hashCode);

  @override
  String toString() => 'SharedSpacePersonReassignDtoTargetOneOf1[type=$type, profile=$profile]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'type'] = this.type;
      json[r'profile'] = this.profile;
    return json;
  }

  /// Returns a new [SharedSpacePersonReassignDtoTargetOneOf1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpacePersonReassignDtoTargetOneOf1? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpacePersonReassignDtoTargetOneOf1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpacePersonReassignDtoTargetOneOf1(
        type: SharedSpacePersonReassignDtoTargetOneOf1TypeEnum.fromJson(json[r'type'])!,
        profile: ScopedPersonProfileRefDto.fromJson(json[r'profile'])!,
      );
    }
    return null;
  }

  static List<SharedSpacePersonReassignDtoTargetOneOf1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonReassignDtoTargetOneOf1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonReassignDtoTargetOneOf1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpacePersonReassignDtoTargetOneOf1> mapFromJson(dynamic json) {
    final map = <String, SharedSpacePersonReassignDtoTargetOneOf1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpacePersonReassignDtoTargetOneOf1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpacePersonReassignDtoTargetOneOf1-objects as value to a dart map
  static Map<String, List<SharedSpacePersonReassignDtoTargetOneOf1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpacePersonReassignDtoTargetOneOf1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpacePersonReassignDtoTargetOneOf1.listFromJson(entry.value, growable: growable,);
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


class SharedSpacePersonReassignDtoTargetOneOf1TypeEnum {
  /// Instantiate a new enum with the provided [value].
  const SharedSpacePersonReassignDtoTargetOneOf1TypeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const existing = SharedSpacePersonReassignDtoTargetOneOf1TypeEnum._(r'existing');

  /// List of all possible values in this [enum][SharedSpacePersonReassignDtoTargetOneOf1TypeEnum].
  static const values = <SharedSpacePersonReassignDtoTargetOneOf1TypeEnum>[
    existing,
  ];

  static SharedSpacePersonReassignDtoTargetOneOf1TypeEnum? fromJson(dynamic value) => SharedSpacePersonReassignDtoTargetOneOf1TypeEnumTypeTransformer().decode(value);

  static List<SharedSpacePersonReassignDtoTargetOneOf1TypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonReassignDtoTargetOneOf1TypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonReassignDtoTargetOneOf1TypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SharedSpacePersonReassignDtoTargetOneOf1TypeEnum] to String,
/// and [decode] dynamic data back to [SharedSpacePersonReassignDtoTargetOneOf1TypeEnum].
class SharedSpacePersonReassignDtoTargetOneOf1TypeEnumTypeTransformer {
  factory SharedSpacePersonReassignDtoTargetOneOf1TypeEnumTypeTransformer() => _instance ??= const SharedSpacePersonReassignDtoTargetOneOf1TypeEnumTypeTransformer._();

  const SharedSpacePersonReassignDtoTargetOneOf1TypeEnumTypeTransformer._();

  String encode(SharedSpacePersonReassignDtoTargetOneOf1TypeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a SharedSpacePersonReassignDtoTargetOneOf1TypeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SharedSpacePersonReassignDtoTargetOneOf1TypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'existing': return SharedSpacePersonReassignDtoTargetOneOf1TypeEnum.existing;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [SharedSpacePersonReassignDtoTargetOneOf1TypeEnumTypeTransformer] instance.
  static SharedSpacePersonReassignDtoTargetOneOf1TypeEnumTypeTransformer? _instance;
}



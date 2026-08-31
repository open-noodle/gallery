//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyParticipantDtoOneOf1 {
  /// Returns a new [FamilyParticipantDtoOneOf1] instance.
  FamilyParticipantDtoOneOf1({
    required this.kind,
  });

  FamilyParticipantDtoOneOf1KindEnum kind;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyParticipantDtoOneOf1 &&
    other.kind == kind;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (kind.hashCode);

  @override
  String toString() => 'FamilyParticipantDtoOneOf1[kind=$kind]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'kind'] = this.kind;
    return json;
  }

  /// Returns a new [FamilyParticipantDtoOneOf1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyParticipantDtoOneOf1? fromJson(dynamic value) {
    upgradeDto(value, "FamilyParticipantDtoOneOf1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyParticipantDtoOneOf1(
        kind: FamilyParticipantDtoOneOf1KindEnum.fromJson(json[r'kind'])!,
      );
    }
    return null;
  }

  static List<FamilyParticipantDtoOneOf1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyParticipantDtoOneOf1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyParticipantDtoOneOf1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyParticipantDtoOneOf1> mapFromJson(dynamic json) {
    final map = <String, FamilyParticipantDtoOneOf1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyParticipantDtoOneOf1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyParticipantDtoOneOf1-objects as value to a dart map
  static Map<String, List<FamilyParticipantDtoOneOf1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyParticipantDtoOneOf1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyParticipantDtoOneOf1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'kind',
  };
}


enum FamilyParticipantDtoOneOf1KindEnum {
  anonymous._(r'anonymous'),
  ;

  /// Instantiate a new enum with the provided value.
  const FamilyParticipantDtoOneOf1KindEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [FamilyParticipantDtoOneOf1KindEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static FamilyParticipantDtoOneOf1KindEnum? fromJson(dynamic value) => FamilyParticipantDtoOneOf1KindEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [FamilyParticipantDtoOneOf1KindEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<FamilyParticipantDtoOneOf1KindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyParticipantDtoOneOf1KindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyParticipantDtoOneOf1KindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [FamilyParticipantDtoOneOf1KindEnum] to String,
/// and [decode] dynamic data back to [FamilyParticipantDtoOneOf1KindEnum].
class FamilyParticipantDtoOneOf1KindEnumTypeTransformer {
  factory FamilyParticipantDtoOneOf1KindEnumTypeTransformer() => _instance ??= const FamilyParticipantDtoOneOf1KindEnumTypeTransformer._();

  const FamilyParticipantDtoOneOf1KindEnumTypeTransformer._();

  String encode(FamilyParticipantDtoOneOf1KindEnum data) => data._value;

  /// Returns the instance of [FamilyParticipantDtoOneOf1KindEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  FamilyParticipantDtoOneOf1KindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is FamilyParticipantDtoOneOf1KindEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'anonymous': return FamilyParticipantDtoOneOf1KindEnum.anonymous;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static FamilyParticipantDtoOneOf1KindEnumTypeTransformer? _instance;
}



//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyParticipantDtoOneOf {
  /// Returns a new [FamilyParticipantDtoOneOf] instance.
  FamilyParticipantDtoOneOf({
    required this.kind,
    required this.identityId,
  });

  FamilyParticipantDtoOneOfKindEnum kind;

  /// Identity ID
  String identityId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyParticipantDtoOneOf &&
    other.kind == kind &&
    other.identityId == identityId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (kind.hashCode) +
    (identityId.hashCode);

  @override
  String toString() => 'FamilyParticipantDtoOneOf[kind=$kind, identityId=$identityId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'kind'] = this.kind;
      json[r'identityId'] = this.identityId;
    return json;
  }

  /// Returns a new [FamilyParticipantDtoOneOf] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyParticipantDtoOneOf? fromJson(dynamic value) {
    upgradeDto(value, "FamilyParticipantDtoOneOf");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyParticipantDtoOneOf(
        kind: FamilyParticipantDtoOneOfKindEnum.fromJson(json[r'kind'])!,
        identityId: mapValueOfType<String>(json, r'identityId')!,
      );
    }
    return null;
  }

  static List<FamilyParticipantDtoOneOf> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyParticipantDtoOneOf>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyParticipantDtoOneOf.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyParticipantDtoOneOf> mapFromJson(dynamic json) {
    final map = <String, FamilyParticipantDtoOneOf>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyParticipantDtoOneOf.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyParticipantDtoOneOf-objects as value to a dart map
  static Map<String, List<FamilyParticipantDtoOneOf>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyParticipantDtoOneOf>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyParticipantDtoOneOf.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'kind',
    'identityId',
  };
}


enum FamilyParticipantDtoOneOfKindEnum {
  known._(r'known'),
  ;

  /// Instantiate a new enum with the provided value.
  const FamilyParticipantDtoOneOfKindEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [FamilyParticipantDtoOneOfKindEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static FamilyParticipantDtoOneOfKindEnum? fromJson(dynamic value) => FamilyParticipantDtoOneOfKindEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [FamilyParticipantDtoOneOfKindEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<FamilyParticipantDtoOneOfKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyParticipantDtoOneOfKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyParticipantDtoOneOfKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [FamilyParticipantDtoOneOfKindEnum] to String,
/// and [decode] dynamic data back to [FamilyParticipantDtoOneOfKindEnum].
class FamilyParticipantDtoOneOfKindEnumTypeTransformer {
  factory FamilyParticipantDtoOneOfKindEnumTypeTransformer() => _instance ??= const FamilyParticipantDtoOneOfKindEnumTypeTransformer._();

  const FamilyParticipantDtoOneOfKindEnumTypeTransformer._();

  String encode(FamilyParticipantDtoOneOfKindEnum data) => data._value;

  /// Returns the instance of [FamilyParticipantDtoOneOfKindEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  FamilyParticipantDtoOneOfKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is FamilyParticipantDtoOneOfKindEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'known': return FamilyParticipantDtoOneOfKindEnum.known;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static FamilyParticipantDtoOneOfKindEnumTypeTransformer? _instance;
}



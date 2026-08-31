//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyParticipantDto {
  /// Returns a new [FamilyParticipantDto] instance.
  FamilyParticipantDto({
    required this.kind,
    required this.identityId,
  });

  FamilyParticipantDtoKindEnum kind;

  /// Identity ID
  String identityId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyParticipantDto &&
    other.kind == kind &&
    other.identityId == identityId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (kind.hashCode) +
    (identityId.hashCode);

  @override
  String toString() => 'FamilyParticipantDto[kind=$kind, identityId=$identityId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'kind'] = this.kind;
      json[r'identityId'] = this.identityId;
    return json;
  }

  /// Returns a new [FamilyParticipantDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyParticipantDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyParticipantDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyParticipantDto(
        kind: FamilyParticipantDtoKindEnum.fromJson(json[r'kind'])!,
        identityId: mapValueOfType<String>(json, r'identityId')!,
      );
    }
    return null;
  }

  static List<FamilyParticipantDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyParticipantDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyParticipantDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyParticipantDto> mapFromJson(dynamic json) {
    final map = <String, FamilyParticipantDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyParticipantDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyParticipantDto-objects as value to a dart map
  static Map<String, List<FamilyParticipantDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyParticipantDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyParticipantDto.listFromJson(entry.value, growable: growable,);
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


enum FamilyParticipantDtoKindEnum {
  anonymous._(r'anonymous'),
  ;

  /// Instantiate a new enum with the provided value.
  const FamilyParticipantDtoKindEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [FamilyParticipantDtoKindEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static FamilyParticipantDtoKindEnum? fromJson(dynamic value) => FamilyParticipantDtoKindEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [FamilyParticipantDtoKindEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<FamilyParticipantDtoKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyParticipantDtoKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyParticipantDtoKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [FamilyParticipantDtoKindEnum] to String,
/// and [decode] dynamic data back to [FamilyParticipantDtoKindEnum].
class FamilyParticipantDtoKindEnumTypeTransformer {
  factory FamilyParticipantDtoKindEnumTypeTransformer() => _instance ??= const FamilyParticipantDtoKindEnumTypeTransformer._();

  const FamilyParticipantDtoKindEnumTypeTransformer._();

  String encode(FamilyParticipantDtoKindEnum data) => data._value;

  /// Returns the instance of [FamilyParticipantDtoKindEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  FamilyParticipantDtoKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is FamilyParticipantDtoKindEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'anonymous': return FamilyParticipantDtoKindEnum.anonymous;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static FamilyParticipantDtoKindEnumTypeTransformer? _instance;
}



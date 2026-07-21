//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ScopedPersonProfileRefDto {
  /// Returns a new [ScopedPersonProfileRefDto] instance.
  ScopedPersonProfileRefDto({
    required this.id,
    this.spaceId = const Optional.absent(),
    required this.type,
  });

  /// Scoped profile ID
  String id;

  /// Space ID for Space Person refs
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> spaceId;

  /// Scoped profile type
  ScopedPersonProfileRefDtoTypeEnum type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ScopedPersonProfileRefDto &&
    other.id == id &&
    other.spaceId == spaceId &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (id.hashCode) +
    (spaceId == null ? 0 : spaceId!.hashCode) +
    (type.hashCode);

  @override
  String toString() => 'ScopedPersonProfileRefDto[id=$id, spaceId=$spaceId, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'id'] = this.id;
    if (this.spaceId.isPresent) {
      final value = this.spaceId.value;
      json[r'spaceId'] = value;
    }
      json[r'type'] = this.type;
    return json;
  }

  /// Returns a new [ScopedPersonProfileRefDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ScopedPersonProfileRefDto? fromJson(dynamic value) {
    upgradeDto(value, "ScopedPersonProfileRefDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ScopedPersonProfileRefDto(
        id: mapValueOfType<String>(json, r'id')!,
        spaceId: json.containsKey(r'spaceId') ? Optional.present(mapValueOfType<String>(json, r'spaceId')) : const Optional.absent(),
        type: ScopedPersonProfileRefDtoTypeEnum.fromJson(json[r'type'])!,
      );
    }
    return null;
  }

  static List<ScopedPersonProfileRefDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ScopedPersonProfileRefDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ScopedPersonProfileRefDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ScopedPersonProfileRefDto> mapFromJson(dynamic json) {
    final map = <String, ScopedPersonProfileRefDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ScopedPersonProfileRefDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ScopedPersonProfileRefDto-objects as value to a dart map
  static Map<String, List<ScopedPersonProfileRefDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ScopedPersonProfileRefDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ScopedPersonProfileRefDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'id',
    'type',
  };
}

/// Scoped profile type
enum ScopedPersonProfileRefDtoTypeEnum {
  person._(r'person'),
  spacePerson._(r'space-person'),
  ;

  /// Instantiate a new enum with the provided value.
  const ScopedPersonProfileRefDtoTypeEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [ScopedPersonProfileRefDtoTypeEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static ScopedPersonProfileRefDtoTypeEnum? fromJson(dynamic value) => ScopedPersonProfileRefDtoTypeEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [ScopedPersonProfileRefDtoTypeEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<ScopedPersonProfileRefDtoTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ScopedPersonProfileRefDtoTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ScopedPersonProfileRefDtoTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ScopedPersonProfileRefDtoTypeEnum] to String,
/// and [decode] dynamic data back to [ScopedPersonProfileRefDtoTypeEnum].
class ScopedPersonProfileRefDtoTypeEnumTypeTransformer {
  factory ScopedPersonProfileRefDtoTypeEnumTypeTransformer() => _instance ??= const ScopedPersonProfileRefDtoTypeEnumTypeTransformer._();

  const ScopedPersonProfileRefDtoTypeEnumTypeTransformer._();

  String encode(ScopedPersonProfileRefDtoTypeEnum data) => data._value;

  /// Returns the instance of [ScopedPersonProfileRefDtoTypeEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ScopedPersonProfileRefDtoTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is ScopedPersonProfileRefDtoTypeEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'person': return ScopedPersonProfileRefDtoTypeEnum.person;
        case r'space-person': return ScopedPersonProfileRefDtoTypeEnum.spacePerson;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static ScopedPersonProfileRefDtoTypeEnumTypeTransformer? _instance;
}



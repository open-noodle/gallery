//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PersonResponseDto {
  /// Returns a new [PersonResponseDto] instance.
  PersonResponseDto({
    required this.birthDate,
    this.color = const Optional.absent(),
    this.familyRelationLabel = const Optional.absent(),
    this.filterId = const Optional.absent(),
    required this.id,
    this.isFavorite = const Optional.absent(),
    required this.isHidden,
    required this.name,
    this.numberOfAssets = const Optional.absent(),
    this.primaryProfile = const Optional.absent(),
    this.spacePersonId = const Optional.absent(),
    this.species = const Optional.absent(),
    required this.thumbnailPath,
    this.type = const Optional.present('person'),
    this.updatedAt = const Optional.absent(),
  });

  /// Person date of birth
  DateTime? birthDate;

  /// Person color (hex)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> color;

  /// How this person relates to the viewer (\"your niece\"), present only when the viewer has family access
  Optional<String?> familyRelationLabel;

  /// Scoped identity filter token
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> filterId;

  /// Person ID
  String id;

  /// Is favorite
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> isFavorite;

  /// Is hidden
  bool isHidden;

  /// Person name
  String name;

  /// Accessible asset count for this grouped person
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> numberOfAssets;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<ScopedPrimaryProfile?> primaryProfile;

  /// Space person ID when viewed through a shared space
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> spacePersonId;

  /// Pet species (e.g. dog, cat)
  Optional<String?> species;

  /// Thumbnail path
  String thumbnailPath;

  /// Entity type (person or pet)
  Optional<String?> type;

  /// Last update date
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PersonResponseDto &&
    other.birthDate == birthDate &&
    other.color == color &&
    other.familyRelationLabel == familyRelationLabel &&
    other.filterId == filterId &&
    other.id == id &&
    other.isFavorite == isFavorite &&
    other.isHidden == isHidden &&
    other.name == name &&
    other.numberOfAssets == numberOfAssets &&
    other.primaryProfile == primaryProfile &&
    other.spacePersonId == spacePersonId &&
    other.species == species &&
    other.thumbnailPath == thumbnailPath &&
    other.type == type &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (birthDate == null ? 0 : birthDate!.hashCode) +
    (color == null ? 0 : color!.hashCode) +
    (familyRelationLabel == null ? 0 : familyRelationLabel!.hashCode) +
    (filterId == null ? 0 : filterId!.hashCode) +
    (id.hashCode) +
    (isFavorite == null ? 0 : isFavorite!.hashCode) +
    (isHidden.hashCode) +
    (name.hashCode) +
    (numberOfAssets == null ? 0 : numberOfAssets!.hashCode) +
    (primaryProfile == null ? 0 : primaryProfile!.hashCode) +
    (spacePersonId == null ? 0 : spacePersonId!.hashCode) +
    (species == null ? 0 : species!.hashCode) +
    (thumbnailPath.hashCode) +
    (type.hashCode) +
    (updatedAt == null ? 0 : updatedAt!.hashCode);

  @override
  String toString() => 'PersonResponseDto[birthDate=$birthDate, color=$color, familyRelationLabel=$familyRelationLabel, filterId=$filterId, id=$id, isFavorite=$isFavorite, isHidden=$isHidden, name=$name, numberOfAssets=$numberOfAssets, primaryProfile=$primaryProfile, spacePersonId=$spacePersonId, species=$species, thumbnailPath=$thumbnailPath, type=$type, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.birthDate != null) {
      json[r'birthDate'] = _dateFormatter.format(this.birthDate!);
    } else {
      json[r'birthDate'] = null;
    }
    if (this.color.isPresent) {
      final value = this.color.value;
      json[r'color'] = value;
    }
    if (this.familyRelationLabel.isPresent) {
      final value = this.familyRelationLabel.value;
      json[r'familyRelationLabel'] = value;
    }
    if (this.filterId.isPresent) {
      final value = this.filterId.value;
      json[r'filterId'] = value;
    }
      json[r'id'] = this.id;
    if (this.isFavorite.isPresent) {
      final value = this.isFavorite.value;
      json[r'isFavorite'] = value;
    }
      json[r'isHidden'] = this.isHidden;
      json[r'name'] = this.name;
    if (this.numberOfAssets.isPresent) {
      final value = this.numberOfAssets.value;
      json[r'numberOfAssets'] = value;
    }
    if (this.primaryProfile.isPresent) {
      final value = this.primaryProfile.value;
      json[r'primaryProfile'] = value;
    }
    if (this.spacePersonId.isPresent) {
      final value = this.spacePersonId.value;
      json[r'spacePersonId'] = value;
    }
    if (this.species.isPresent) {
      final value = this.species.value;
      json[r'species'] = value;
    }
      json[r'thumbnailPath'] = this.thumbnailPath;
    if (this.type.isPresent) {
      final value = this.type.value;
      json[r'type'] = value;
    }
    if (this.updatedAt.isPresent) {
      final value = this.updatedAt.value;
      json[r'updatedAt'] = value == null ? null : value.toUtc().toIso8601String();
    }
    return json;
  }

  /// Returns a new [PersonResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PersonResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "PersonResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return PersonResponseDto(
        birthDate: mapDateTime(json, r'birthDate', r''),
        color: json.containsKey(r'color') ? Optional.present(mapValueOfType<String>(json, r'color')) : const Optional.absent(),
        familyRelationLabel: json.containsKey(r'familyRelationLabel') ? Optional.present(mapValueOfType<String>(json, r'familyRelationLabel')) : const Optional.absent(),
        filterId: json.containsKey(r'filterId') ? Optional.present(mapValueOfType<String>(json, r'filterId')) : const Optional.absent(),
        id: mapValueOfType<String>(json, r'id')!,
        isFavorite: json.containsKey(r'isFavorite') ? Optional.present(mapValueOfType<bool>(json, r'isFavorite')) : const Optional.absent(),
        isHidden: mapValueOfType<bool>(json, r'isHidden')!,
        name: mapValueOfType<String>(json, r'name')!,
        numberOfAssets: json.containsKey(r'numberOfAssets') ? Optional.present(json[r'numberOfAssets'] == null ? null : int.parse('${json[r'numberOfAssets']}')) : const Optional.absent(),
        primaryProfile: json.containsKey(r'primaryProfile') ? Optional.present(ScopedPrimaryProfile.fromJson(json[r'primaryProfile'])) : const Optional.absent(),
        spacePersonId: json.containsKey(r'spacePersonId') ? Optional.present(mapValueOfType<String>(json, r'spacePersonId')) : const Optional.absent(),
        species: json.containsKey(r'species') ? Optional.present(mapValueOfType<String>(json, r'species')) : const Optional.absent(),
        thumbnailPath: mapValueOfType<String>(json, r'thumbnailPath')!,
        type: json.containsKey(r'type') ? Optional.present(mapValueOfType<String>(json, r'type')) : const Optional.absent(),
        updatedAt: json.containsKey(r'updatedAt') ? Optional.present(mapDateTime(json, r'updatedAt', r'')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<PersonResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PersonResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PersonResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PersonResponseDto> mapFromJson(dynamic json) {
    final map = <String, PersonResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PersonResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PersonResponseDto-objects as value to a dart map
  static Map<String, List<PersonResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PersonResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PersonResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'birthDate',
    'id',
    'isHidden',
    'name',
    'thumbnailPath',
  };
}


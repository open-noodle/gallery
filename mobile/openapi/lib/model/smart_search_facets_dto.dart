//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SmartSearchFacetsDto {
  /// Returns a new [SmartSearchFacetsDto] instance.
  SmartSearchFacetsDto({
    this.city = const Optional.absent(),
    this.country = const Optional.absent(),
    this.isFavorite = const Optional.absent(),
    this.isNotInAlbum = const Optional.absent(),
    this.language = const Optional.absent(),
    this.make = const Optional.absent(),
    this.model = const Optional.absent(),
    this.personIds = const Optional.present(const []),
    this.query = const Optional.absent(),
    this.queryAssetId = const Optional.absent(),
    this.rating = const Optional.absent(),
    this.spaceId = const Optional.absent(),
    this.spacePersonIds = const Optional.present(const []),
    this.tagIds = const Optional.present(const []),
    this.takenAfter = const Optional.absent(),
    this.takenBefore = const Optional.absent(),
    this.type = const Optional.absent(),
    this.withSharedSpaces = const Optional.absent(),
  });

  /// Filter by city name
  Optional<String?> city;

  /// Filter by country name
  Optional<String?> country;

  /// Filter by favorite status
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> isFavorite;

  /// Filter assets not in any album
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> isNotInAlbum;

  /// Search language code
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> language;

  /// Filter by camera make
  Optional<String?> make;

  /// Filter by camera model
  Optional<String?> model;

  /// Filter by person IDs
  Optional<List<String>?> personIds;

  /// Natural language search query
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> query;

  /// Asset ID to use as search reference
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> queryAssetId;

  /// Filter by rating [1-5], or null for unrated
  ///
  /// Minimum value: 1
  /// Maximum value: 5
  Optional<int?> rating;

  /// Shared space ID to filter by
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> spaceId;

  /// Shared space person IDs to filter by
  Optional<List<String>?> spacePersonIds;

  /// Filter by tag IDs
  Optional<List<String>?> tagIds;

  /// Filter by taken date (after)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> takenAfter;

  /// Filter by taken date (before)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> takenBefore;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AssetTypeEnum?> type;

  /// Include shared spaces the user is a member of
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> withSharedSpaces;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SmartSearchFacetsDto &&
    other.city == city &&
    other.country == country &&
    other.isFavorite == isFavorite &&
    other.isNotInAlbum == isNotInAlbum &&
    other.language == language &&
    other.make == make &&
    other.model == model &&
    _deepEquality.equals(other.personIds, personIds) &&
    other.query == query &&
    other.queryAssetId == queryAssetId &&
    other.rating == rating &&
    other.spaceId == spaceId &&
    _deepEquality.equals(other.spacePersonIds, spacePersonIds) &&
    _deepEquality.equals(other.tagIds, tagIds) &&
    other.takenAfter == takenAfter &&
    other.takenBefore == takenBefore &&
    other.type == type &&
    other.withSharedSpaces == withSharedSpaces;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (city == null ? 0 : city!.hashCode) +
    (country == null ? 0 : country!.hashCode) +
    (isFavorite == null ? 0 : isFavorite!.hashCode) +
    (isNotInAlbum == null ? 0 : isNotInAlbum!.hashCode) +
    (language == null ? 0 : language!.hashCode) +
    (make == null ? 0 : make!.hashCode) +
    (model == null ? 0 : model!.hashCode) +
    (personIds.hashCode) +
    (query == null ? 0 : query!.hashCode) +
    (queryAssetId == null ? 0 : queryAssetId!.hashCode) +
    (rating == null ? 0 : rating!.hashCode) +
    (spaceId == null ? 0 : spaceId!.hashCode) +
    (spacePersonIds.hashCode) +
    (tagIds == null ? 0 : tagIds!.hashCode) +
    (takenAfter == null ? 0 : takenAfter!.hashCode) +
    (takenBefore == null ? 0 : takenBefore!.hashCode) +
    (type == null ? 0 : type!.hashCode) +
    (withSharedSpaces == null ? 0 : withSharedSpaces!.hashCode);

  @override
  String toString() => 'SmartSearchFacetsDto[city=$city, country=$country, isFavorite=$isFavorite, isNotInAlbum=$isNotInAlbum, language=$language, make=$make, model=$model, personIds=$personIds, query=$query, queryAssetId=$queryAssetId, rating=$rating, spaceId=$spaceId, spacePersonIds=$spacePersonIds, tagIds=$tagIds, takenAfter=$takenAfter, takenBefore=$takenBefore, type=$type, withSharedSpaces=$withSharedSpaces]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.city.isPresent) {
      final value = this.city.value;
      json[r'city'] = value;
    }
    if (this.country.isPresent) {
      final value = this.country.value;
      json[r'country'] = value;
    }
    if (this.isFavorite.isPresent) {
      final value = this.isFavorite.value;
      json[r'isFavorite'] = value;
    }
    if (this.isNotInAlbum.isPresent) {
      final value = this.isNotInAlbum.value;
      json[r'isNotInAlbum'] = value;
    }
    if (this.language.isPresent) {
      final value = this.language.value;
      json[r'language'] = value;
    }
    if (this.make.isPresent) {
      final value = this.make.value;
      json[r'make'] = value;
    }
    if (this.model.isPresent) {
      final value = this.model.value;
      json[r'model'] = value;
    }
    if (this.personIds.isPresent) {
      final value = this.personIds.value;
      json[r'personIds'] = value;
    }
    if (this.query.isPresent) {
      final value = this.query.value;
      json[r'query'] = value;
    }
    if (this.queryAssetId.isPresent) {
      final value = this.queryAssetId.value;
      json[r'queryAssetId'] = value;
    }
    if (this.rating.isPresent) {
      final value = this.rating.value;
      json[r'rating'] = value;
    }
    if (this.spaceId.isPresent) {
      final value = this.spaceId.value;
      json[r'spaceId'] = value;
    }
    if (this.spacePersonIds.isPresent) {
      final value = this.spacePersonIds.value;
      json[r'spacePersonIds'] = value;
    }
    if (this.tagIds.isPresent) {
      final value = this.tagIds.value;
      json[r'tagIds'] = value;
    }
    if (this.takenAfter.isPresent) {
      final value = this.takenAfter.value;
      json[r'takenAfter'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.takenBefore.isPresent) {
      final value = this.takenBefore.value;
      json[r'takenBefore'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.type.isPresent) {
      final value = this.type.value;
      json[r'type'] = value;
    }
    if (this.withSharedSpaces.isPresent) {
      final value = this.withSharedSpaces.value;
      json[r'withSharedSpaces'] = value;
    }
    return json;
  }

  /// Returns a new [SmartSearchFacetsDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SmartSearchFacetsDto? fromJson(dynamic value) {
    upgradeDto(value, "SmartSearchFacetsDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SmartSearchFacetsDto(
        city: json.containsKey(r'city') ? Optional.present(mapValueOfType<String>(json, r'city')) : const Optional.absent(),
        country: json.containsKey(r'country') ? Optional.present(mapValueOfType<String>(json, r'country')) : const Optional.absent(),
        isFavorite: json.containsKey(r'isFavorite') ? Optional.present(mapValueOfType<bool>(json, r'isFavorite')) : const Optional.absent(),
        isNotInAlbum: json.containsKey(r'isNotInAlbum') ? Optional.present(mapValueOfType<bool>(json, r'isNotInAlbum')) : const Optional.absent(),
        language: json.containsKey(r'language') ? Optional.present(mapValueOfType<String>(json, r'language')) : const Optional.absent(),
        make: json.containsKey(r'make') ? Optional.present(mapValueOfType<String>(json, r'make')) : const Optional.absent(),
        model: json.containsKey(r'model') ? Optional.present(mapValueOfType<String>(json, r'model')) : const Optional.absent(),
        personIds: json.containsKey(r'personIds') ? Optional.present(json[r'personIds'] is Iterable
            ? (json[r'personIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        query: json.containsKey(r'query') ? Optional.present(mapValueOfType<String>(json, r'query')) : const Optional.absent(),
        queryAssetId: json.containsKey(r'queryAssetId') ? Optional.present(mapValueOfType<String>(json, r'queryAssetId')) : const Optional.absent(),
        rating: json.containsKey(r'rating') ? Optional.present(json[r'rating'] == null ? null : int.parse('${json[r'rating']}')) : const Optional.absent(),
        spaceId: json.containsKey(r'spaceId') ? Optional.present(mapValueOfType<String>(json, r'spaceId')) : const Optional.absent(),
        spacePersonIds: json.containsKey(r'spacePersonIds') ? Optional.present(json[r'spacePersonIds'] is Iterable
            ? (json[r'spacePersonIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        tagIds: json.containsKey(r'tagIds') ? Optional.present(json[r'tagIds'] is Iterable
            ? (json[r'tagIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        takenAfter: json.containsKey(r'takenAfter') ? Optional.present(mapDateTime(json, r'takenAfter', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        takenBefore: json.containsKey(r'takenBefore') ? Optional.present(mapDateTime(json, r'takenBefore', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        type: json.containsKey(r'type') ? Optional.present(AssetTypeEnum.fromJson(json[r'type'])) : const Optional.absent(),
        withSharedSpaces: json.containsKey(r'withSharedSpaces') ? Optional.present(mapValueOfType<bool>(json, r'withSharedSpaces')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<SmartSearchFacetsDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SmartSearchFacetsDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SmartSearchFacetsDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SmartSearchFacetsDto> mapFromJson(dynamic json) {
    final map = <String, SmartSearchFacetsDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SmartSearchFacetsDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SmartSearchFacetsDto-objects as value to a dart map
  static Map<String, List<SmartSearchFacetsDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SmartSearchFacetsDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SmartSearchFacetsDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


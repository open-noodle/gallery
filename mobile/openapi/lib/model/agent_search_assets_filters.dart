//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetsFilters {
  /// Returns a new [AgentSearchAssetsFilters] instance.
  AgentSearchAssetsFilters({
    this.albumIds = const Optional.present(const []),
    this.albumMatchAny = const Optional.absent(),
    this.city = const Optional.absent(),
    this.country = const Optional.absent(),
    this.createdAfter = const Optional.absent(),
    this.createdBefore = const Optional.absent(),
    this.isFavorite = const Optional.absent(),
    this.isNotInAlbum = const Optional.absent(),
    this.isTrashed = const Optional.absent(),
    this.lensModel = const Optional.absent(),
    this.make = const Optional.absent(),
    this.maxBrightness = const Optional.absent(),
    this.maxQuality = const Optional.absent(),
    this.maxSharpness = const Optional.absent(),
    this.model = const Optional.absent(),
    this.personIds = const Optional.present(const []),
    this.personMatchAny = const Optional.absent(),
    this.rating = const Optional.absent(),
    this.spaceId = const Optional.absent(),
    this.spacePersonIds = const Optional.present(const []),
    this.state = const Optional.absent(),
    this.tagIds = const Optional.present(const []),
    this.tagMatchAny = const Optional.absent(),
    this.takenAfter = const Optional.absent(),
    this.takenBefore = const Optional.absent(),
    this.type = const Optional.absent(),
    this.updatedAfter = const Optional.absent(),
    this.updatedBefore = const Optional.absent(),
    this.visibility = const Optional.absent(),
    this.withSharedSpaces = const Optional.absent(),
  });

  Optional<List<String>?> albumIds;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> albumMatchAny;

  Optional<String?> city;

  Optional<String?> country;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> createdAfter;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> createdBefore;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> isFavorite;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> isNotInAlbum;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> isTrashed;

  Optional<String?> lensModel;

  Optional<String?> make;

  /// Minimum value: 0
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> maxBrightness;

  /// Minimum value: 0
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> maxQuality;

  /// Minimum value: 0
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> maxSharpness;

  Optional<String?> model;

  Optional<List<String>?> personIds;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> personMatchAny;

  /// Minimum value: 1
  /// Maximum value: 5
  Optional<int?> rating;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> spaceId;

  Optional<List<String>?> spacePersonIds;

  Optional<String?> state;

  Optional<List<String>?> tagIds;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> tagMatchAny;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> takenAfter;

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

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> updatedAfter;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> updatedBefore;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AssetVisibility?> visibility;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> withSharedSpaces;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetsFilters &&
    _deepEquality.equals(other.albumIds, albumIds) &&
    other.albumMatchAny == albumMatchAny &&
    other.city == city &&
    other.country == country &&
    other.createdAfter == createdAfter &&
    other.createdBefore == createdBefore &&
    other.isFavorite == isFavorite &&
    other.isNotInAlbum == isNotInAlbum &&
    other.isTrashed == isTrashed &&
    other.lensModel == lensModel &&
    other.make == make &&
    other.maxBrightness == maxBrightness &&
    other.maxQuality == maxQuality &&
    other.maxSharpness == maxSharpness &&
    other.model == model &&
    _deepEquality.equals(other.personIds, personIds) &&
    other.personMatchAny == personMatchAny &&
    other.rating == rating &&
    other.spaceId == spaceId &&
    _deepEquality.equals(other.spacePersonIds, spacePersonIds) &&
    other.state == state &&
    _deepEquality.equals(other.tagIds, tagIds) &&
    other.tagMatchAny == tagMatchAny &&
    other.takenAfter == takenAfter &&
    other.takenBefore == takenBefore &&
    other.type == type &&
    other.updatedAfter == updatedAfter &&
    other.updatedBefore == updatedBefore &&
    other.visibility == visibility &&
    other.withSharedSpaces == withSharedSpaces;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albumIds.hashCode) +
    (albumMatchAny == null ? 0 : albumMatchAny!.hashCode) +
    (city == null ? 0 : city!.hashCode) +
    (country == null ? 0 : country!.hashCode) +
    (createdAfter == null ? 0 : createdAfter!.hashCode) +
    (createdBefore == null ? 0 : createdBefore!.hashCode) +
    (isFavorite == null ? 0 : isFavorite!.hashCode) +
    (isNotInAlbum == null ? 0 : isNotInAlbum!.hashCode) +
    (isTrashed == null ? 0 : isTrashed!.hashCode) +
    (lensModel == null ? 0 : lensModel!.hashCode) +
    (make == null ? 0 : make!.hashCode) +
    (maxBrightness == null ? 0 : maxBrightness!.hashCode) +
    (maxQuality == null ? 0 : maxQuality!.hashCode) +
    (maxSharpness == null ? 0 : maxSharpness!.hashCode) +
    (model == null ? 0 : model!.hashCode) +
    (personIds.hashCode) +
    (personMatchAny == null ? 0 : personMatchAny!.hashCode) +
    (rating == null ? 0 : rating!.hashCode) +
    (spaceId == null ? 0 : spaceId!.hashCode) +
    (spacePersonIds.hashCode) +
    (state == null ? 0 : state!.hashCode) +
    (tagIds.hashCode) +
    (tagMatchAny == null ? 0 : tagMatchAny!.hashCode) +
    (takenAfter == null ? 0 : takenAfter!.hashCode) +
    (takenBefore == null ? 0 : takenBefore!.hashCode) +
    (type == null ? 0 : type!.hashCode) +
    (updatedAfter == null ? 0 : updatedAfter!.hashCode) +
    (updatedBefore == null ? 0 : updatedBefore!.hashCode) +
    (visibility == null ? 0 : visibility!.hashCode) +
    (withSharedSpaces == null ? 0 : withSharedSpaces!.hashCode);

  @override
  String toString() => 'AgentSearchAssetsFilters[albumIds=$albumIds, albumMatchAny=$albumMatchAny, city=$city, country=$country, createdAfter=$createdAfter, createdBefore=$createdBefore, isFavorite=$isFavorite, isNotInAlbum=$isNotInAlbum, isTrashed=$isTrashed, lensModel=$lensModel, make=$make, maxBrightness=$maxBrightness, maxQuality=$maxQuality, maxSharpness=$maxSharpness, model=$model, personIds=$personIds, personMatchAny=$personMatchAny, rating=$rating, spaceId=$spaceId, spacePersonIds=$spacePersonIds, state=$state, tagIds=$tagIds, tagMatchAny=$tagMatchAny, takenAfter=$takenAfter, takenBefore=$takenBefore, type=$type, updatedAfter=$updatedAfter, updatedBefore=$updatedBefore, visibility=$visibility, withSharedSpaces=$withSharedSpaces]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.albumIds.isPresent) {
      final value = this.albumIds.value;
      json[r'albumIds'] = value;
    }
    if (this.albumMatchAny.isPresent) {
      final value = this.albumMatchAny.value;
      json[r'albumMatchAny'] = value;
    }
    if (this.city.isPresent) {
      final value = this.city.value;
      json[r'city'] = value;
    }
    if (this.country.isPresent) {
      final value = this.country.value;
      json[r'country'] = value;
    }
    if (this.createdAfter.isPresent) {
      final value = this.createdAfter.value;
      json[r'createdAfter'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.createdBefore.isPresent) {
      final value = this.createdBefore.value;
      json[r'createdBefore'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.isFavorite.isPresent) {
      final value = this.isFavorite.value;
      json[r'isFavorite'] = value;
    }
    if (this.isNotInAlbum.isPresent) {
      final value = this.isNotInAlbum.value;
      json[r'isNotInAlbum'] = value;
    }
    if (this.isTrashed.isPresent) {
      final value = this.isTrashed.value;
      json[r'isTrashed'] = value;
    }
    if (this.lensModel.isPresent) {
      final value = this.lensModel.value;
      json[r'lensModel'] = value;
    }
    if (this.make.isPresent) {
      final value = this.make.value;
      json[r'make'] = value;
    }
    if (this.maxBrightness.isPresent) {
      final value = this.maxBrightness.value;
      json[r'maxBrightness'] = value;
    }
    if (this.maxQuality.isPresent) {
      final value = this.maxQuality.value;
      json[r'maxQuality'] = value;
    }
    if (this.maxSharpness.isPresent) {
      final value = this.maxSharpness.value;
      json[r'maxSharpness'] = value;
    }
    if (this.model.isPresent) {
      final value = this.model.value;
      json[r'model'] = value;
    }
    if (this.personIds.isPresent) {
      final value = this.personIds.value;
      json[r'personIds'] = value;
    }
    if (this.personMatchAny.isPresent) {
      final value = this.personMatchAny.value;
      json[r'personMatchAny'] = value;
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
    if (this.state.isPresent) {
      final value = this.state.value;
      json[r'state'] = value;
    }
    if (this.tagIds.isPresent) {
      final value = this.tagIds.value;
      json[r'tagIds'] = value;
    }
    if (this.tagMatchAny.isPresent) {
      final value = this.tagMatchAny.value;
      json[r'tagMatchAny'] = value;
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
    if (this.updatedAfter.isPresent) {
      final value = this.updatedAfter.value;
      json[r'updatedAfter'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.updatedBefore.isPresent) {
      final value = this.updatedBefore.value;
      json[r'updatedBefore'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.visibility.isPresent) {
      final value = this.visibility.value;
      json[r'visibility'] = value;
    }
    if (this.withSharedSpaces.isPresent) {
      final value = this.withSharedSpaces.value;
      json[r'withSharedSpaces'] = value;
    }
    return json;
  }

  /// Returns a new [AgentSearchAssetsFilters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetsFilters? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetsFilters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetsFilters(
        albumIds: json.containsKey(r'albumIds') ? Optional.present(json[r'albumIds'] is Iterable
            ? (json[r'albumIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        albumMatchAny: json.containsKey(r'albumMatchAny') ? Optional.present(mapValueOfType<bool>(json, r'albumMatchAny')) : const Optional.absent(),
        city: json.containsKey(r'city') ? Optional.present(mapValueOfType<String>(json, r'city')) : const Optional.absent(),
        country: json.containsKey(r'country') ? Optional.present(mapValueOfType<String>(json, r'country')) : const Optional.absent(),
        createdAfter: json.containsKey(r'createdAfter') ? Optional.present(mapDateTime(json, r'createdAfter', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        createdBefore: json.containsKey(r'createdBefore') ? Optional.present(mapDateTime(json, r'createdBefore', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        isFavorite: json.containsKey(r'isFavorite') ? Optional.present(mapValueOfType<bool>(json, r'isFavorite')) : const Optional.absent(),
        isNotInAlbum: json.containsKey(r'isNotInAlbum') ? Optional.present(mapValueOfType<bool>(json, r'isNotInAlbum')) : const Optional.absent(),
        isTrashed: json.containsKey(r'isTrashed') ? Optional.present(mapValueOfType<bool>(json, r'isTrashed')) : const Optional.absent(),
        lensModel: json.containsKey(r'lensModel') ? Optional.present(mapValueOfType<String>(json, r'lensModel')) : const Optional.absent(),
        make: json.containsKey(r'make') ? Optional.present(mapValueOfType<String>(json, r'make')) : const Optional.absent(),
        maxBrightness: json.containsKey(r'maxBrightness') ? Optional.present(json[r'maxBrightness'] == null ? null : int.parse('${json[r'maxBrightness']}')) : const Optional.absent(),
        maxQuality: json.containsKey(r'maxQuality') ? Optional.present(json[r'maxQuality'] == null ? null : int.parse('${json[r'maxQuality']}')) : const Optional.absent(),
        maxSharpness: json.containsKey(r'maxSharpness') ? Optional.present(json[r'maxSharpness'] == null ? null : int.parse('${json[r'maxSharpness']}')) : const Optional.absent(),
        model: json.containsKey(r'model') ? Optional.present(mapValueOfType<String>(json, r'model')) : const Optional.absent(),
        personIds: json.containsKey(r'personIds') ? Optional.present(json[r'personIds'] is Iterable
            ? (json[r'personIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        personMatchAny: json.containsKey(r'personMatchAny') ? Optional.present(mapValueOfType<bool>(json, r'personMatchAny')) : const Optional.absent(),
        rating: json.containsKey(r'rating') ? Optional.present(json[r'rating'] == null ? null : int.parse('${json[r'rating']}')) : const Optional.absent(),
        spaceId: json.containsKey(r'spaceId') ? Optional.present(mapValueOfType<String>(json, r'spaceId')) : const Optional.absent(),
        spacePersonIds: json.containsKey(r'spacePersonIds') ? Optional.present(json[r'spacePersonIds'] is Iterable
            ? (json[r'spacePersonIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        state: json.containsKey(r'state') ? Optional.present(mapValueOfType<String>(json, r'state')) : const Optional.absent(),
        tagIds: json.containsKey(r'tagIds') ? Optional.present(json[r'tagIds'] is Iterable
            ? (json[r'tagIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        tagMatchAny: json.containsKey(r'tagMatchAny') ? Optional.present(mapValueOfType<bool>(json, r'tagMatchAny')) : const Optional.absent(),
        takenAfter: json.containsKey(r'takenAfter') ? Optional.present(mapDateTime(json, r'takenAfter', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        takenBefore: json.containsKey(r'takenBefore') ? Optional.present(mapDateTime(json, r'takenBefore', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        type: json.containsKey(r'type') ? Optional.present(AssetTypeEnum.fromJson(json[r'type'])) : const Optional.absent(),
        updatedAfter: json.containsKey(r'updatedAfter') ? Optional.present(mapDateTime(json, r'updatedAfter', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        updatedBefore: json.containsKey(r'updatedBefore') ? Optional.present(mapDateTime(json, r'updatedBefore', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        visibility: json.containsKey(r'visibility') ? Optional.present(AssetVisibility.fromJson(json[r'visibility'])) : const Optional.absent(),
        withSharedSpaces: json.containsKey(r'withSharedSpaces') ? Optional.present(mapValueOfType<bool>(json, r'withSharedSpaces')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentSearchAssetsFilters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsFilters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsFilters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetsFilters> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetsFilters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetsFilters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetsFilters-objects as value to a dart map
  static Map<String, List<AgentSearchAssetsFilters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetsFilters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetsFilters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


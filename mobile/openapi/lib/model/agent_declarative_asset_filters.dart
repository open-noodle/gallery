//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentDeclarativeAssetFilters {
  /// Returns a new [AgentDeclarativeAssetFilters] instance.
  AgentDeclarativeAssetFilters({
    this.albums = const Optional.absent(),
    this.camera = const Optional.absent(),
    this.city = const Optional.absent(),
    this.country = const Optional.absent(),
    this.isFavorite = const Optional.absent(),
    this.isNotInAlbum = const Optional.absent(),
    this.people = const Optional.absent(),
    this.rating = const Optional.absent(),
    this.space = const Optional.absent(),
    this.state = const Optional.absent(),
    this.tags = const Optional.absent(),
    this.takenAfter = const Optional.absent(),
    this.takenBefore = const Optional.absent(),
    this.type = const Optional.absent(),
    this.visibility = const Optional.absent(),
    this.withSharedSpaces = const Optional.absent(),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentDeclarativeNamedFilter?> albums;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentDeclarativeCameraFilter?> camera;

  Optional<String?> city;

  Optional<String?> country;

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
  Optional<AgentDeclarativeNamedFilter?> people;

  /// Minimum value: 1
  /// Maximum value: 5
  Optional<int?> rating;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentDeclarativeSpaceFilter?> space;

  Optional<String?> state;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentDeclarativeNamedFilter?> tags;

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
  Optional<AssetVisibility?> visibility;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> withSharedSpaces;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentDeclarativeAssetFilters &&
    other.albums == albums &&
    other.camera == camera &&
    other.city == city &&
    other.country == country &&
    other.isFavorite == isFavorite &&
    other.isNotInAlbum == isNotInAlbum &&
    other.people == people &&
    other.rating == rating &&
    other.space == space &&
    other.state == state &&
    other.tags == tags &&
    other.takenAfter == takenAfter &&
    other.takenBefore == takenBefore &&
    other.type == type &&
    other.visibility == visibility &&
    other.withSharedSpaces == withSharedSpaces;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albums == null ? 0 : albums!.hashCode) +
    (camera == null ? 0 : camera!.hashCode) +
    (city == null ? 0 : city!.hashCode) +
    (country == null ? 0 : country!.hashCode) +
    (isFavorite == null ? 0 : isFavorite!.hashCode) +
    (isNotInAlbum == null ? 0 : isNotInAlbum!.hashCode) +
    (people == null ? 0 : people!.hashCode) +
    (rating == null ? 0 : rating!.hashCode) +
    (space == null ? 0 : space!.hashCode) +
    (state == null ? 0 : state!.hashCode) +
    (tags == null ? 0 : tags!.hashCode) +
    (takenAfter == null ? 0 : takenAfter!.hashCode) +
    (takenBefore == null ? 0 : takenBefore!.hashCode) +
    (type == null ? 0 : type!.hashCode) +
    (visibility == null ? 0 : visibility!.hashCode) +
    (withSharedSpaces == null ? 0 : withSharedSpaces!.hashCode);

  @override
  String toString() => 'AgentDeclarativeAssetFilters[albums=$albums, camera=$camera, city=$city, country=$country, isFavorite=$isFavorite, isNotInAlbum=$isNotInAlbum, people=$people, rating=$rating, space=$space, state=$state, tags=$tags, takenAfter=$takenAfter, takenBefore=$takenBefore, type=$type, visibility=$visibility, withSharedSpaces=$withSharedSpaces]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.albums.isPresent) {
      final value = this.albums.value;
      json[r'albums'] = value;
    }
    if (this.camera.isPresent) {
      final value = this.camera.value;
      json[r'camera'] = value;
    }
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
    if (this.people.isPresent) {
      final value = this.people.value;
      json[r'people'] = value;
    }
    if (this.rating.isPresent) {
      final value = this.rating.value;
      json[r'rating'] = value;
    }
    if (this.space.isPresent) {
      final value = this.space.value;
      json[r'space'] = value;
    }
    if (this.state.isPresent) {
      final value = this.state.value;
      json[r'state'] = value;
    }
    if (this.tags.isPresent) {
      final value = this.tags.value;
      json[r'tags'] = value;
    }
    if (this.takenAfter.isPresent) {
      final value = this.takenAfter.value;
      json[r'takenAfter'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.takenBefore.isPresent) {
      final value = this.takenBefore.value;
      json[r'takenBefore'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.type.isPresent) {
      final value = this.type.value;
      json[r'type'] = value;
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

  /// Returns a new [AgentDeclarativeAssetFilters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentDeclarativeAssetFilters? fromJson(dynamic value) {
    upgradeDto(value, "AgentDeclarativeAssetFilters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentDeclarativeAssetFilters(
        albums: json.containsKey(r'albums') ? Optional.present(AgentDeclarativeNamedFilter.fromJson(json[r'albums'])) : const Optional.absent(),
        camera: json.containsKey(r'camera') ? Optional.present(AgentDeclarativeCameraFilter.fromJson(json[r'camera'])) : const Optional.absent(),
        city: json.containsKey(r'city') ? Optional.present(mapValueOfType<String>(json, r'city')) : const Optional.absent(),
        country: json.containsKey(r'country') ? Optional.present(mapValueOfType<String>(json, r'country')) : const Optional.absent(),
        isFavorite: json.containsKey(r'isFavorite') ? Optional.present(mapValueOfType<bool>(json, r'isFavorite')) : const Optional.absent(),
        isNotInAlbum: json.containsKey(r'isNotInAlbum') ? Optional.present(mapValueOfType<bool>(json, r'isNotInAlbum')) : const Optional.absent(),
        people: json.containsKey(r'people') ? Optional.present(AgentDeclarativeNamedFilter.fromJson(json[r'people'])) : const Optional.absent(),
        rating: json.containsKey(r'rating') ? Optional.present(json[r'rating'] == null ? null : int.parse('${json[r'rating']}')) : const Optional.absent(),
        space: json.containsKey(r'space') ? Optional.present(AgentDeclarativeSpaceFilter.fromJson(json[r'space'])) : const Optional.absent(),
        state: json.containsKey(r'state') ? Optional.present(mapValueOfType<String>(json, r'state')) : const Optional.absent(),
        tags: json.containsKey(r'tags') ? Optional.present(AgentDeclarativeNamedFilter.fromJson(json[r'tags'])) : const Optional.absent(),
        takenAfter: json.containsKey(r'takenAfter') ? Optional.present(mapDateTime(json, r'takenAfter', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$/')) : const Optional.absent(),
        takenBefore: json.containsKey(r'takenBefore') ? Optional.present(mapDateTime(json, r'takenBefore', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$/')) : const Optional.absent(),
        type: json.containsKey(r'type') ? Optional.present(AssetTypeEnum.fromJson(json[r'type'])) : const Optional.absent(),
        visibility: json.containsKey(r'visibility') ? Optional.present(AssetVisibility.fromJson(json[r'visibility'])) : const Optional.absent(),
        withSharedSpaces: json.containsKey(r'withSharedSpaces') ? Optional.present(mapValueOfType<bool>(json, r'withSharedSpaces')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentDeclarativeAssetFilters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentDeclarativeAssetFilters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentDeclarativeAssetFilters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentDeclarativeAssetFilters> mapFromJson(dynamic json) {
    final map = <String, AgentDeclarativeAssetFilters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentDeclarativeAssetFilters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentDeclarativeAssetFilters-objects as value to a dart map
  static Map<String, List<AgentDeclarativeAssetFilters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentDeclarativeAssetFilters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentDeclarativeAssetFilters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


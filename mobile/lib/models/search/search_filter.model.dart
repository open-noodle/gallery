// ignore_for_file: public_member_api_docs, sort_constructors_first
import 'dart:convert';

import 'package:collection/collection.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/utils/option.dart';

class SearchLocationFilter {
  String? country;
  String? state;
  String? city;
  String? locationPresence;
  SearchLocationFilter({this.country, this.state, this.city, this.locationPresence});

  SearchLocationFilter copyWith({String? country, String? state, String? city, String? locationPresence}) {
    return SearchLocationFilter(
      country: country ?? this.country,
      state: state ?? this.state,
      city: city ?? this.city,
      locationPresence: locationPresence ?? this.locationPresence,
    );
  }

  Map<String, dynamic> toMap() {
    return <String, dynamic>{'country': country, 'state': state, 'city': city, 'locationPresence': locationPresence};
  }

  factory SearchLocationFilter.fromMap(Map<String, dynamic> map) {
    return SearchLocationFilter(
      country: map['country'] != null ? map['country'] as String : null,
      state: map['state'] != null ? map['state'] as String : null,
      city: map['city'] != null ? map['city'] as String : null,
      locationPresence: map['locationPresence'] != null ? map['locationPresence'] as String : null,
    );
  }

  String toJson() => json.encode(toMap());

  factory SearchLocationFilter.fromJson(String source) =>
      SearchLocationFilter.fromMap(json.decode(source) as Map<String, dynamic>);

  @override
  String toString() =>
      'SearchLocationFilter(country: $country, state: $state, city: $city, locationPresence: $locationPresence)';

  @override
  bool operator ==(covariant SearchLocationFilter other) {
    if (identical(this, other)) {
      return true;
    }

    return other.country == country &&
        other.state == state &&
        other.city == city &&
        other.locationPresence == locationPresence;
  }

  @override
  int get hashCode => country.hashCode ^ state.hashCode ^ city.hashCode ^ locationPresence.hashCode;
}

class SearchCameraFilter {
  String? make;
  String? model;
  SearchCameraFilter({this.make, this.model});

  SearchCameraFilter copyWith({String? make, String? model}) {
    return SearchCameraFilter(make: make ?? this.make, model: model ?? this.model);
  }

  Map<String, dynamic> toMap() {
    return <String, dynamic>{'make': make, 'model': model};
  }

  factory SearchCameraFilter.fromMap(Map<String, dynamic> map) {
    return SearchCameraFilter(
      make: map['make'] != null ? map['make'] as String : null,
      model: map['model'] != null ? map['model'] as String : null,
    );
  }

  String toJson() => json.encode(toMap());

  factory SearchCameraFilter.fromJson(String source) =>
      SearchCameraFilter.fromMap(json.decode(source) as Map<String, dynamic>);

  @override
  String toString() => 'SearchCameraFilter(make: $make, model: $model)';

  @override
  bool operator ==(covariant SearchCameraFilter other) {
    if (identical(this, other)) {
      return true;
    }

    return other.make == make && other.model == model;
  }

  @override
  int get hashCode => make.hashCode ^ model.hashCode;
}

class SearchDateFilter {
  DateTime? takenBefore;
  DateTime? takenAfter;
  SearchDateFilter({this.takenBefore, this.takenAfter});

  SearchDateFilter copyWith({DateTime? takenBefore, DateTime? takenAfter}) {
    return SearchDateFilter(takenBefore: takenBefore ?? this.takenBefore, takenAfter: takenAfter ?? this.takenAfter);
  }

  Map<String, dynamic> toMap() {
    return <String, dynamic>{
      'takenBefore': takenBefore?.millisecondsSinceEpoch,
      'takenAfter': takenAfter?.millisecondsSinceEpoch,
    };
  }

  factory SearchDateFilter.fromMap(Map<String, dynamic> map) {
    return SearchDateFilter(
      takenBefore: map['takenBefore'] != null ? DateTime.fromMillisecondsSinceEpoch(map['takenBefore'] as int) : null,
      takenAfter: map['takenAfter'] != null ? DateTime.fromMillisecondsSinceEpoch(map['takenAfter'] as int) : null,
    );
  }

  String toJson() => json.encode(toMap());

  factory SearchDateFilter.fromJson(String source) =>
      SearchDateFilter.fromMap(json.decode(source) as Map<String, dynamic>);

  @override
  String toString() => 'SearchDateFilter(takenBefore: $takenBefore, takenAfter: $takenAfter)';

  @override
  bool operator ==(covariant SearchDateFilter other) {
    if (identical(this, other)) {
      return true;
    }

    return other.takenBefore == takenBefore && other.takenAfter == takenAfter;
  }

  @override
  int get hashCode => takenBefore.hashCode ^ takenAfter.hashCode;
}

class SearchRatingFilter {
  /// none = no filter; some(null) = filter for unrated; some(1-5) = filter for that rating
  Option<int?> rating;
  SearchRatingFilter({this.rating = const Option.none()});

  SearchRatingFilter copyWith({Option<int?>? rating}) {
    return SearchRatingFilter(rating: rating ?? this.rating);
  }

  Map<String, dynamic> toMap() {
    if (rating.isNone) {
      return <String, dynamic>{'active': false};
    }
    return <String, dynamic>{'active': true, 'value': rating.unwrapOrNull};
  }

  factory SearchRatingFilter.fromMap(Map<String, dynamic> map) {
    if (!(map['active'] as bool? ?? false)) {
      return SearchRatingFilter();
    }
    return SearchRatingFilter(rating: Option.some(map['value'] as int?));
  }

  String toJson() => json.encode(toMap());

  factory SearchRatingFilter.fromJson(String source) =>
      SearchRatingFilter.fromMap(json.decode(source) as Map<String, dynamic>);

  @override
  String toString() => 'SearchRatingFilter(rating: $rating)';

  @override
  bool operator ==(covariant SearchRatingFilter other) {
    if (identical(this, other)) {
      return true;
    }

    return other.rating == rating;
  }

  @override
  int get hashCode => rating.hashCode;
}

class SearchDisplayFilters {
  bool isNotInAlbum = false;
  bool isArchive = false;
  bool isFavorite = false;
  bool isUntagged = false;
  SearchDisplayFilters({
    required this.isNotInAlbum,
    required this.isArchive,
    required this.isFavorite,
    this.isUntagged = false,
  });

  SearchDisplayFilters copyWith({bool? isNotInAlbum, bool? isArchive, bool? isFavorite, bool? isUntagged}) {
    return SearchDisplayFilters(
      isNotInAlbum: isNotInAlbum ?? this.isNotInAlbum,
      isArchive: isArchive ?? this.isArchive,
      isFavorite: isFavorite ?? this.isFavorite,
      isUntagged: isUntagged ?? this.isUntagged,
    );
  }

  Map<String, dynamic> toMap() {
    return <String, dynamic>{
      'isNotInAlbum': isNotInAlbum,
      'isArchive': isArchive,
      'isFavorite': isFavorite,
      'isUntagged': isUntagged,
    };
  }

  factory SearchDisplayFilters.fromMap(Map<String, dynamic> map) {
    return SearchDisplayFilters(
      isNotInAlbum: map['isNotInAlbum'] as bool,
      isArchive: map['isArchive'] as bool,
      isFavorite: map['isFavorite'] as bool,
      isUntagged: map['isUntagged'] as bool? ?? false,
    );
  }

  String toJson() => json.encode(toMap());

  factory SearchDisplayFilters.fromJson(String source) =>
      SearchDisplayFilters.fromMap(json.decode(source) as Map<String, dynamic>);

  @override
  String toString() =>
      'SearchDisplayFilters(isNotInAlbum: $isNotInAlbum, isArchive: $isArchive, isFavorite: $isFavorite, isUntagged: $isUntagged)';

  @override
  bool operator ==(covariant SearchDisplayFilters other) {
    if (identical(this, other)) {
      return true;
    }

    return other.isNotInAlbum == isNotInAlbum &&
        other.isArchive == isArchive &&
        other.isFavorite == isFavorite &&
        other.isUntagged == isUntagged;
  }

  @override
  int get hashCode => isNotInAlbum.hashCode ^ isArchive.hashCode ^ isFavorite.hashCode ^ isUntagged.hashCode;
}

enum SearchSortOrder { relevance, newest, oldest }

class SearchFilter {
  String? context;
  String? filename;
  String? description;
  String? ocr;
  String? language;
  String? assetId;
  List<String>? tagIds;
  Set<PersonDto> people;
  SearchLocationFilter location;
  SearchCameraFilter camera;
  SearchDateFilter date;
  SearchRatingFilter rating;
  SearchDisplayFilters display;

  // Enum
  AssetType mediaType;
  SearchSortOrder sort;

  SearchFilter({
    this.context,
    this.filename,
    this.description,
    this.ocr,
    this.language,
    this.assetId,
    this.tagIds,
    required this.people,
    required this.location,
    required this.camera,
    required this.date,
    required this.display,
    required this.rating,
    required this.mediaType,
    this.sort = SearchSortOrder.relevance,
  });

  static SearchFilter empty() => SearchFilter(
    people: const {},
    location: SearchLocationFilter(),
    camera: SearchCameraFilter(),
    date: SearchDateFilter(),
    display: SearchDisplayFilters(isFavorite: false, isArchive: false, isNotInAlbum: false),
    rating: SearchRatingFilter(),
    mediaType: AssetType.other,
  );

  static const _setEq = SetEquality<PersonDto>();
  static const _listEq = ListEquality<String>();

  bool get isEmpty {
    return (context == null || (context != null && context!.isEmpty)) &&
        (filename == null || (filename!.isEmpty)) &&
        (description == null || (description!.isEmpty)) &&
        (assetId == null || (assetId!.isEmpty)) &&
        (ocr == null || (ocr!.isEmpty)) &&
        (tagIds ?? []).isEmpty &&
        people.isEmpty &&
        location.country == null &&
        location.state == null &&
        location.city == null &&
        location.locationPresence == null &&
        camera.make == null &&
        camera.model == null &&
        date.takenBefore == null &&
        date.takenAfter == null &&
        display.isNotInAlbum == false &&
        display.isArchive == false &&
        display.isFavorite == false &&
        display.isUntagged == false &&
        rating.rating.isNone &&
        mediaType == AssetType.other;
  }

  SearchFilter copyWith({
    String? context,
    String? filename,
    String? description,
    String? language,
    String? ocr,
    String? assetId,
    Set<PersonDto>? people,
    List<String>? tagIds,
    SearchLocationFilter? location,
    SearchCameraFilter? camera,
    SearchDateFilter? date,
    SearchDisplayFilters? display,
    SearchRatingFilter? rating,
    AssetType? mediaType,
    SearchSortOrder? sort,
  }) {
    return SearchFilter(
      context: context ?? this.context,
      filename: filename ?? this.filename,
      description: description ?? this.description,
      language: language ?? this.language,
      ocr: ocr ?? this.ocr,
      assetId: assetId ?? this.assetId,
      people: people ?? this.people,
      location: location ?? this.location,
      camera: camera ?? this.camera,
      date: date ?? this.date,
      display: display ?? this.display,
      rating: rating ?? this.rating,
      mediaType: mediaType ?? this.mediaType,
      tagIds: tagIds ?? this.tagIds,
      sort: sort ?? this.sort,
    );
  }

  @override
  String toString() {
    return 'SearchFilter(context: $context, filename: $filename, description: $description, language: $language, ocr: $ocr, people: $people, location: $location, tagIds: $tagIds, camera: $camera, date: $date, display: $display, rating: $rating, mediaType: $mediaType, assetId: $assetId, sort: $sort)';
  }

  @override
  bool operator ==(covariant SearchFilter other) {
    if (identical(this, other)) {
      return true;
    }

    return other.context == context &&
        other.filename == filename &&
        other.description == description &&
        other.language == language &&
        other.ocr == ocr &&
        other.assetId == assetId &&
        _setEq.equals(other.people, people) &&
        _listEq.equals(other.tagIds, tagIds) &&
        other.location == location &&
        other.camera == camera &&
        other.date == date &&
        other.display == display &&
        other.rating == rating &&
        other.mediaType == mediaType &&
        other.sort == sort;
  }

  @override
  int get hashCode {
    return context.hashCode ^
        filename.hashCode ^
        description.hashCode ^
        language.hashCode ^
        ocr.hashCode ^
        assetId.hashCode ^
        _setEq.hash(people) ^
        _listEq.hash(tagIds) ^
        location.hashCode ^
        camera.hashCode ^
        date.hashCode ^
        display.hashCode ^
        rating.hashCode ^
        mediaType.hashCode ^
        sort.hashCode;
  }
}

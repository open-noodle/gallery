// What the chip row, the chip sheets and the field's suggestions read: the narrowed options of one scope and filter
// state. Filled from `POST /search/options` (counts), or on an older Gallery server from
// `/search/suggestions/filters` (no counts: every count is null).

/// The option lists one `POST /search/options` request can ask for, after availability.
enum SearchDimension { total, time, people, tags, places, cameras, ratings, mediaTypes }

/// The chip row and #910: whether each list has any option for the whole scope (ignoring its own filter), and the
/// flags the Filters sheet uses.
class SearchAvailability {
  final bool hasAssets;
  final bool hasPeople;
  final bool hasTags;
  final bool hasPlaces;
  final bool hasCameras;
  final bool hasRatings;
  final bool hasImages;
  final bool hasVideos;
  final bool hasFavorites;
  final bool hasAssetsInAlbum;
  final bool hasAssetsNotInAlbum;

  const SearchAvailability({
    required this.hasAssets,
    required this.hasPeople,
    required this.hasTags,
    required this.hasPlaces,
    required this.hasCameras,
    required this.hasRatings,
    required this.hasImages,
    required this.hasVideos,
    required this.hasFavorites,
    required this.hasAssetsInAlbum,
    required this.hasAssetsNotInAlbum,
  });

  @override
  bool operator ==(Object other) =>
      other is SearchAvailability &&
      other.hasAssets == hasAssets &&
      other.hasPeople == hasPeople &&
      other.hasTags == hasTags &&
      other.hasPlaces == hasPlaces &&
      other.hasCameras == hasCameras &&
      other.hasRatings == hasRatings &&
      other.hasImages == hasImages &&
      other.hasVideos == hasVideos &&
      other.hasFavorites == hasFavorites &&
      other.hasAssetsInAlbum == hasAssetsInAlbum &&
      other.hasAssetsNotInAlbum == hasAssetsNotInAlbum;

  @override
  int get hashCode => Object.hash(
    hasAssets,
    hasPeople,
    hasTags,
    hasPlaces,
    hasCameras,
    hasRatings,
    hasImages,
    hasVideos,
    hasFavorites,
    hasAssetsInAlbum,
    hasAssetsNotInAlbum,
  );
}

class SearchPersonOption {
  /// The value to send (SearchPersonRef.filterId).
  final String filterId;
  final String name;
  final int? count;
  final bool isSelected;
  final String? profileId;

  /// `user-person` or `space-person`; routes the thumbnail.
  final String? profileType;
  final String? profileSpaceId;

  const SearchPersonOption({
    required this.filterId,
    required this.name,
    this.count,
    this.isSelected = false,
    this.profileId,
    this.profileType,
    this.profileSpaceId,
  });
}

class SearchTagOption {
  final String id;
  final String value;
  final int? count;
  final bool isSelected;

  const SearchTagOption({required this.id, required this.value, this.count, this.isSelected = false});
}

class SearchCityOption {
  final String city;
  final int? count;

  const SearchCityOption({required this.city, this.count});
}

class SearchCountryOption {
  final String country;
  final int? count;

  /// Null while an older server's cities for this country are still loading.
  final List<SearchCityOption>? cities;

  const SearchCountryOption({required this.country, this.count, this.cities});
}

class SearchCameraModelOption {
  final String model;
  final int? count;

  const SearchCameraModelOption({required this.model, this.count});
}

class SearchCameraMakeOption {
  final String make;
  final int? count;

  /// Null on an older server, which lists makes only.
  final List<SearchCameraModelOption>? models;

  const SearchCameraMakeOption({required this.make, this.count, this.models});
}

class SearchRatingOption {
  final int rating;
  final int? count;

  const SearchRatingOption({required this.rating, this.count});
}

class SearchMediaTypeOption {
  /// `IMAGE` or `VIDEO`.
  final String type;
  final int? count;

  const SearchMediaTypeOption({required this.type, this.count});
}

/// One month of local taken time (When sheet, field dates).
class SearchMonthCount {
  final int year;
  final int month;
  final int count;

  const SearchMonthCount({required this.year, required this.month, required this.count});
}

/// One response's worth of options: only the requested parts are non-null.
class SearchOptionsPart {
  final bool stale;
  final SearchAvailability? availability;
  final int? total;
  final List<SearchMonthCount>? months;
  final List<SearchPersonOption>? people;
  final bool? hasUnnamedPeople;
  final List<SearchTagOption>? tags;
  final List<SearchCountryOption>? countries;
  final List<SearchCameraMakeOption>? cameras;
  final List<SearchRatingOption>? ratings;
  final List<SearchMediaTypeOption>? mediaTypes;

  const SearchOptionsPart({
    this.stale = false,
    this.availability,
    this.total,
    this.months,
    this.people,
    this.hasUnnamedPeople,
    this.tags,
    this.countries,
    this.cameras,
    this.ratings,
    this.mediaTypes,
  });
}

/// The options of one search state, filled in as responses arrive. A null list is still loading (the sheet shows a
/// skeleton) unless its request [failed] (the sheet shows an error with Retry); an empty list is empty.
class SearchOptions {
  /// False on a stock Immich server: no facet options at all.
  final bool facetsSupported;

  /// False on an older Gallery server, which has no counts.
  final bool hasCounts;

  /// True when any part was served from a stale server cache; shown as is.
  final bool stale;
  final SearchAvailability? availability;
  final int? total;
  final List<SearchMonthCount>? months;
  final List<SearchPersonOption>? people;
  final bool? hasUnnamedPeople;
  final List<SearchTagOption>? tags;
  final List<SearchCountryOption>? countries;
  final List<SearchCameraMakeOption>? cameras;
  final List<SearchRatingOption>? ratings;
  final List<SearchMediaTypeOption>? mediaTypes;
  final Object? error;

  /// The dimensions whose request failed this round (all of them when availability failed: none was asked for).
  final Set<SearchDimension> failed;

  const SearchOptions({
    this.facetsSupported = true,
    this.hasCounts = true,
    this.stale = false,
    this.availability,
    this.total,
    this.months,
    this.people,
    this.hasUnnamedPeople,
    this.tags,
    this.countries,
    this.cameras,
    this.ratings,
    this.mediaTypes,
    this.error,
    this.failed = const {},
  });

  static const unsupported = SearchOptions(facetsSupported: false, hasCounts: false);

  /// Adds the non-null parts of [part].
  SearchOptions merge(SearchOptionsPart part) => SearchOptions(
    facetsSupported: facetsSupported,
    hasCounts: hasCounts,
    stale: stale || part.stale,
    availability: part.availability ?? availability,
    total: part.total ?? total,
    months: part.months ?? months,
    people: part.people ?? people,
    hasUnnamedPeople: part.hasUnnamedPeople ?? hasUnnamedPeople,
    tags: part.tags ?? tags,
    countries: part.countries ?? countries,
    cameras: part.cameras ?? cameras,
    ratings: part.ratings ?? ratings,
    mediaTypes: part.mediaTypes ?? mediaTypes,
    error: error,
    failed: failed,
  );

  /// A new request round: the lists stay on screen until replaced (options never vanish while you pick), the stale
  /// mark and the error of the previous round go.
  SearchOptions restart({required bool facetsSupported, required bool hasCounts}) => SearchOptions(
    facetsSupported: facetsSupported,
    hasCounts: hasCounts,
    availability: availability,
    total: total,
    months: months,
    people: people,
    hasUnnamedPeople: hasUnnamedPeople,
    tags: tags,
    countries: countries,
    cameras: cameras,
    ratings: ratings,
    mediaTypes: mediaTypes,
  );

  /// An older server's cities of one country, fetched after the countries.
  SearchOptions withCities(String country, List<SearchCityOption> cities) => SearchOptions(
    facetsSupported: facetsSupported,
    hasCounts: hasCounts,
    stale: stale,
    availability: availability,
    total: total,
    months: months,
    people: people,
    hasUnnamedPeople: hasUnnamedPeople,
    tags: tags,
    countries: [
      for (final c in countries ?? const <SearchCountryOption>[])
        c.country == country ? SearchCountryOption(country: c.country, count: c.count, cities: cities) : c,
    ],
    cameras: cameras,
    ratings: ratings,
    mediaTypes: mediaTypes,
    error: error,
    failed: failed,
  );

  /// A failed request: [dimensions] are marked [failed], their lists stay as they were.
  SearchOptions withError(Object error, {Iterable<SearchDimension> dimensions = SearchDimension.values}) =>
      SearchOptions(
        facetsSupported: facetsSupported,
        hasCounts: hasCounts,
        stale: stale,
        availability: availability,
        total: total,
        months: months,
        people: people,
        hasUnnamedPeople: hasUnnamedPeople,
        tags: tags,
        countries: countries,
        cameras: cameras,
        ratings: ratings,
        mediaTypes: mediaTypes,
        error: error,
        failed: {...failed, ...dimensions},
      );

  /// The loaded list of [dimension] (the total for [SearchDimension.total]), null while on its way or failed.
  Object? _list(SearchDimension dimension) => switch (dimension) {
    SearchDimension.total => total,
    SearchDimension.time => months,
    SearchDimension.people => people,
    SearchDimension.tags => tags,
    SearchDimension.places => countries,
    SearchDimension.cameras => cameras,
    SearchDimension.ratings => ratings,
    SearchDimension.mediaTypes => mediaTypes,
  };

  /// [dimension] is still on its way: not loaded, not failed, and the server has facet options at all.
  bool isPending(SearchDimension dimension) =>
      facetsSupported && _list(dimension) == null && !failed.contains(dimension);

  /// [dimension] has nothing to show because its request failed.
  bool hasFailed(SearchDimension dimension) => _list(dimension) == null && failed.contains(dimension);
}

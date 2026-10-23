import 'package:immich_mobile/gallery/search/search_state.model.dart';

// Search on every timeline (specs/2026-10-23-mobile-search-redesign-design.md, "Search on every timeline" and "Scope
// parameters"): one case per row of the scope table. A scope is fixed by its screen; it is never a removable chip.
//
// The rules every case follows, from the server's validation:
// - `withSharedSpaces` / `withPartners` / `visibility` belong to the scope and are never hardcoded. The server rejects
//   `spaceId` or an album with `withSharedSpaces`, and `withSharedSpaces` / `withPartners` without timeline visibility.
// - Album scopes send `albumIds: [id]` (`albumId` on /timeline/buckets), never `spaceId` or `withSharedSpaces`.
// - Space scopes send space people as bare ids in `spacePersonIds`.
// - A personal person is a bare `personIds: [id]` without `withSharedSpaces`, which would widen it to every face of
//   that identity.

/// A filter section a scope fixes, so the chip row and the Filters sheet hide it.
enum SearchSection {
  people,
  when,
  places,
  tags,
  favorites,
  mediaType,
  rating,
  camera,
  albums,
  text,
  archived,
  untagged,
}

sealed class SearchScope {
  const SearchScope();

  /// Sections this screen fixes.
  Set<SearchSection> get fixedSections => const {};

  /// Whether selected people go out as `spacePersonIds` (space scopes) instead of `personIds`.
  bool get usesSpacePeople => false;

  /// The scope's own parameters for a request in [mode].
  SearchParams baseParams(SearchMode mode);
}

/// Browse: no query; results from /timeline/buckets. Query: a text query or reference photo; results from
/// /search/smart. The options request follows the results call of its mode.
enum SearchMode { browse, query }

/// Photos: own + timeline partners + the spaces shown in the timeline, timeline visibility. Smart search always
/// searches timeline partners and takes no `withPartners`.
class PhotosSearchScope extends SearchScope {
  const PhotosSearchScope();

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(
    visibility: SearchVisibility.timeline,
    withSharedSpaces: true,
    withPartners: mode == SearchMode.browse ? true : null,
  );

  @override
  bool operator ==(Object other) => other is PhotosSearchScope;

  @override
  int get hashCode => (PhotosSearchScope).hashCode;
}

/// An album page: the album only.
class AlbumSearchScope extends SearchScope {
  final String albumId;
  const AlbumSearchScope(this.albumId);

  @override
  Set<SearchSection> get fixedSections => const {SearchSection.albums};

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(albumId: albumId);

  @override
  bool operator ==(Object other) => other is AlbumSearchScope && other.albumId == albumId;

  @override
  int get hashCode => Object.hash(AlbumSearchScope, albumId);
}

/// A space album: the album only, never the space too (web album-timeline.ts). Visibility unset, so archived photos
/// linked into the album stay in, as the page shows them.
class SpaceAlbumSearchScope extends SearchScope {
  final String albumId;
  const SpaceAlbumSearchScope(this.albumId);

  @override
  Set<SearchSection> get fixedSections => const {SearchSection.albums};

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(albumId: albumId);

  @override
  bool operator ==(Object other) => other is SpaceAlbumSearchScope && other.albumId == albumId;

  @override
  int get hashCode => Object.hash(SpaceAlbumSearchScope, albumId);
}

/// A space: its people are space people.
class SpaceSearchScope extends SearchScope {
  final String spaceId;
  const SpaceSearchScope(this.spaceId);

  @override
  bool get usesSpacePeople => true;

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(spaceId: spaceId);

  @override
  bool operator ==(Object other) => other is SpaceSearchScope && other.spaceId == spaceId;

  @override
  int get hashCode => Object.hash(SpaceSearchScope, spaceId);
}

/// A personal person page: that person (fixed, still selected), owner only.
class PersonalPersonSearchScope extends SearchScope {
  final String personId;
  const PersonalPersonSearchScope(this.personId);

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(personIds: [personId]);

  @override
  bool operator ==(Object other) => other is PersonalPersonSearchScope && other.personId == personId;

  @override
  int get hashCode => Object.hash(PersonalPersonSearchScope, personId);
}

/// A space person's page: the space and that space person.
class SpacePersonSearchScope extends SearchScope {
  final String spaceId;
  final String spacePersonId;
  const SpacePersonSearchScope({required this.spaceId, required this.spacePersonId});

  @override
  bool get usesSpacePeople => true;

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(spaceId: spaceId, spacePersonIds: [spacePersonId]);

  @override
  bool operator ==(Object other) =>
      other is SpacePersonSearchScope && other.spaceId == spaceId && other.spacePersonId == spacePersonId;

  @override
  int get hashCode => Object.hash(SpacePersonSearchScope, spaceId, spacePersonId);
}

/// A place page: that city within the Photos scope.
class PlaceSearchScope extends SearchScope {
  final String city;
  const PlaceSearchScope(this.city);

  @override
  Set<SearchSection> get fixedSections => const {SearchSection.places};

  @override
  SearchParams baseParams(SearchMode mode) => const PhotosSearchScope().baseParams(mode).copyWith(city: city);

  @override
  bool operator ==(Object other) => other is PlaceSearchScope && other.city == city;

  @override
  int get hashCode => Object.hash(PlaceSearchScope, city);
}

/// Favorites: my favourites, timeline + archive (visibility unset).
class FavoritesSearchScope extends SearchScope {
  const FavoritesSearchScope();

  @override
  Set<SearchSection> get fixedSections => const {SearchSection.favorites};

  @override
  SearchParams baseParams(SearchMode mode) => const SearchParams(isFavorite: true);

  @override
  bool operator ==(Object other) => other is FavoritesSearchScope;

  @override
  int get hashCode => (FavoritesSearchScope).hashCode;
}

/// Archive: my archived photos only.
class ArchiveSearchScope extends SearchScope {
  final String ownerId;
  const ArchiveSearchScope(this.ownerId);

  @override
  Set<SearchSection> get fixedSections => const {SearchSection.archived};

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(visibility: SearchVisibility.archive, ownerId: ownerId);

  @override
  bool operator ==(Object other) => other is ArchiveSearchScope && other.ownerId == ownerId;

  @override
  int get hashCode => Object.hash(ArchiveSearchScope, ownerId);
}

/// Videos: type video within the Photos scope.
class VideosSearchScope extends SearchScope {
  const VideosSearchScope();

  @override
  Set<SearchSection> get fixedSections => const {SearchSection.mediaType};

  @override
  SearchParams baseParams(SearchMode mode) =>
      const PhotosSearchScope().baseParams(mode).copyWith(type: SearchMediaType.video);

  @override
  bool operator ==(Object other) => other is VideosSearchScope;

  @override
  int get hashCode => (VideosSearchScope).hashCode;
}

/// Recently added: my own photos, timeline + archive (visibility unset), browse ordered by upload date.
class RecentlyAddedSearchScope extends SearchScope {
  final String ownerId;
  const RecentlyAddedSearchScope(this.ownerId);

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(ownerId: ownerId);

  @override
  bool operator ==(Object other) => other is RecentlyAddedSearchScope && other.ownerId == ownerId;

  @override
  int get hashCode => Object.hash(RecentlyAddedSearchScope, ownerId);
}

/// Recently taken: my own photos, timeline visibility.
class RecentlyTakenSearchScope extends SearchScope {
  final String ownerId;
  const RecentlyTakenSearchScope(this.ownerId);

  @override
  SearchParams baseParams(SearchMode mode) => SearchParams(visibility: SearchVisibility.timeline, ownerId: ownerId);

  @override
  bool operator ==(Object other) => other is RecentlyTakenSearchScope && other.ownerId == ownerId;

  @override
  int get hashCode => Object.hash(RecentlyTakenSearchScope, ownerId);
}

enum SearchVisibility { timeline, archive }

/// The neutral parameter set of one request: scope plus filters. GallerySearchRepository turns it into the options
/// body, the /timeline/buckets query or the /search/smart body; a null field is never sent.
class SearchParams {
  final List<String>? personIds;
  final List<String>? spacePersonIds;
  final List<String>? tagIds;

  /// `tagIds: null` on the wire (untagged assets). Only POST bodies can say it.
  final bool untagged;
  final String? country;
  final String? state;
  final String? city;
  final String? make;
  final String? model;
  final int? minRating;
  final SearchMediaType? type;
  final bool? isFavorite;
  final bool? isInAlbum;
  final bool? isNotInAlbum;
  final SearchVisibility? visibility;
  final String? ocr;
  final String? description;
  final String? originalFileName;

  /// Already encoded for the server (see SearchDateEncoding).
  final DateTime? takenAfter;
  final DateTime? takenBefore;
  final String? ownerId;
  final String? albumId;
  final String? spaceId;
  final bool? withSharedSpaces;
  final bool? withPartners;
  final String? query;
  final String? queryAssetId;

  const SearchParams({
    this.personIds,
    this.spacePersonIds,
    this.tagIds,
    this.untagged = false,
    this.country,
    this.state,
    this.city,
    this.make,
    this.model,
    this.minRating,
    this.type,
    this.isFavorite,
    this.isInAlbum,
    this.isNotInAlbum,
    this.visibility,
    this.ocr,
    this.description,
    this.originalFileName,
    this.takenAfter,
    this.takenBefore,
    this.ownerId,
    this.albumId,
    this.spaceId,
    this.withSharedSpaces,
    this.withPartners,
    this.query,
    this.queryAssetId,
  });

  SearchParams copyWith({
    List<String>? personIds,
    List<String>? spacePersonIds,
    List<String>? tagIds,
    bool? untagged,
    String? country,
    String? state,
    String? city,
    String? make,
    String? model,
    int? minRating,
    SearchMediaType? type,
    bool? isFavorite,
    bool? isInAlbum,
    bool? isNotInAlbum,
    SearchVisibility? visibility,
    String? ocr,
    String? description,
    String? originalFileName,
    DateTime? takenAfter,
    DateTime? takenBefore,
    String? ownerId,
    String? query,
    String? queryAssetId,
  }) => SearchParams(
    personIds: personIds ?? this.personIds,
    spacePersonIds: spacePersonIds ?? this.spacePersonIds,
    tagIds: tagIds ?? this.tagIds,
    untagged: untagged ?? this.untagged,
    country: country ?? this.country,
    state: state ?? this.state,
    city: city ?? this.city,
    make: make ?? this.make,
    model: model ?? this.model,
    minRating: minRating ?? this.minRating,
    type: type ?? this.type,
    isFavorite: isFavorite ?? this.isFavorite,
    isInAlbum: isInAlbum ?? this.isInAlbum,
    isNotInAlbum: isNotInAlbum ?? this.isNotInAlbum,
    visibility: visibility ?? this.visibility,
    ocr: ocr ?? this.ocr,
    description: description ?? this.description,
    originalFileName: originalFileName ?? this.originalFileName,
    takenAfter: takenAfter ?? this.takenAfter,
    takenBefore: takenBefore ?? this.takenBefore,
    ownerId: ownerId ?? this.ownerId,
    albumId: albumId,
    spaceId: spaceId,
    withSharedSpaces: withSharedSpaces,
    withPartners: withPartners,
    query: query ?? this.query,
    queryAssetId: queryAssetId ?? this.queryAssetId,
  );

  /// Archived only: archive visibility. Shared spaces and partners only exist on the timeline, so they go.
  SearchParams _archivedOnly() => SearchParams(
    personIds: personIds,
    spacePersonIds: spacePersonIds,
    tagIds: tagIds,
    untagged: untagged,
    country: country,
    state: state,
    city: city,
    make: make,
    model: model,
    minRating: minRating,
    type: type,
    isFavorite: isFavorite,
    isInAlbum: isInAlbum,
    isNotInAlbum: isNotInAlbum,
    visibility: SearchVisibility.archive,
    ocr: ocr,
    description: description,
    originalFileName: originalFileName,
    takenAfter: takenAfter,
    takenBefore: takenBefore,
    ownerId: ownerId,
    albumId: albumId,
    spaceId: spaceId,
    query: query,
    queryAssetId: queryAssetId,
  );
}

/// How taken dates go out (search_filter.model.dart `SearchDateFilter`): a server that declares `localTakenRange`
/// compares wall-clock time with an exclusive end, so it gets UTC midnight of the first day and of the day after the
/// last. Any other server (older Gallery, stock Immich) compares the UTC instant with an inclusive end, so it gets the
/// device-local start of the first day and end of the last.
class SearchDateEncoding {
  static (DateTime, DateTime) encode(SearchDayRange range, {required bool localTakenRange}) {
    final first = range.firstDay;
    final last = range.lastDay;
    if (localTakenRange) {
      return (DateTime.utc(first.year, first.month, first.day), DateTime.utc(last.year, last.month, last.day + 1));
    }
    return (DateTime(first.year, first.month, first.day), DateTime(last.year, last.month, last.day, 23, 59, 59, 999));
  }
}

/// Scope + state → the parameters of one request in the state's mode. A filter the scope fixes is ignored, so the
/// scope always wins.
SearchParams buildSearchParams(
  SearchScope scope,
  SearchState state, {
  required DateTime now,
  required bool localTakenRange,
}) {
  final mode = state.isQueryMode ? SearchMode.query : SearchMode.browse;
  final base = scope.baseParams(mode);
  final filters = state.filters;
  final fixed = scope.fixedSections;
  bool open(SearchSection section) => !fixed.contains(section);

  final people = filters.people.map((p) => p.filterId).toList();
  final scopePeople = scope.usesSpacePeople ? base.spacePersonIds : base.personIds;
  final mergedPeople = [...?scopePeople, ...people.where((id) => !(scopePeople?.contains(id) ?? false))];

  final place = open(SearchSection.places) ? filters.place : null;
  final dateRange = filters.date?.resolve(now);
  final encodedDate = dateRange == null ? null : SearchDateEncoding.encode(dateRange, localTakenRange: localTakenRange);
  final text = filters.text;

  var params = base.copyWith(
    personIds: !scope.usesSpacePeople && mergedPeople.isNotEmpty ? mergedPeople : null,
    spacePersonIds: scope.usesSpacePeople && mergedPeople.isNotEmpty ? mergedPeople : null,
    tagIds: filters.tags.isEmpty ? null : filters.tags.map((t) => t.id).toList(),
    untagged: filters.untagged && filters.tags.isEmpty,
    country: place?.country,
    state: place?.state,
    city: place?.city,
    make: filters.camera?.make,
    model: filters.camera?.model,
    minRating: filters.minRating,
    type: open(SearchSection.mediaType) && filters.mediaType != SearchMediaType.all ? filters.mediaType : null,
    isFavorite: open(SearchSection.favorites) && filters.favoritesOnly ? true : null,
    isInAlbum: open(SearchSection.albums) && filters.album == SearchAlbumFilter.inAlbum ? true : null,
    isNotInAlbum: open(SearchSection.albums) && filters.album == SearchAlbumFilter.notInAlbum ? true : null,
    ocr: _nonBlank(text.ocr),
    // /search/smart has no description or file-name filter, so query mode drops both from options and results alike:
    // the counts must describe the results beside them.
    description: mode == SearchMode.browse ? _nonBlank(text.description) : null,
    originalFileName: mode == SearchMode.browse ? _nonBlank(text.fileName) : null,
    takenAfter: encodedDate?.$1,
    takenBefore: encodedDate?.$2,
    query: switch (state.query) {
      SearchQueryText(:final text) => text,
      _ => null,
    },
    queryAssetId: switch (state.query) {
      SearchQuerySimilarTo(:final assetId) => assetId,
      _ => null,
    },
  );
  if (open(SearchSection.archived) && filters.archivedOnly) {
    params = params._archivedOnly();
  }
  return params;
}

String? _nonBlank(String? value) {
  final trimmed = value?.trim();
  return trimmed == null || trimmed.isEmpty ? null : trimmed;
}

import 'dart:convert';

import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart' show serverSupportsSpaces;
import 'package:immich_mobile/utils/semver.dart';
import 'package:openapi/api.dart';

/// What the server can do for search, from `GET /server/version` and `GET /server/features`.
class SearchServerCapabilities {
  /// A Gallery server: the same decision `serverSupportsSpacesProvider` makes. False on stock Immich, which has no
  /// facet options and no fork filters on /timeline/buckets.
  final bool isGallery;

  /// `POST /search/options` exists (`searchOptions`). An older Gallery server falls back to the suggestion endpoints.
  final bool searchOptions;

  /// Taken dates are wall-clock days with an exclusive end (`localTakenRange`).
  final bool localTakenRange;

  /// A favourites search may add partners and shared spaces with visibility unset (`searchFavoritesAcrossSpaces`), so
  /// the Favorites screen searches what it shows. An older server gets my own favourites only.
  final bool favoritesAcrossSpaces;

  const SearchServerCapabilities({
    required this.isGallery,
    required this.searchOptions,
    required this.localTakenRange,
    this.favoritesAcrossSpaces = false,
  });

  static const stock = SearchServerCapabilities(isGallery: false, searchOptions: false, localTakenRange: false);
}

/// Every server call search mode makes, over the generated OpenAPI client. Nothing here holds state.
class GallerySearchRepository {
  final SearchApi _search;
  final TimelineApi _timeline;
  final ServerApi _server;
  final AssetsApi? _assets;

  const GallerySearchRepository({
    required SearchApi searchApi,
    required TimelineApi timelineApi,
    required ServerApi serverApi,
    AssetsApi? assetsApi,
  }) : _search = searchApi,
       _timeline = timelineApi,
       _server = serverApi,
       _assets = assetsApi;

  /// `GET /assets/{id}`: the whole asset behind a result built from /timeline/bucket columns, which carry no name,
  /// checksum or edit flag (see completeSearchResultInViewer).
  Future<AssetResponseDto?> assetInfo(String id) async => _assets?.getAssetInfo(id);

  Future<SearchServerCapabilities> capabilities() async {
    final version = await _server.getServerVersion();
    if (version == null) {
      return SearchServerCapabilities.stock;
    }
    ServerFeaturesDto? features;
    try {
      features = await _server.getServerFeatures();
    } catch (_) {
      // A stock Immich server's features lack keys the Gallery DTO requires (`peopleStatistics`,
      // `smartSearchHasCutoff`), so decoding them fails. The version decides then, as serverSupportsSpaces does for a
      // server that declares no sync types.
      features = null;
    }
    final semver = SemVer(major: version.major, minor: version.minor, patch: version.patch_);
    final isGallery = serverSupportsSpaces(semver, features?.syncRequestTypes.orElse(null)?.toSet());
    return SearchServerCapabilities(
      isGallery: isGallery,
      searchOptions: isGallery && features?.searchOptions.orElse(null) == true,
      localTakenRange: features?.localTakenRange.orElse(null) == true,
      favoritesAcrossSpaces: isGallery && features?.searchFavoritesAcrossSpaces.orElse(null) == true,
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Options: POST /search/options
  // ---------------------------------------------------------------------------------------------------------------

  /// [dimensions] empty asks for availability only.
  Future<SearchOptionsPart> options(SearchParams p, {Set<SearchDimension> dimensions = const {}}) async {
    final response = await _search.getSearchOptions(_optionsBody(p, dimensions));
    if (response == null) {
      throw StateError('empty search options response');
    }
    return _optionsPart(response);
  }

  static SearchOptionsRequestDto _optionsBody(SearchParams p, Set<SearchDimension> dimensions) {
    final dto = SearchOptionsRequestDto(
      albumIds: _list(p.albumId == null ? null : [p.albumId!]),
      personIds: _list(p.personIds),
      spacePersonIds: _list(p.spacePersonIds),
      tagIds: p.untagged ? const Optional.present(null) : _list(p.tagIds),
      country: _opt(p.country),
      state: _opt(p.state),
      city: _opt(p.city),
      make: _opt(p.make),
      model: _opt(p.model),
      rating: _opt(p.minRating),
      type: _opt(_type(p.type)),
      isFavorite: _opt(p.isFavorite),
      isInAlbum: _opt(p.isInAlbum),
      isNotInAlbum: _opt(p.isNotInAlbum),
      visibility: _opt(_visibility(p.visibility)),
      ocr: _opt(p.ocr),
      description: _opt(p.description),
      originalFileName: _opt(p.originalFileName),
      takenAfter: _opt(p.takenAfter),
      takenBefore: _opt(p.takenBefore),
      ownerId: _opt(p.ownerId),
      spaceId: _opt(p.spaceId),
      withSharedSpaces: _opt(p.withSharedSpaces),
      withPartners: _opt(p.withPartners),
      libraryView: _opt(p.libraryView?.apiValue),
      query: _opt(p.query),
      queryAssetId: _opt(p.queryAssetId),
      dimensions: Optional.present([
        if (dimensions.isEmpty) SearchOptionsDimension.availability,
        for (final dimension in SearchDimension.values)
          if (dimensions.contains(dimension)) _dimension(dimension),
      ]),
    );
    return dto;
  }

  static SearchOptionsDimension _dimension(SearchDimension dimension) => switch (dimension) {
    SearchDimension.total => SearchOptionsDimension.total,
    SearchDimension.time => SearchOptionsDimension.time,
    SearchDimension.people => SearchOptionsDimension.people,
    SearchDimension.tags => SearchOptionsDimension.tags,
    SearchDimension.places => SearchOptionsDimension.places,
    SearchDimension.cameras => SearchOptionsDimension.cameras,
    SearchDimension.ratings => SearchOptionsDimension.ratings,
    SearchDimension.mediaTypes => SearchOptionsDimension.mediaTypes,
  };

  static SearchOptionsPart _optionsPart(SearchOptionsResponseDto r) {
    final availability = r.availability.orElse(null);
    return SearchOptionsPart(
      stale: r.stale.orElse(null) == true,
      availability: availability == null
          ? null
          : SearchAvailability(
              hasAssets: availability.hasAssets,
              hasPeople: availability.hasPeople,
              hasTags: availability.hasTags,
              hasPlaces: availability.hasPlaces,
              hasCameras: availability.hasCameras,
              hasRatings: availability.hasRatings,
              hasImages: availability.hasImages,
              hasVideos: availability.hasVideos,
              hasFavorites: availability.hasFavorites,
              hasAssetsInAlbum: availability.hasAssetsInAlbum,
              hasAssetsNotInAlbum: availability.hasAssetsNotInAlbum,
            ),
      total: r.total.orElse(null),
      months: r.timeBuckets.orElse(null)?.map(_month).toList(),
      people: r.people.orElse(null)?.map((p) {
        final profile = p.primaryProfile.orElse(null);
        return SearchPersonOption(
          filterId: p.filterId,
          name: p.name,
          count: p.count,
          isSelected: p.isSelected,
          profileId: profile?.id,
          profileType: profile?.type.toJson(),
          profileSpaceId: profile?.spaceId.orElse(null),
          isPet: p.isPet.orElse(null),
        );
      }).toList(),
      hasUnnamedPeople: r.hasUnnamedPeople.orElse(null),
      tags: r.tags
          .orElse(null)
          ?.map((t) => SearchTagOption(id: t.id, value: t.value, count: t.count, isSelected: t.isSelected))
          .toList(),
      countries: r.countries
          .orElse(null)
          ?.map(
            (c) => SearchCountryOption(
              country: c.country,
              count: c.count,
              cities: c.cities.map((city) => SearchCityOption(city: city.city, count: city.count)).toList(),
            ),
          )
          .toList(),
      cameras: r.cameraMakes
          .orElse(null)
          ?.map(
            (m) => SearchCameraMakeOption(
              make: m.make,
              count: m.count,
              models: m.models.map((model) => SearchCameraModelOption(model: model.model, count: model.count)).toList(),
            ),
          )
          .toList(),
      ratings: r.ratings.orElse(null)?.map((x) => SearchRatingOption(rating: x.rating, count: x.count)).toList(),
      mediaTypes: r.mediaTypes
          .orElse(null)
          ?.map((x) => SearchMediaTypeOption(type: x.type.toJson(), count: x.count))
          .toList(),
    );
  }

  static SearchMonthCount _month(TimeBucketsResponseDto bucket) => searchMonthOf(bucket);

  // ---------------------------------------------------------------------------------------------------------------
  // Older Gallery server: GET /search/suggestions/filters, then GET /search/suggestions?type=city per country
  // ---------------------------------------------------------------------------------------------------------------

  /// No counts, no cities (see [fallbackCities]), no months (the options notifier reads those from [timeBuckets]). The suggestion endpoints take `albumId` and, in a space,
  /// space people as `personIds` with `spaceId`; they take no visibility, text filters or `withPartners`.
  Future<SearchOptionsPart> fallbackOptions(SearchParams p) async {
    final r = await _search.getFilterSuggestions(
      albumId: p.albumId,
      city: p.city,
      country: p.country,
      isFavorite: p.isFavorite,
      isInAlbum: p.isInAlbum,
      isNotInAlbum: p.isNotInAlbum,
      make: p.make,
      mediaType: _type(p.type),
      model: p.model,
      ownerId: p.ownerId,
      personIds: p.personIds ?? p.spacePersonIds,
      rating: p.minRating,
      spaceId: p.spaceId,
      state: p.state,
      tagIds: p.tagIds,
      takenAfter: p.takenAfter,
      takenBefore: p.takenBefore,
      withSharedSpaces: p.withSharedSpaces,
    );
    if (r == null) {
      throw StateError('empty filter suggestions response');
    }
    final spaceScope = p.spaceId != null;
    return SearchOptionsPart(
      availability: SearchAvailability(
        hasAssets: true,
        hasPeople: r.people.isNotEmpty,
        hasTags: r.tags.isNotEmpty,
        hasPlaces: r.countries.isNotEmpty,
        hasCameras: r.cameraMakes.isNotEmpty,
        hasRatings: r.ratings.isNotEmpty,
        hasImages: r.mediaTypes.contains(AssetTypeEnum.IMAGE.toJson()),
        hasVideos: r.mediaTypes.contains(AssetTypeEnum.VIDEO.toJson()),
        hasFavorites: r.hasFavorites,
        hasAssetsInAlbum: r.hasAssetsInAlbum,
        hasAssetsNotInAlbum: r.hasAssetsNotInAlbum,
      ),
      people: r.people.map((person) {
        final profile = person.primaryProfile.orElse(null);
        return SearchPersonOption(
          filterId: _fallbackFilterId(person.id, profile, spaceScope: spaceScope),
          name: person.name,
          profileId: profile?.id,
          profileType: profile?.type.toJson(),
          profileSpaceId: profile?.spaceId.orElse(null),
        );
      }).toList(),
      hasUnnamedPeople: r.hasUnnamedPeople,
      tags: r.tags.map((t) => SearchTagOption(id: t.id, value: t.value)).toList(),
      countries: r.countries.map((c) => SearchCountryOption(country: c)).toList(),
      cameras: r.cameraMakes.map((m) => SearchCameraMakeOption(make: m)).toList(),
      ratings: r.ratings.map((rating) => SearchRatingOption(rating: rating)).toList(),
      mediaTypes: r.mediaTypes.map((type) => SearchMediaTypeOption(type: type)).toList(),
    );
  }

  /// web `getPhotosPersonFilterId`: the profile token, never the response `id` (an identity id). In a space the
  /// suggestion endpoint keys people by their bare space-person id.
  static String _fallbackFilterId(String id, ScopedPrimaryProfile? profile, {required bool spaceScope}) {
    if (profile == null) {
      return id;
    }
    if (spaceScope) {
      return profile.id;
    }
    return profile.type == ScopedPrimaryProfileTypeEnum.spacePerson
        ? 'space-person:${profile.id}'
        : 'person:${profile.id}';
  }

  Future<List<SearchCityOption>> fallbackCities(SearchParams p, String country) async {
    final cities = await _search.getSearchSuggestions(
      SearchSuggestionType.city,
      albumId: p.albumId,
      country: country,
      isFavorite: p.isFavorite,
      isInAlbum: p.isInAlbum,
      isNotInAlbum: p.isNotInAlbum,
      make: p.make,
      mediaType: _type(p.type),
      model: p.model,
      ownerId: p.ownerId,
      personIds: p.personIds ?? p.spacePersonIds,
      rating: p.minRating,
      spaceId: p.spaceId,
      tagIds: p.tagIds,
      takenAfter: p.takenAfter,
      takenBefore: p.takenBefore,
      withSharedSpaces: p.withSharedSpaces,
    );
    return [for (final city in cities ?? const <String>[]) SearchCityOption(city: city)];
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------------------------------------------

  /// Browse results: the month buckets with their counts. The total is their sum.
  Future<List<TimeBucketsResponseDto>> timeBuckets(
    SearchParams p, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) async {
    final a = _TimelineArgs(p, sort: sort, byUploadDate: byUploadDate);
    final buckets = await _timeline.getTimeBuckets(
      albumId: a.p.albumId,
      city: a.p.city,
      country: a.p.country,
      description: a.p.description,
      isFavorite: a.p.isFavorite,
      isInAlbum: a.p.isInAlbum,
      isNotInAlbum: a.p.isNotInAlbum,
      make: a.p.make,
      model: a.p.model,
      ocr: a.p.ocr,
      order: a.order,
      orderBy: a.orderBy,
      originalFileName: a.p.originalFileName,
      ownerId: a.p.ownerId,
      personIds: a.p.personIds,
      rating: a.p.minRating,
      spaceId: a.p.spaceId,
      spacePersonIds: a.p.spacePersonIds,
      state: a.p.state,
      tagIds: a.p.tagIds,
      takenAfter: a.takenAfter,
      takenBefore: a.takenBefore,
      type: _type(a.p.type),
      visibility: _visibility(a.p.visibility),
      withPartners: a.p.withPartners,
      withSharedSpaces: a.p.withSharedSpaces,
      libraryView: a.p.libraryView?.apiValue,
    );
    return buckets ?? const [];
  }

  /// Browse results: one month's assets.
  ///
  /// Decoded here, not by the generated `getTimeBucket`: the server writes a whole-number ratio or offset as `1`, and
  /// the generated DTO casts those columns to `double`, which throws on an `int`.
  Future<TimeBucketAssetResponseDto?> timeBucket(
    SearchParams p,
    String timeBucket, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) async {
    final a = _TimelineArgs(p, sort: sort, byUploadDate: byUploadDate);
    final response = await _timeline.getTimeBucketWithHttpInfo(
      timeBucket,
      albumId: a.p.albumId,
      city: a.p.city,
      country: a.p.country,
      description: a.p.description,
      isFavorite: a.p.isFavorite,
      isInAlbum: a.p.isInAlbum,
      isNotInAlbum: a.p.isNotInAlbum,
      make: a.p.make,
      model: a.p.model,
      ocr: a.p.ocr,
      order: a.order,
      orderBy: a.orderBy,
      originalFileName: a.p.originalFileName,
      ownerId: a.p.ownerId,
      personIds: a.p.personIds,
      rating: a.p.minRating,
      spaceId: a.p.spaceId,
      spacePersonIds: a.p.spacePersonIds,
      state: a.p.state,
      tagIds: a.p.tagIds,
      takenAfter: a.takenAfter,
      takenBefore: a.takenBefore,
      type: _type(a.p.type),
      visibility: _visibility(a.p.visibility),
      withPartners: a.p.withPartners,
      withSharedSpaces: a.p.withSharedSpaces,
      libraryView: a.p.libraryView?.apiValue,
    );
    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, utf8.decode(response.bodyBytes));
    }
    if (response.body.isEmpty) {
      return null;
    }
    final json = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    for (final column in const ['ratio', 'localOffsetHours', 'latitude', 'longitude']) {
      final values = json[column];
      if (values is List) {
        json[column] = [for (final value in values) value is num ? value.toDouble() : value];
      }
    }
    return TimeBucketAssetResponseDto.fromJson(json);
  }

  /// Query results: one page of smart search. Relevance sends no `order`.
  Future<SearchResponseDto?> smart(SearchParams p, {required int page, required SearchSort sort, int size = 100}) =>
      _search.searchSmart(
        SmartSearchDto(
          albumIds: _list(p.albumId == null ? null : [p.albumId!]),
          personIds: _list(p.personIds),
          spacePersonIds: _list(p.spacePersonIds),
          tagIds: p.untagged ? const Optional.present(null) : _list(p.tagIds),
          country: _opt(p.country),
          state: _opt(p.state),
          city: _opt(p.city),
          make: _opt(p.make),
          model: _opt(p.model),
          rating: _opt(p.minRating),
          type: _opt(_type(p.type)),
          isFavorite: _opt(p.isFavorite),
          isInAlbum: _opt(p.isInAlbum),
          isNotInAlbum: _opt(p.isNotInAlbum),
          visibility: _opt(_visibility(p.visibility)),
          ocr: _opt(p.ocr),
          takenAfter: _opt(p.takenAfter),
          takenBefore: _opt(p.takenBefore),
          ownerId: _opt(p.ownerId),
          spaceId: _opt(p.spaceId),
          withSharedSpaces: _opt(p.withSharedSpaces),
          query: _opt(p.query),
          queryAssetId: _opt(p.queryAssetId),
          order: _opt(_order(sort)),
          page: Optional.present(page),
          size: Optional.present(size),
        ),
      );

  /// Paged metadata search: browse results the timeline cannot express (untagged), and every browse result on a stock
  /// server, whose /timeline/buckets has no filters.
  Future<SearchResponseDto?> metadata(SearchParams p, {required int page, required SearchSort sort, int size = 100}) =>
      _search.searchAssets(
        MetadataSearchDto(
          albumIds: _list(p.albumId == null ? null : [p.albumId!]),
          personIds: _list(p.personIds),
          spacePersonIds: _list(p.spacePersonIds),
          tagIds: p.untagged ? const Optional.present(null) : _list(p.tagIds),
          country: _opt(p.country),
          state: _opt(p.state),
          city: _opt(p.city),
          make: _opt(p.make),
          model: _opt(p.model),
          rating: _opt(p.minRating),
          type: _opt(_type(p.type)),
          isFavorite: _opt(p.isFavorite),
          isInAlbum: _opt(p.isInAlbum),
          isNotInAlbum: _opt(p.isNotInAlbum),
          visibility: _opt(_visibility(p.visibility)),
          ocr: _opt(p.ocr),
          description: _opt(p.description),
          originalFileName: _opt(p.originalFileName),
          takenAfter: _opt(p.takenAfter),
          takenBefore: _opt(p.takenBefore),
          ownerId: _opt(p.ownerId),
          spaceId: _opt(p.spaceId),
          withSharedSpaces: _opt(p.withSharedSpaces),
          libraryView: _opt(p.libraryView?.apiValue),
          order: _opt(_order(sort) ?? AssetOrder.desc),
          page: Optional.present(page),
          size: Optional.present(size),
        ),
      );

  /// The exact total of a metadata search (stock servers, which have no `/search/options`).
  Future<int?> statistics(SearchParams p) async {
    final response = await _search.searchAssetStatistics(
      StatisticsSearchDto(
        albumIds: _list(p.albumId == null ? null : [p.albumId!]),
        personIds: _list(p.personIds),
        spacePersonIds: _list(p.spacePersonIds),
        tagIds: p.untagged ? const Optional.present(null) : _list(p.tagIds),
        country: _opt(p.country),
        state: _opt(p.state),
        city: _opt(p.city),
        make: _opt(p.make),
        model: _opt(p.model),
        rating: _opt(p.minRating),
        type: _opt(_type(p.type)),
        isFavorite: _opt(p.isFavorite),
        isInAlbum: _opt(p.isInAlbum),
        isNotInAlbum: _opt(p.isNotInAlbum),
        visibility: _opt(_visibility(p.visibility)),
        ocr: _opt(p.ocr),
        description: _opt(p.description),
        takenAfter: _opt(p.takenAfter),
        takenBefore: _opt(p.takenBefore),
        ownerId: _opt(p.ownerId),
        spaceId: _opt(p.spaceId),
        withSharedSpaces: _opt(p.withSharedSpaces),
        libraryView: _opt(p.libraryView?.apiValue),
      ),
    );
    return response?.total;
  }

  // ---------------------------------------------------------------------------------------------------------------

  static Optional<T?> _opt<T>(T? value) => value == null ? const Optional.absent() : Optional.present(value);

  /// The generated DTOs default every list to `[]`; an unset list must stay off the wire.
  static Optional<List<String>?> _list(List<String>? value) =>
      value == null || value.isEmpty ? const Optional.absent() : Optional.present(value);

  static AssetTypeEnum? _type(SearchMediaType? type) => switch (type) {
    SearchMediaType.image => AssetTypeEnum.IMAGE,
    SearchMediaType.video => AssetTypeEnum.VIDEO,
    SearchMediaType.all || null => null,
  };

  static AssetVisibility? _visibility(SearchVisibility? visibility) => switch (visibility) {
    SearchVisibility.timeline => AssetVisibility.timeline,
    SearchVisibility.archive => AssetVisibility.archive,
    null => null,
  };

  static AssetOrder? _order(SearchSort sort) => switch (sort) {
    SearchSort.newest => AssetOrder.desc,
    SearchSort.oldest => AssetOrder.asc,
    SearchSort.relevance => null,
  };
}

/// /timeline/buckets arguments. Dates go out as ISO strings; the default order (newest first) is not sent.
class _TimelineArgs {
  final SearchParams p;
  final AssetOrder? order;
  final AssetOrderBy? orderBy;
  final String? takenAfter;
  final String? takenBefore;

  _TimelineArgs(this.p, {required SearchSort sort, required bool byUploadDate})
    : order = sort == SearchSort.oldest ? AssetOrder.asc : null,
      orderBy = byUploadDate ? AssetOrderBy.createdAt : null,
      takenAfter = p.takenAfter?.toUtc().toIso8601String(),
      takenBefore = p.takenBefore?.toUtc().toIso8601String();
}

/// Parameters a stock Immich server knows. The fork-only ones would be silently dropped there (or worse, widen
/// nothing and narrow nothing), so they never leave the app.
SearchParams upstreamOnlyParams(SearchParams p) => SearchParams(
  personIds: p.personIds?.where((id) => !id.contains(':')).toList(),
  tagIds: p.tagIds,
  untagged: p.untagged,
  country: p.country,
  state: p.state,
  city: p.city,
  make: p.make,
  model: p.model,
  minRating: p.minRating,
  type: p.type,
  isFavorite: p.isFavorite,
  isNotInAlbum: p.isNotInAlbum,
  visibility: p.visibility,
  ocr: p.ocr,
  description: p.description,
  originalFileName: p.originalFileName,
  takenAfter: p.takenAfter,
  takenBefore: p.takenBefore,
  albumId: p.albumId,
  query: p.query,
  queryAssetId: p.queryAssetId,
);

/// A month of the When sheet from a /timeline/buckets (or search options) bucket.
SearchMonthCount searchMonthOf(TimeBucketsResponseDto bucket) {
  final date = DateTime.parse(bucket.timeBucket);
  return SearchMonthCount(year: date.year, month: date.month, count: bucket.count);
}

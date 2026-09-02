//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class TimelineApi {
  TimelineApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Get time bucket
  ///
  /// Retrieve a string of all asset ids in a given time bucket.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] timeBucket (required):
  ///   Time bucket identifier in YYYY-MM-DD format
  ///
  /// * [String] albumId:
  ///   Filter assets belonging to a specific album
  ///
  /// * [String] bbox:
  ///   Bounding box coordinates as west,south,east,north (WGS84)
  ///
  /// * [TimeBucketSize] bucketSize:
  ///   Timeline bucket granularity. Defaults to month for backwards compatibility
  ///
  /// * [String] city:
  ///   Filter by city name
  ///
  /// * [String] country:
  ///   Filter by country name
  ///
  /// * [String] description:
  ///   Filter by asset description (substring, case/accent-insensitive)
  ///
  /// * [bool] isFavorite:
  ///   Filter by favorite status (true for favorites only, false for non-favorites only)
  ///
  /// * [bool] isInAlbum:
  ///   Filter assets in at least one album
  ///
  /// * [bool] isNotInAlbum:
  ///   Filter assets not in any album
  ///
  /// * [bool] isTrashed:
  ///   Filter by trash status (true for trashed assets only, false for non-trashed only)
  ///
  /// * [String] key:
  ///
  /// * [String] lensModel:
  ///   Filter by camera lens model
  ///
  /// * [String] locationPresence:
  ///   Filter for assets with no location: noGps (no coordinates) or noPlaceName (coordinates the geocoder could not name). Cannot be combined with city, state or country.
  ///
  /// * [String] make:
  ///   Filter by camera make
  ///
  /// * [String] model:
  ///   Filter by camera model
  ///
  /// * [String] ocr:
  ///   Filter by OCR text content (substring, case/accent-insensitive)
  ///
  /// * [AssetOrder] order:
  ///   Sort order for assets within time buckets (ASC for oldest first, DESC for newest first)
  ///
  /// * [AssetOrderBy] orderBy:
  ///   Date to group and order assets by (takenAt for date taken, createdAt for date added to Immich)
  ///
  /// * [String] originalFileName:
  ///   Filter by original filename (substring, case/accent-insensitive)
  ///
  /// * [String] ownerId:
  ///   Filter by asset owner (contributor). Narrows within the current scope and never widens it. This is NOT the same as userId, which selects whose timeline is being composed.
  ///
  /// * [String] personId:
  ///   Filter assets containing a specific person (face recognition)
  ///
  /// * [List<String>] personIds:
  ///   Filter assets containing any of these persons (multi-select)
  ///
  /// * [int] rating:
  ///   Minimum star rating (>=)
  ///
  /// * [String] slug:
  ///
  /// * [String] spaceId:
  ///   Filter assets belonging to a specific shared space
  ///
  /// * [String] spacePersonId:
  ///   Filter assets containing a specific shared space person (space face recognition)
  ///
  /// * [List<String>] spacePersonIds:
  ///   Filter assets containing any of these shared space persons (multi-select)
  ///
  /// * [String] state:
  ///   Filter by state/province name
  ///
  /// * [String] tagId:
  ///   Filter assets with a specific tag
  ///
  /// * [List<String>] tagIds:
  ///   Filter assets with any of these tags (multi-select)
  ///
  /// * [String] takenAfter:
  ///   Only include assets taken on or after this date (ISO 8601)
  ///
  /// * [String] takenBefore:
  ///   Only include assets taken on or before this date (ISO 8601)
  ///
  /// * [AssetTypeEnum] type:
  ///   Filter by asset type (IMAGE or VIDEO)
  ///
  /// * [String] userId:
  ///   Filter assets by specific user ID
  ///
  /// * [AssetVisibility] visibility:
  ///   Filter by asset visibility status (ARCHIVE, TIMELINE, HIDDEN, LOCKED)
  ///
  /// * [bool] withCoordinates:
  ///   Include location data in the response
  ///
  /// * [bool] withPartners:
  ///   Include assets shared by partners
  ///
  /// * [bool] withSharedSpaces:
  ///   Include assets from shared spaces where the user has timeline enabled
  ///
  /// * [bool] withStacked:
  ///   Include stacked assets in the response. When true, only primary assets from stacks are returned.
  Future<Response> getTimeBucketWithHttpInfo(String timeBucket, { String? albumId, String? bbox, TimeBucketSize? bucketSize, String? city, String? country, String? description, bool? isFavorite, bool? isInAlbum, bool? isNotInAlbum, bool? isTrashed, String? key, String? lensModel, String? locationPresence, String? make, String? model, String? ocr, AssetOrder? order, AssetOrderBy? orderBy, String? originalFileName, String? ownerId, String? personId, List<String>? personIds, int? rating, String? slug, String? spaceId, String? spacePersonId, List<String>? spacePersonIds, String? state, String? tagId, List<String>? tagIds, String? takenAfter, String? takenBefore, AssetTypeEnum? type, String? userId, AssetVisibility? visibility, bool? withCoordinates, bool? withPartners, bool? withSharedSpaces, bool? withStacked, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/timeline/bucket';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (albumId != null) {
      queryParams.addAll(_queryParams('', 'albumId', albumId));
    }
    if (bbox != null) {
      queryParams.addAll(_queryParams('', 'bbox', bbox));
    }
    if (bucketSize != null) {
      queryParams.addAll(_queryParams('', 'bucketSize', bucketSize));
    }
    if (city != null) {
      queryParams.addAll(_queryParams('', 'city', city));
    }
    if (country != null) {
      queryParams.addAll(_queryParams('', 'country', country));
    }
    if (description != null) {
      queryParams.addAll(_queryParams('', 'description', description));
    }
    if (isFavorite != null) {
      queryParams.addAll(_queryParams('', 'isFavorite', isFavorite));
    }
    if (isInAlbum != null) {
      queryParams.addAll(_queryParams('', 'isInAlbum', isInAlbum));
    }
    if (isNotInAlbum != null) {
      queryParams.addAll(_queryParams('', 'isNotInAlbum', isNotInAlbum));
    }
    if (isTrashed != null) {
      queryParams.addAll(_queryParams('', 'isTrashed', isTrashed));
    }
    if (key != null) {
      queryParams.addAll(_queryParams('', 'key', key));
    }
    if (lensModel != null) {
      queryParams.addAll(_queryParams('', 'lensModel', lensModel));
    }
    if (locationPresence != null) {
      queryParams.addAll(_queryParams('', 'locationPresence', locationPresence));
    }
    if (make != null) {
      queryParams.addAll(_queryParams('', 'make', make));
    }
    if (model != null) {
      queryParams.addAll(_queryParams('', 'model', model));
    }
    if (ocr != null) {
      queryParams.addAll(_queryParams('', 'ocr', ocr));
    }
    if (order != null) {
      queryParams.addAll(_queryParams('', 'order', order));
    }
    if (orderBy != null) {
      queryParams.addAll(_queryParams('', 'orderBy', orderBy));
    }
    if (originalFileName != null) {
      queryParams.addAll(_queryParams('', 'originalFileName', originalFileName));
    }
    if (ownerId != null) {
      queryParams.addAll(_queryParams('', 'ownerId', ownerId));
    }
    if (personId != null) {
      queryParams.addAll(_queryParams('', 'personId', personId));
    }
    if (personIds != null) {
      queryParams.addAll(_queryParams('multi', 'personIds', personIds));
    }
    if (rating != null) {
      queryParams.addAll(_queryParams('', 'rating', rating));
    }
    if (slug != null) {
      queryParams.addAll(_queryParams('', 'slug', slug));
    }
    if (spaceId != null) {
      queryParams.addAll(_queryParams('', 'spaceId', spaceId));
    }
    if (spacePersonId != null) {
      queryParams.addAll(_queryParams('', 'spacePersonId', spacePersonId));
    }
    if (spacePersonIds != null) {
      queryParams.addAll(_queryParams('multi', 'spacePersonIds', spacePersonIds));
    }
    if (state != null) {
      queryParams.addAll(_queryParams('', 'state', state));
    }
    if (tagId != null) {
      queryParams.addAll(_queryParams('', 'tagId', tagId));
    }
    if (tagIds != null) {
      queryParams.addAll(_queryParams('multi', 'tagIds', tagIds));
    }
    if (takenAfter != null) {
      queryParams.addAll(_queryParams('', 'takenAfter', takenAfter));
    }
    if (takenBefore != null) {
      queryParams.addAll(_queryParams('', 'takenBefore', takenBefore));
    }
      queryParams.addAll(_queryParams('', 'timeBucket', timeBucket));
    if (type != null) {
      queryParams.addAll(_queryParams('', 'type', type));
    }
    if (userId != null) {
      queryParams.addAll(_queryParams('', 'userId', userId));
    }
    if (visibility != null) {
      queryParams.addAll(_queryParams('', 'visibility', visibility));
    }
    if (withCoordinates != null) {
      queryParams.addAll(_queryParams('', 'withCoordinates', withCoordinates));
    }
    if (withPartners != null) {
      queryParams.addAll(_queryParams('', 'withPartners', withPartners));
    }
    if (withSharedSpaces != null) {
      queryParams.addAll(_queryParams('', 'withSharedSpaces', withSharedSpaces));
    }
    if (withStacked != null) {
      queryParams.addAll(_queryParams('', 'withStacked', withStacked));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get time bucket
  ///
  /// Retrieve a string of all asset ids in a given time bucket.
  ///
  /// Parameters:
  ///
  /// * [String] timeBucket (required):
  ///   Time bucket identifier in YYYY-MM-DD format
  ///
  /// * [String] albumId:
  ///   Filter assets belonging to a specific album
  ///
  /// * [String] bbox:
  ///   Bounding box coordinates as west,south,east,north (WGS84)
  ///
  /// * [TimeBucketSize] bucketSize:
  ///   Timeline bucket granularity. Defaults to month for backwards compatibility
  ///
  /// * [String] city:
  ///   Filter by city name
  ///
  /// * [String] country:
  ///   Filter by country name
  ///
  /// * [String] description:
  ///   Filter by asset description (substring, case/accent-insensitive)
  ///
  /// * [bool] isFavorite:
  ///   Filter by favorite status (true for favorites only, false for non-favorites only)
  ///
  /// * [bool] isInAlbum:
  ///   Filter assets in at least one album
  ///
  /// * [bool] isNotInAlbum:
  ///   Filter assets not in any album
  ///
  /// * [bool] isTrashed:
  ///   Filter by trash status (true for trashed assets only, false for non-trashed only)
  ///
  /// * [String] key:
  ///
  /// * [String] lensModel:
  ///   Filter by camera lens model
  ///
  /// * [String] locationPresence:
  ///   Filter for assets with no location: noGps (no coordinates) or noPlaceName (coordinates the geocoder could not name). Cannot be combined with city, state or country.
  ///
  /// * [String] make:
  ///   Filter by camera make
  ///
  /// * [String] model:
  ///   Filter by camera model
  ///
  /// * [String] ocr:
  ///   Filter by OCR text content (substring, case/accent-insensitive)
  ///
  /// * [AssetOrder] order:
  ///   Sort order for assets within time buckets (ASC for oldest first, DESC for newest first)
  ///
  /// * [AssetOrderBy] orderBy:
  ///   Date to group and order assets by (takenAt for date taken, createdAt for date added to Immich)
  ///
  /// * [String] originalFileName:
  ///   Filter by original filename (substring, case/accent-insensitive)
  ///
  /// * [String] ownerId:
  ///   Filter by asset owner (contributor). Narrows within the current scope and never widens it. This is NOT the same as userId, which selects whose timeline is being composed.
  ///
  /// * [String] personId:
  ///   Filter assets containing a specific person (face recognition)
  ///
  /// * [List<String>] personIds:
  ///   Filter assets containing any of these persons (multi-select)
  ///
  /// * [int] rating:
  ///   Minimum star rating (>=)
  ///
  /// * [String] slug:
  ///
  /// * [String] spaceId:
  ///   Filter assets belonging to a specific shared space
  ///
  /// * [String] spacePersonId:
  ///   Filter assets containing a specific shared space person (space face recognition)
  ///
  /// * [List<String>] spacePersonIds:
  ///   Filter assets containing any of these shared space persons (multi-select)
  ///
  /// * [String] state:
  ///   Filter by state/province name
  ///
  /// * [String] tagId:
  ///   Filter assets with a specific tag
  ///
  /// * [List<String>] tagIds:
  ///   Filter assets with any of these tags (multi-select)
  ///
  /// * [String] takenAfter:
  ///   Only include assets taken on or after this date (ISO 8601)
  ///
  /// * [String] takenBefore:
  ///   Only include assets taken on or before this date (ISO 8601)
  ///
  /// * [AssetTypeEnum] type:
  ///   Filter by asset type (IMAGE or VIDEO)
  ///
  /// * [String] userId:
  ///   Filter assets by specific user ID
  ///
  /// * [AssetVisibility] visibility:
  ///   Filter by asset visibility status (ARCHIVE, TIMELINE, HIDDEN, LOCKED)
  ///
  /// * [bool] withCoordinates:
  ///   Include location data in the response
  ///
  /// * [bool] withPartners:
  ///   Include assets shared by partners
  ///
  /// * [bool] withSharedSpaces:
  ///   Include assets from shared spaces where the user has timeline enabled
  ///
  /// * [bool] withStacked:
  ///   Include stacked assets in the response. When true, only primary assets from stacks are returned.
  Future<TimeBucketAssetResponseDto?> getTimeBucket(String timeBucket, { String? albumId, String? bbox, TimeBucketSize? bucketSize, String? city, String? country, String? description, bool? isFavorite, bool? isInAlbum, bool? isNotInAlbum, bool? isTrashed, String? key, String? lensModel, String? locationPresence, String? make, String? model, String? ocr, AssetOrder? order, AssetOrderBy? orderBy, String? originalFileName, String? ownerId, String? personId, List<String>? personIds, int? rating, String? slug, String? spaceId, String? spacePersonId, List<String>? spacePersonIds, String? state, String? tagId, List<String>? tagIds, String? takenAfter, String? takenBefore, AssetTypeEnum? type, String? userId, AssetVisibility? visibility, bool? withCoordinates, bool? withPartners, bool? withSharedSpaces, bool? withStacked, Future<void>? abortTrigger, }) async {
    final response = await getTimeBucketWithHttpInfo(timeBucket, albumId: albumId, bbox: bbox, bucketSize: bucketSize, city: city, country: country, description: description, isFavorite: isFavorite, isInAlbum: isInAlbum, isNotInAlbum: isNotInAlbum, isTrashed: isTrashed, key: key, lensModel: lensModel, locationPresence: locationPresence, make: make, model: model, ocr: ocr, order: order, orderBy: orderBy, originalFileName: originalFileName, ownerId: ownerId, personId: personId, personIds: personIds, rating: rating, slug: slug, spaceId: spaceId, spacePersonId: spacePersonId, spacePersonIds: spacePersonIds, state: state, tagId: tagId, tagIds: tagIds, takenAfter: takenAfter, takenBefore: takenBefore, type: type, userId: userId, visibility: visibility, withCoordinates: withCoordinates, withPartners: withPartners, withSharedSpaces: withSharedSpaces, withStacked: withStacked, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'TimeBucketAssetResponseDto',) as TimeBucketAssetResponseDto;
    
    }
    return null;
  }

  /// Get time bucket covers
  ///
  /// Resolve representative cover assets for the requested time buckets.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [List<String>] timeBuckets (required):
  ///   Time bucket identifiers (YYYY-MM-DD) to resolve covers for
  ///
  /// * [String] albumId:
  ///   Filter assets belonging to a specific album
  ///
  /// * [String] bbox:
  ///   Bounding box coordinates as west,south,east,north (WGS84)
  ///
  /// * [TimeBucketSize] bucketSize:
  ///   Timeline bucket granularity. Defaults to month for backwards compatibility
  ///
  /// * [String] city:
  ///   Filter by city name
  ///
  /// * [String] country:
  ///   Filter by country name
  ///
  /// * [String] description:
  ///   Filter by asset description (substring, case/accent-insensitive)
  ///
  /// * [bool] isFavorite:
  ///   Filter by favorite status (true for favorites only, false for non-favorites only)
  ///
  /// * [bool] isInAlbum:
  ///   Filter assets in at least one album
  ///
  /// * [bool] isNotInAlbum:
  ///   Filter assets not in any album
  ///
  /// * [bool] isTrashed:
  ///   Filter by trash status (true for trashed assets only, false for non-trashed only)
  ///
  /// * [String] key:
  ///
  /// * [String] lensModel:
  ///   Filter by camera lens model
  ///
  /// * [String] locationPresence:
  ///   Filter for assets with no location: noGps (no coordinates) or noPlaceName (coordinates the geocoder could not name). Cannot be combined with city, state or country.
  ///
  /// * [String] make:
  ///   Filter by camera make
  ///
  /// * [String] model:
  ///   Filter by camera model
  ///
  /// * [String] ocr:
  ///   Filter by OCR text content (substring, case/accent-insensitive)
  ///
  /// * [AssetOrder] order:
  ///   Sort order for assets within time buckets (ASC for oldest first, DESC for newest first)
  ///
  /// * [AssetOrderBy] orderBy:
  ///   Date to group and order assets by (takenAt for date taken, createdAt for date added to Immich)
  ///
  /// * [String] originalFileName:
  ///   Filter by original filename (substring, case/accent-insensitive)
  ///
  /// * [String] ownerId:
  ///   Filter by asset owner (contributor). Narrows within the current scope and never widens it. This is NOT the same as userId, which selects whose timeline is being composed.
  ///
  /// * [String] personId:
  ///   Filter assets containing a specific person (face recognition)
  ///
  /// * [List<String>] personIds:
  ///   Filter assets containing any of these persons (multi-select)
  ///
  /// * [int] rating:
  ///   Minimum star rating (>=)
  ///
  /// * [String] slug:
  ///
  /// * [String] spaceId:
  ///   Filter assets belonging to a specific shared space
  ///
  /// * [String] spacePersonId:
  ///   Filter assets containing a specific shared space person (space face recognition)
  ///
  /// * [List<String>] spacePersonIds:
  ///   Filter assets containing any of these shared space persons (multi-select)
  ///
  /// * [String] state:
  ///   Filter by state/province name
  ///
  /// * [String] tagId:
  ///   Filter assets with a specific tag
  ///
  /// * [List<String>] tagIds:
  ///   Filter assets with any of these tags (multi-select)
  ///
  /// * [String] takenAfter:
  ///   Only include assets taken on or after this date (ISO 8601)
  ///
  /// * [String] takenBefore:
  ///   Only include assets taken on or before this date (ISO 8601)
  ///
  /// * [AssetTypeEnum] type:
  ///   Filter by asset type (IMAGE or VIDEO)
  ///
  /// * [String] userId:
  ///   Filter assets by specific user ID
  ///
  /// * [AssetVisibility] visibility:
  ///   Filter by asset visibility status (ARCHIVE, TIMELINE, HIDDEN, LOCKED)
  ///
  /// * [bool] withCoordinates:
  ///   Include location data in the response
  ///
  /// * [bool] withPartners:
  ///   Include assets shared by partners
  ///
  /// * [bool] withSharedSpaces:
  ///   Include assets from shared spaces where the user has timeline enabled
  ///
  /// * [bool] withStacked:
  ///   Include stacked assets in the response. When true, only primary assets from stacks are returned.
  Future<Response> getTimeBucketCoversWithHttpInfo(List<String> timeBuckets, { String? albumId, String? bbox, TimeBucketSize? bucketSize, String? city, String? country, String? description, bool? isFavorite, bool? isInAlbum, bool? isNotInAlbum, bool? isTrashed, String? key, String? lensModel, String? locationPresence, String? make, String? model, String? ocr, AssetOrder? order, AssetOrderBy? orderBy, String? originalFileName, String? ownerId, String? personId, List<String>? personIds, int? rating, String? slug, String? spaceId, String? spacePersonId, List<String>? spacePersonIds, String? state, String? tagId, List<String>? tagIds, String? takenAfter, String? takenBefore, AssetTypeEnum? type, String? userId, AssetVisibility? visibility, bool? withCoordinates, bool? withPartners, bool? withSharedSpaces, bool? withStacked, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/timeline/bucket-covers';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (albumId != null) {
      queryParams.addAll(_queryParams('', 'albumId', albumId));
    }
    if (bbox != null) {
      queryParams.addAll(_queryParams('', 'bbox', bbox));
    }
    if (bucketSize != null) {
      queryParams.addAll(_queryParams('', 'bucketSize', bucketSize));
    }
    if (city != null) {
      queryParams.addAll(_queryParams('', 'city', city));
    }
    if (country != null) {
      queryParams.addAll(_queryParams('', 'country', country));
    }
    if (description != null) {
      queryParams.addAll(_queryParams('', 'description', description));
    }
    if (isFavorite != null) {
      queryParams.addAll(_queryParams('', 'isFavorite', isFavorite));
    }
    if (isInAlbum != null) {
      queryParams.addAll(_queryParams('', 'isInAlbum', isInAlbum));
    }
    if (isNotInAlbum != null) {
      queryParams.addAll(_queryParams('', 'isNotInAlbum', isNotInAlbum));
    }
    if (isTrashed != null) {
      queryParams.addAll(_queryParams('', 'isTrashed', isTrashed));
    }
    if (key != null) {
      queryParams.addAll(_queryParams('', 'key', key));
    }
    if (lensModel != null) {
      queryParams.addAll(_queryParams('', 'lensModel', lensModel));
    }
    if (locationPresence != null) {
      queryParams.addAll(_queryParams('', 'locationPresence', locationPresence));
    }
    if (make != null) {
      queryParams.addAll(_queryParams('', 'make', make));
    }
    if (model != null) {
      queryParams.addAll(_queryParams('', 'model', model));
    }
    if (ocr != null) {
      queryParams.addAll(_queryParams('', 'ocr', ocr));
    }
    if (order != null) {
      queryParams.addAll(_queryParams('', 'order', order));
    }
    if (orderBy != null) {
      queryParams.addAll(_queryParams('', 'orderBy', orderBy));
    }
    if (originalFileName != null) {
      queryParams.addAll(_queryParams('', 'originalFileName', originalFileName));
    }
    if (ownerId != null) {
      queryParams.addAll(_queryParams('', 'ownerId', ownerId));
    }
    if (personId != null) {
      queryParams.addAll(_queryParams('', 'personId', personId));
    }
    if (personIds != null) {
      queryParams.addAll(_queryParams('multi', 'personIds', personIds));
    }
    if (rating != null) {
      queryParams.addAll(_queryParams('', 'rating', rating));
    }
    if (slug != null) {
      queryParams.addAll(_queryParams('', 'slug', slug));
    }
    if (spaceId != null) {
      queryParams.addAll(_queryParams('', 'spaceId', spaceId));
    }
    if (spacePersonId != null) {
      queryParams.addAll(_queryParams('', 'spacePersonId', spacePersonId));
    }
    if (spacePersonIds != null) {
      queryParams.addAll(_queryParams('multi', 'spacePersonIds', spacePersonIds));
    }
    if (state != null) {
      queryParams.addAll(_queryParams('', 'state', state));
    }
    if (tagId != null) {
      queryParams.addAll(_queryParams('', 'tagId', tagId));
    }
    if (tagIds != null) {
      queryParams.addAll(_queryParams('multi', 'tagIds', tagIds));
    }
    if (takenAfter != null) {
      queryParams.addAll(_queryParams('', 'takenAfter', takenAfter));
    }
    if (takenBefore != null) {
      queryParams.addAll(_queryParams('', 'takenBefore', takenBefore));
    }
      queryParams.addAll(_queryParams('multi', 'timeBuckets', timeBuckets));
    if (type != null) {
      queryParams.addAll(_queryParams('', 'type', type));
    }
    if (userId != null) {
      queryParams.addAll(_queryParams('', 'userId', userId));
    }
    if (visibility != null) {
      queryParams.addAll(_queryParams('', 'visibility', visibility));
    }
    if (withCoordinates != null) {
      queryParams.addAll(_queryParams('', 'withCoordinates', withCoordinates));
    }
    if (withPartners != null) {
      queryParams.addAll(_queryParams('', 'withPartners', withPartners));
    }
    if (withSharedSpaces != null) {
      queryParams.addAll(_queryParams('', 'withSharedSpaces', withSharedSpaces));
    }
    if (withStacked != null) {
      queryParams.addAll(_queryParams('', 'withStacked', withStacked));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get time bucket covers
  ///
  /// Resolve representative cover assets for the requested time buckets.
  ///
  /// Parameters:
  ///
  /// * [List<String>] timeBuckets (required):
  ///   Time bucket identifiers (YYYY-MM-DD) to resolve covers for
  ///
  /// * [String] albumId:
  ///   Filter assets belonging to a specific album
  ///
  /// * [String] bbox:
  ///   Bounding box coordinates as west,south,east,north (WGS84)
  ///
  /// * [TimeBucketSize] bucketSize:
  ///   Timeline bucket granularity. Defaults to month for backwards compatibility
  ///
  /// * [String] city:
  ///   Filter by city name
  ///
  /// * [String] country:
  ///   Filter by country name
  ///
  /// * [String] description:
  ///   Filter by asset description (substring, case/accent-insensitive)
  ///
  /// * [bool] isFavorite:
  ///   Filter by favorite status (true for favorites only, false for non-favorites only)
  ///
  /// * [bool] isInAlbum:
  ///   Filter assets in at least one album
  ///
  /// * [bool] isNotInAlbum:
  ///   Filter assets not in any album
  ///
  /// * [bool] isTrashed:
  ///   Filter by trash status (true for trashed assets only, false for non-trashed only)
  ///
  /// * [String] key:
  ///
  /// * [String] lensModel:
  ///   Filter by camera lens model
  ///
  /// * [String] locationPresence:
  ///   Filter for assets with no location: noGps (no coordinates) or noPlaceName (coordinates the geocoder could not name). Cannot be combined with city, state or country.
  ///
  /// * [String] make:
  ///   Filter by camera make
  ///
  /// * [String] model:
  ///   Filter by camera model
  ///
  /// * [String] ocr:
  ///   Filter by OCR text content (substring, case/accent-insensitive)
  ///
  /// * [AssetOrder] order:
  ///   Sort order for assets within time buckets (ASC for oldest first, DESC for newest first)
  ///
  /// * [AssetOrderBy] orderBy:
  ///   Date to group and order assets by (takenAt for date taken, createdAt for date added to Immich)
  ///
  /// * [String] originalFileName:
  ///   Filter by original filename (substring, case/accent-insensitive)
  ///
  /// * [String] ownerId:
  ///   Filter by asset owner (contributor). Narrows within the current scope and never widens it. This is NOT the same as userId, which selects whose timeline is being composed.
  ///
  /// * [String] personId:
  ///   Filter assets containing a specific person (face recognition)
  ///
  /// * [List<String>] personIds:
  ///   Filter assets containing any of these persons (multi-select)
  ///
  /// * [int] rating:
  ///   Minimum star rating (>=)
  ///
  /// * [String] slug:
  ///
  /// * [String] spaceId:
  ///   Filter assets belonging to a specific shared space
  ///
  /// * [String] spacePersonId:
  ///   Filter assets containing a specific shared space person (space face recognition)
  ///
  /// * [List<String>] spacePersonIds:
  ///   Filter assets containing any of these shared space persons (multi-select)
  ///
  /// * [String] state:
  ///   Filter by state/province name
  ///
  /// * [String] tagId:
  ///   Filter assets with a specific tag
  ///
  /// * [List<String>] tagIds:
  ///   Filter assets with any of these tags (multi-select)
  ///
  /// * [String] takenAfter:
  ///   Only include assets taken on or after this date (ISO 8601)
  ///
  /// * [String] takenBefore:
  ///   Only include assets taken on or before this date (ISO 8601)
  ///
  /// * [AssetTypeEnum] type:
  ///   Filter by asset type (IMAGE or VIDEO)
  ///
  /// * [String] userId:
  ///   Filter assets by specific user ID
  ///
  /// * [AssetVisibility] visibility:
  ///   Filter by asset visibility status (ARCHIVE, TIMELINE, HIDDEN, LOCKED)
  ///
  /// * [bool] withCoordinates:
  ///   Include location data in the response
  ///
  /// * [bool] withPartners:
  ///   Include assets shared by partners
  ///
  /// * [bool] withSharedSpaces:
  ///   Include assets from shared spaces where the user has timeline enabled
  ///
  /// * [bool] withStacked:
  ///   Include stacked assets in the response. When true, only primary assets from stacks are returned.
  Future<List<TimeBucketCoverResponseDto>?> getTimeBucketCovers(List<String> timeBuckets, { String? albumId, String? bbox, TimeBucketSize? bucketSize, String? city, String? country, String? description, bool? isFavorite, bool? isInAlbum, bool? isNotInAlbum, bool? isTrashed, String? key, String? lensModel, String? locationPresence, String? make, String? model, String? ocr, AssetOrder? order, AssetOrderBy? orderBy, String? originalFileName, String? ownerId, String? personId, List<String>? personIds, int? rating, String? slug, String? spaceId, String? spacePersonId, List<String>? spacePersonIds, String? state, String? tagId, List<String>? tagIds, String? takenAfter, String? takenBefore, AssetTypeEnum? type, String? userId, AssetVisibility? visibility, bool? withCoordinates, bool? withPartners, bool? withSharedSpaces, bool? withStacked, Future<void>? abortTrigger, }) async {
    final response = await getTimeBucketCoversWithHttpInfo(timeBuckets, albumId: albumId, bbox: bbox, bucketSize: bucketSize, city: city, country: country, description: description, isFavorite: isFavorite, isInAlbum: isInAlbum, isNotInAlbum: isNotInAlbum, isTrashed: isTrashed, key: key, lensModel: lensModel, locationPresence: locationPresence, make: make, model: model, ocr: ocr, order: order, orderBy: orderBy, originalFileName: originalFileName, ownerId: ownerId, personId: personId, personIds: personIds, rating: rating, slug: slug, spaceId: spaceId, spacePersonId: spacePersonId, spacePersonIds: spacePersonIds, state: state, tagId: tagId, tagIds: tagIds, takenAfter: takenAfter, takenBefore: takenBefore, type: type, userId: userId, visibility: visibility, withCoordinates: withCoordinates, withPartners: withPartners, withSharedSpaces: withSharedSpaces, withStacked: withStacked, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<TimeBucketCoverResponseDto>') as List)
        .cast<TimeBucketCoverResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get time buckets
  ///
  /// Retrieve a list of all minimal time buckets.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] albumId:
  ///   Filter assets belonging to a specific album
  ///
  /// * [String] bbox:
  ///   Bounding box coordinates as west,south,east,north (WGS84)
  ///
  /// * [TimeBucketSize] bucketSize:
  ///   Timeline bucket granularity. Defaults to month for backwards compatibility
  ///
  /// * [String] city:
  ///   Filter by city name
  ///
  /// * [String] country:
  ///   Filter by country name
  ///
  /// * [String] description:
  ///   Filter by asset description (substring, case/accent-insensitive)
  ///
  /// * [bool] isFavorite:
  ///   Filter by favorite status (true for favorites only, false for non-favorites only)
  ///
  /// * [bool] isInAlbum:
  ///   Filter assets in at least one album
  ///
  /// * [bool] isNotInAlbum:
  ///   Filter assets not in any album
  ///
  /// * [bool] isTrashed:
  ///   Filter by trash status (true for trashed assets only, false for non-trashed only)
  ///
  /// * [String] key:
  ///
  /// * [String] lensModel:
  ///   Filter by camera lens model
  ///
  /// * [String] locationPresence:
  ///   Filter for assets with no location: noGps (no coordinates) or noPlaceName (coordinates the geocoder could not name). Cannot be combined with city, state or country.
  ///
  /// * [String] make:
  ///   Filter by camera make
  ///
  /// * [String] model:
  ///   Filter by camera model
  ///
  /// * [String] ocr:
  ///   Filter by OCR text content (substring, case/accent-insensitive)
  ///
  /// * [AssetOrder] order:
  ///   Sort order for assets within time buckets (ASC for oldest first, DESC for newest first)
  ///
  /// * [AssetOrderBy] orderBy:
  ///   Date to group and order assets by (takenAt for date taken, createdAt for date added to Immich)
  ///
  /// * [String] originalFileName:
  ///   Filter by original filename (substring, case/accent-insensitive)
  ///
  /// * [String] ownerId:
  ///   Filter by asset owner (contributor). Narrows within the current scope and never widens it. This is NOT the same as userId, which selects whose timeline is being composed.
  ///
  /// * [String] personId:
  ///   Filter assets containing a specific person (face recognition)
  ///
  /// * [List<String>] personIds:
  ///   Filter assets containing any of these persons (multi-select)
  ///
  /// * [int] rating:
  ///   Minimum star rating (>=)
  ///
  /// * [String] slug:
  ///
  /// * [String] spaceId:
  ///   Filter assets belonging to a specific shared space
  ///
  /// * [String] spacePersonId:
  ///   Filter assets containing a specific shared space person (space face recognition)
  ///
  /// * [List<String>] spacePersonIds:
  ///   Filter assets containing any of these shared space persons (multi-select)
  ///
  /// * [String] state:
  ///   Filter by state/province name
  ///
  /// * [String] tagId:
  ///   Filter assets with a specific tag
  ///
  /// * [List<String>] tagIds:
  ///   Filter assets with any of these tags (multi-select)
  ///
  /// * [String] takenAfter:
  ///   Only include assets taken on or after this date (ISO 8601)
  ///
  /// * [String] takenBefore:
  ///   Only include assets taken on or before this date (ISO 8601)
  ///
  /// * [AssetTypeEnum] type:
  ///   Filter by asset type (IMAGE or VIDEO)
  ///
  /// * [String] userId:
  ///   Filter assets by specific user ID
  ///
  /// * [AssetVisibility] visibility:
  ///   Filter by asset visibility status (ARCHIVE, TIMELINE, HIDDEN, LOCKED)
  ///
  /// * [bool] withCoordinates:
  ///   Include location data in the response
  ///
  /// * [bool] withPartners:
  ///   Include assets shared by partners
  ///
  /// * [bool] withSharedSpaces:
  ///   Include assets from shared spaces where the user has timeline enabled
  ///
  /// * [bool] withStacked:
  ///   Include stacked assets in the response. When true, only primary assets from stacks are returned.
  Future<Response> getTimeBucketsWithHttpInfo({ String? albumId, String? bbox, TimeBucketSize? bucketSize, String? city, String? country, String? description, bool? isFavorite, bool? isInAlbum, bool? isNotInAlbum, bool? isTrashed, String? key, String? lensModel, String? locationPresence, String? make, String? model, String? ocr, AssetOrder? order, AssetOrderBy? orderBy, String? originalFileName, String? ownerId, String? personId, List<String>? personIds, int? rating, String? slug, String? spaceId, String? spacePersonId, List<String>? spacePersonIds, String? state, String? tagId, List<String>? tagIds, String? takenAfter, String? takenBefore, AssetTypeEnum? type, String? userId, AssetVisibility? visibility, bool? withCoordinates, bool? withPartners, bool? withSharedSpaces, bool? withStacked, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/timeline/buckets';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (albumId != null) {
      queryParams.addAll(_queryParams('', 'albumId', albumId));
    }
    if (bbox != null) {
      queryParams.addAll(_queryParams('', 'bbox', bbox));
    }
    if (bucketSize != null) {
      queryParams.addAll(_queryParams('', 'bucketSize', bucketSize));
    }
    if (city != null) {
      queryParams.addAll(_queryParams('', 'city', city));
    }
    if (country != null) {
      queryParams.addAll(_queryParams('', 'country', country));
    }
    if (description != null) {
      queryParams.addAll(_queryParams('', 'description', description));
    }
    if (isFavorite != null) {
      queryParams.addAll(_queryParams('', 'isFavorite', isFavorite));
    }
    if (isInAlbum != null) {
      queryParams.addAll(_queryParams('', 'isInAlbum', isInAlbum));
    }
    if (isNotInAlbum != null) {
      queryParams.addAll(_queryParams('', 'isNotInAlbum', isNotInAlbum));
    }
    if (isTrashed != null) {
      queryParams.addAll(_queryParams('', 'isTrashed', isTrashed));
    }
    if (key != null) {
      queryParams.addAll(_queryParams('', 'key', key));
    }
    if (lensModel != null) {
      queryParams.addAll(_queryParams('', 'lensModel', lensModel));
    }
    if (locationPresence != null) {
      queryParams.addAll(_queryParams('', 'locationPresence', locationPresence));
    }
    if (make != null) {
      queryParams.addAll(_queryParams('', 'make', make));
    }
    if (model != null) {
      queryParams.addAll(_queryParams('', 'model', model));
    }
    if (ocr != null) {
      queryParams.addAll(_queryParams('', 'ocr', ocr));
    }
    if (order != null) {
      queryParams.addAll(_queryParams('', 'order', order));
    }
    if (orderBy != null) {
      queryParams.addAll(_queryParams('', 'orderBy', orderBy));
    }
    if (originalFileName != null) {
      queryParams.addAll(_queryParams('', 'originalFileName', originalFileName));
    }
    if (ownerId != null) {
      queryParams.addAll(_queryParams('', 'ownerId', ownerId));
    }
    if (personId != null) {
      queryParams.addAll(_queryParams('', 'personId', personId));
    }
    if (personIds != null) {
      queryParams.addAll(_queryParams('multi', 'personIds', personIds));
    }
    if (rating != null) {
      queryParams.addAll(_queryParams('', 'rating', rating));
    }
    if (slug != null) {
      queryParams.addAll(_queryParams('', 'slug', slug));
    }
    if (spaceId != null) {
      queryParams.addAll(_queryParams('', 'spaceId', spaceId));
    }
    if (spacePersonId != null) {
      queryParams.addAll(_queryParams('', 'spacePersonId', spacePersonId));
    }
    if (spacePersonIds != null) {
      queryParams.addAll(_queryParams('multi', 'spacePersonIds', spacePersonIds));
    }
    if (state != null) {
      queryParams.addAll(_queryParams('', 'state', state));
    }
    if (tagId != null) {
      queryParams.addAll(_queryParams('', 'tagId', tagId));
    }
    if (tagIds != null) {
      queryParams.addAll(_queryParams('multi', 'tagIds', tagIds));
    }
    if (takenAfter != null) {
      queryParams.addAll(_queryParams('', 'takenAfter', takenAfter));
    }
    if (takenBefore != null) {
      queryParams.addAll(_queryParams('', 'takenBefore', takenBefore));
    }
    if (type != null) {
      queryParams.addAll(_queryParams('', 'type', type));
    }
    if (userId != null) {
      queryParams.addAll(_queryParams('', 'userId', userId));
    }
    if (visibility != null) {
      queryParams.addAll(_queryParams('', 'visibility', visibility));
    }
    if (withCoordinates != null) {
      queryParams.addAll(_queryParams('', 'withCoordinates', withCoordinates));
    }
    if (withPartners != null) {
      queryParams.addAll(_queryParams('', 'withPartners', withPartners));
    }
    if (withSharedSpaces != null) {
      queryParams.addAll(_queryParams('', 'withSharedSpaces', withSharedSpaces));
    }
    if (withStacked != null) {
      queryParams.addAll(_queryParams('', 'withStacked', withStacked));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get time buckets
  ///
  /// Retrieve a list of all minimal time buckets.
  ///
  /// Parameters:
  ///
  /// * [String] albumId:
  ///   Filter assets belonging to a specific album
  ///
  /// * [String] bbox:
  ///   Bounding box coordinates as west,south,east,north (WGS84)
  ///
  /// * [TimeBucketSize] bucketSize:
  ///   Timeline bucket granularity. Defaults to month for backwards compatibility
  ///
  /// * [String] city:
  ///   Filter by city name
  ///
  /// * [String] country:
  ///   Filter by country name
  ///
  /// * [String] description:
  ///   Filter by asset description (substring, case/accent-insensitive)
  ///
  /// * [bool] isFavorite:
  ///   Filter by favorite status (true for favorites only, false for non-favorites only)
  ///
  /// * [bool] isInAlbum:
  ///   Filter assets in at least one album
  ///
  /// * [bool] isNotInAlbum:
  ///   Filter assets not in any album
  ///
  /// * [bool] isTrashed:
  ///   Filter by trash status (true for trashed assets only, false for non-trashed only)
  ///
  /// * [String] key:
  ///
  /// * [String] lensModel:
  ///   Filter by camera lens model
  ///
  /// * [String] locationPresence:
  ///   Filter for assets with no location: noGps (no coordinates) or noPlaceName (coordinates the geocoder could not name). Cannot be combined with city, state or country.
  ///
  /// * [String] make:
  ///   Filter by camera make
  ///
  /// * [String] model:
  ///   Filter by camera model
  ///
  /// * [String] ocr:
  ///   Filter by OCR text content (substring, case/accent-insensitive)
  ///
  /// * [AssetOrder] order:
  ///   Sort order for assets within time buckets (ASC for oldest first, DESC for newest first)
  ///
  /// * [AssetOrderBy] orderBy:
  ///   Date to group and order assets by (takenAt for date taken, createdAt for date added to Immich)
  ///
  /// * [String] originalFileName:
  ///   Filter by original filename (substring, case/accent-insensitive)
  ///
  /// * [String] ownerId:
  ///   Filter by asset owner (contributor). Narrows within the current scope and never widens it. This is NOT the same as userId, which selects whose timeline is being composed.
  ///
  /// * [String] personId:
  ///   Filter assets containing a specific person (face recognition)
  ///
  /// * [List<String>] personIds:
  ///   Filter assets containing any of these persons (multi-select)
  ///
  /// * [int] rating:
  ///   Minimum star rating (>=)
  ///
  /// * [String] slug:
  ///
  /// * [String] spaceId:
  ///   Filter assets belonging to a specific shared space
  ///
  /// * [String] spacePersonId:
  ///   Filter assets containing a specific shared space person (space face recognition)
  ///
  /// * [List<String>] spacePersonIds:
  ///   Filter assets containing any of these shared space persons (multi-select)
  ///
  /// * [String] state:
  ///   Filter by state/province name
  ///
  /// * [String] tagId:
  ///   Filter assets with a specific tag
  ///
  /// * [List<String>] tagIds:
  ///   Filter assets with any of these tags (multi-select)
  ///
  /// * [String] takenAfter:
  ///   Only include assets taken on or after this date (ISO 8601)
  ///
  /// * [String] takenBefore:
  ///   Only include assets taken on or before this date (ISO 8601)
  ///
  /// * [AssetTypeEnum] type:
  ///   Filter by asset type (IMAGE or VIDEO)
  ///
  /// * [String] userId:
  ///   Filter assets by specific user ID
  ///
  /// * [AssetVisibility] visibility:
  ///   Filter by asset visibility status (ARCHIVE, TIMELINE, HIDDEN, LOCKED)
  ///
  /// * [bool] withCoordinates:
  ///   Include location data in the response
  ///
  /// * [bool] withPartners:
  ///   Include assets shared by partners
  ///
  /// * [bool] withSharedSpaces:
  ///   Include assets from shared spaces where the user has timeline enabled
  ///
  /// * [bool] withStacked:
  ///   Include stacked assets in the response. When true, only primary assets from stacks are returned.
  Future<List<TimeBucketsResponseDto>?> getTimeBuckets({ String? albumId, String? bbox, TimeBucketSize? bucketSize, String? city, String? country, String? description, bool? isFavorite, bool? isInAlbum, bool? isNotInAlbum, bool? isTrashed, String? key, String? lensModel, String? locationPresence, String? make, String? model, String? ocr, AssetOrder? order, AssetOrderBy? orderBy, String? originalFileName, String? ownerId, String? personId, List<String>? personIds, int? rating, String? slug, String? spaceId, String? spacePersonId, List<String>? spacePersonIds, String? state, String? tagId, List<String>? tagIds, String? takenAfter, String? takenBefore, AssetTypeEnum? type, String? userId, AssetVisibility? visibility, bool? withCoordinates, bool? withPartners, bool? withSharedSpaces, bool? withStacked, Future<void>? abortTrigger, }) async {
    final response = await getTimeBucketsWithHttpInfo(albumId: albumId, bbox: bbox, bucketSize: bucketSize, city: city, country: country, description: description, isFavorite: isFavorite, isInAlbum: isInAlbum, isNotInAlbum: isNotInAlbum, isTrashed: isTrashed, key: key, lensModel: lensModel, locationPresence: locationPresence, make: make, model: model, ocr: ocr, order: order, orderBy: orderBy, originalFileName: originalFileName, ownerId: ownerId, personId: personId, personIds: personIds, rating: rating, slug: slug, spaceId: spaceId, spacePersonId: spacePersonId, spacePersonIds: spacePersonIds, state: state, tagId: tagId, tagIds: tagIds, takenAfter: takenAfter, takenBefore: takenBefore, type: type, userId: userId, visibility: visibility, withCoordinates: withCoordinates, withPartners: withPartners, withSharedSpaces: withSharedSpaces, withStacked: withStacked, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<TimeBucketsResponseDto>') as List)
        .cast<TimeBucketsResponseDto>()
        .toList(growable: false);

    }
    return null;
  }
}

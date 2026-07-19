//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class SharedSpacesApi {
  SharedSpacesApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Add assets to a shared space
  ///
  /// Add one or more assets to a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceAssetAddDto] sharedSpaceAssetAddDto (required):
  Future<Response> addAssetsWithHttpInfo(String id, SharedSpaceAssetAddDto sharedSpaceAssetAddDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/assets'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceAssetAddDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Add assets to a shared space
  ///
  /// Add one or more assets to a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceAssetAddDto] sharedSpaceAssetAddDto (required):
  Future<void> addAssets(String id, SharedSpaceAssetAddDto sharedSpaceAssetAddDto, { Future<void>? abortTrigger, }) async {
    final response = await addAssetsWithHttpInfo(id, sharedSpaceAssetAddDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Add a member to a shared space
  ///
  /// Add a new member to a shared space with an optional role.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceMemberCreateDto] sharedSpaceMemberCreateDto (required):
  Future<Response> addMemberWithHttpInfo(String id, SharedSpaceMemberCreateDto sharedSpaceMemberCreateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/members'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceMemberCreateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Add a member to a shared space
  ///
  /// Add a new member to a shared space with an optional role.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceMemberCreateDto] sharedSpaceMemberCreateDto (required):
  Future<SharedSpaceMemberResponseDto?> addMember(String id, SharedSpaceMemberCreateDto sharedSpaceMemberCreateDto, { Future<void>? abortTrigger, }) async {
    final response = await addMemberWithHttpInfo(id, sharedSpaceMemberCreateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpaceMemberResponseDto',) as SharedSpaceMemberResponseDto;
    
    }
    return null;
  }

  /// Add all user assets to a shared space
  ///
  /// Queues a background job to add all assets owned by the authenticated user to the space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> bulkAddAssetsWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/assets/bulk-add'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Add all user assets to a shared space
  ///
  /// Queues a background job to add all assets owned by the authenticated user to the space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> bulkAddAssets(String id, { Future<void>? abortTrigger, }) async {
    final response = await bulkAddAssetsWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Create a shared space
  ///
  /// Create a new shared space for collaborative asset management.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [SharedSpaceCreateDto] sharedSpaceCreateDto (required):
  Future<Response> createSpaceWithHttpInfo(SharedSpaceCreateDto sharedSpaceCreateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces';

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceCreateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Create a shared space
  ///
  /// Create a new shared space for collaborative asset management.
  ///
  /// Parameters:
  ///
  /// * [SharedSpaceCreateDto] sharedSpaceCreateDto (required):
  Future<SharedSpaceResponseDto?> createSpace(SharedSpaceCreateDto sharedSpaceCreateDto, { Future<void>? abortTrigger, }) async {
    final response = await createSpaceWithHttpInfo(sharedSpaceCreateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpaceResponseDto',) as SharedSpaceResponseDto;
    
    }
    return null;
  }

  /// Deduplicate people in a shared space
  ///
  /// Queue a background job to find and merge duplicate people in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> deduplicateSpacePeopleWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/deduplicate'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Deduplicate people in a shared space
  ///
  /// Queue a background job to find and merge duplicate people in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> deduplicateSpacePeople(String id, { Future<void>? abortTrigger, }) async {
    final response = await deduplicateSpacePeopleWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Delete a person from a shared space
  ///
  /// Permanently delete a person and their face assignments from a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<Response> deleteSpacePersonWithHttpInfo(String id, String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Delete a person from a shared space
  ///
  /// Permanently delete a person and their face assignments from a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<void> deleteSpacePerson(String id, String personId, { Future<void>? abortTrigger, }) async {
    final response = await deleteSpacePersonWithHttpInfo(id, personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Delete a person alias in a shared space
  ///
  /// Remove a user-specific alias for a person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<Response> deleteSpacePersonAliasWithHttpInfo(String id, String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/alias'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Delete a person alias in a shared space
  ///
  /// Remove a user-specific alias for a person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<void> deleteSpacePersonAlias(String id, String personId, { Future<void>? abortTrigger, }) async {
    final response = await deleteSpacePersonAliasWithHttpInfo(id, personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get all shared spaces
  ///
  /// Retrieve all shared spaces the user is a member of.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getAllSpacesWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get all shared spaces
  ///
  /// Retrieve all shared spaces the user is a member of.
  Future<List<SharedSpaceResponseDto>?> getAllSpaces({ Future<void>? abortTrigger, }) async {
    final response = await getAllSpacesWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<SharedSpaceResponseDto>') as List)
        .cast<SharedSpaceResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get members of a shared space
  ///
  /// Retrieve all members of a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getMembersWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/members'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get members of a shared space
  ///
  /// Retrieve all members of a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<List<SharedSpaceMemberResponseDto>?> getMembers(String id, { Future<void>? abortTrigger, }) async {
    final response = await getMembersWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<SharedSpaceMemberResponseDto>') as List)
        .cast<SharedSpaceMemberResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// List albums linked to a shared space
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getSharedSpaceAlbumsWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/albums'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// List albums linked to a shared space
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<List<SharedSpaceLinkedAlbumDto>?> getSharedSpaceAlbums(String id, { Future<void>? abortTrigger, }) async {
    final response = await getSharedSpaceAlbumsWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<SharedSpaceLinkedAlbumDto>') as List)
        .cast<SharedSpaceLinkedAlbumDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// List linked albums that contain the given assets
  ///
  /// Return the albums linked to this space that project any of the given assets into it (via the album or a cross-owner contribution). Used to explain why an album-projected asset cannot be removed from the space directly — it must be removed from the album instead.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceAssetRemoveDto] sharedSpaceAssetRemoveDto (required):
  Future<Response> getSharedSpaceAssetLinkedAlbumsWithHttpInfo(String id, SharedSpaceAssetRemoveDto sharedSpaceAssetRemoveDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/assets/linked-albums'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceAssetRemoveDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// List linked albums that contain the given assets
  ///
  /// Return the albums linked to this space that project any of the given assets into it (via the album or a cross-owner contribution). Used to explain why an album-projected asset cannot be removed from the space directly — it must be removed from the album instead.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceAssetRemoveDto] sharedSpaceAssetRemoveDto (required):
  Future<List<SharedSpaceAssetLinkedAlbumDto>?> getSharedSpaceAssetLinkedAlbums(String id, SharedSpaceAssetRemoveDto sharedSpaceAssetRemoveDto, { Future<void>? abortTrigger, }) async {
    final response = await getSharedSpaceAssetLinkedAlbumsWithHttpInfo(id, sharedSpaceAssetRemoveDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<SharedSpaceAssetLinkedAlbumDto>') as List)
        .cast<SharedSpaceAssetLinkedAlbumDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get a shared space
  ///
  /// Retrieve details of a specific shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getSpaceWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get a shared space
  ///
  /// Retrieve details of a specific shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<SharedSpaceResponseDto?> getSpace(String id, { Future<void>? abortTrigger, }) async {
    final response = await getSpaceWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpaceResponseDto',) as SharedSpaceResponseDto;
    
    }
    return null;
  }

  /// Get space activity feed
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] limit:
  ///   Number of items to return
  ///
  /// * [int] offset:
  ///   Number of items to skip
  Future<Response> getSpaceActivitiesWithHttpInfo(String id, { int? limit, int? offset, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/activities'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (offset != null) {
      queryParams.addAll(_queryParams('', 'offset', offset));
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

  /// Get space activity feed
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] limit:
  ///   Number of items to return
  ///
  /// * [int] offset:
  ///   Number of items to skip
  Future<List<SharedSpaceActivityResponseDto>?> getSpaceActivities(String id, { int? limit, int? offset, Future<void>? abortTrigger, }) async {
    final response = await getSpaceActivitiesWithHttpInfo(id, limit: limit, offset: offset, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<SharedSpaceActivityResponseDto>') as List)
        .cast<SharedSpaceActivityResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get map markers for a shared space
  ///
  /// Retrieve map markers for geotagged assets in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getSpaceMapMarkersWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/map-markers'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get map markers for a shared space
  ///
  /// Retrieve map markers for geotagged assets in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<List<MapMarkerResponseDto>?> getSpaceMapMarkers(String id, { Future<void>? abortTrigger, }) async {
    final response = await getSpaceMapMarkersWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<MapMarkerResponseDto>') as List)
        .cast<MapMarkerResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get people in a shared space
  ///
  /// Retrieve all people detected in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] limit:
  ///   Maximum number of people to return (named sorted alphabetically, unnamed by asset count)
  ///
  /// * [String] name:
  ///   Search by person name
  ///
  /// * [bool] named:
  ///
  /// * [int] offset:
  ///   Number of people to skip
  ///
  /// * [DateTime] takenAfter:
  ///
  /// * [DateTime] takenBefore:
  ///
  /// * [bool] withHidden:
  Future<Response> getSpacePeopleWithHttpInfo(String id, { int? limit, String? name, bool? named, int? offset, DateTime? takenAfter, DateTime? takenBefore, bool? withHidden, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (name != null) {
      queryParams.addAll(_queryParams('', 'name', name));
    }
    if (named != null) {
      queryParams.addAll(_queryParams('', 'named', named));
    }
    if (offset != null) {
      queryParams.addAll(_queryParams('', 'offset', offset));
    }
    if (takenAfter != null) {
      queryParams.addAll(_queryParams('', 'takenAfter', takenAfter));
    }
    if (takenBefore != null) {
      queryParams.addAll(_queryParams('', 'takenBefore', takenBefore));
    }
    if (withHidden != null) {
      queryParams.addAll(_queryParams('', 'withHidden', withHidden));
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

  /// Get people in a shared space
  ///
  /// Retrieve all people detected in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] limit:
  ///   Maximum number of people to return (named sorted alphabetically, unnamed by asset count)
  ///
  /// * [String] name:
  ///   Search by person name
  ///
  /// * [bool] named:
  ///
  /// * [int] offset:
  ///   Number of people to skip
  ///
  /// * [DateTime] takenAfter:
  ///
  /// * [DateTime] takenBefore:
  ///
  /// * [bool] withHidden:
  Future<List<SharedSpacePersonResponseDto>?> getSpacePeople(String id, { int? limit, String? name, bool? named, int? offset, DateTime? takenAfter, DateTime? takenBefore, bool? withHidden, Future<void>? abortTrigger, }) async {
    final response = await getSpacePeopleWithHttpInfo(id, limit: limit, name: name, named: named, offset: offset, takenAfter: takenAfter, takenBefore: takenBefore, withHidden: withHidden, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<SharedSpacePersonResponseDto>') as List)
        .cast<SharedSpacePersonResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get people face statistics in a shared space
  ///
  /// Retrieve detailed detected-face counts for a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] limit:
  ///   Maximum number of people to return (named sorted alphabetically, unnamed by asset count)
  ///
  /// * [String] name:
  ///   Search by person name
  ///
  /// * [bool] named:
  ///
  /// * [int] offset:
  ///   Number of people to skip
  ///
  /// * [DateTime] takenAfter:
  ///
  /// * [DateTime] takenBefore:
  ///
  /// * [bool] withHidden:
  Future<Response> getSpacePeopleFaceStatisticsWithHttpInfo(String id, { int? limit, String? name, bool? named, int? offset, DateTime? takenAfter, DateTime? takenBefore, bool? withHidden, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/face-statistics'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (name != null) {
      queryParams.addAll(_queryParams('', 'name', name));
    }
    if (named != null) {
      queryParams.addAll(_queryParams('', 'named', named));
    }
    if (offset != null) {
      queryParams.addAll(_queryParams('', 'offset', offset));
    }
    if (takenAfter != null) {
      queryParams.addAll(_queryParams('', 'takenAfter', takenAfter));
    }
    if (takenBefore != null) {
      queryParams.addAll(_queryParams('', 'takenBefore', takenBefore));
    }
    if (withHidden != null) {
      queryParams.addAll(_queryParams('', 'withHidden', withHidden));
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

  /// Get people face statistics in a shared space
  ///
  /// Retrieve detailed detected-face counts for a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] limit:
  ///   Maximum number of people to return (named sorted alphabetically, unnamed by asset count)
  ///
  /// * [String] name:
  ///   Search by person name
  ///
  /// * [bool] named:
  ///
  /// * [int] offset:
  ///   Number of people to skip
  ///
  /// * [DateTime] takenAfter:
  ///
  /// * [DateTime] takenBefore:
  ///
  /// * [bool] withHidden:
  Future<PeopleFaceStatisticsResponseDto?> getSpacePeopleFaceStatistics(String id, { int? limit, String? name, bool? named, int? offset, DateTime? takenAfter, DateTime? takenBefore, bool? withHidden, Future<void>? abortTrigger, }) async {
    final response = await getSpacePeopleFaceStatisticsWithHttpInfo(id, limit: limit, name: name, named: named, offset: offset, takenAfter: takenAfter, takenBefore: takenBefore, withHidden: withHidden, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PeopleFaceStatisticsResponseDto',) as PeopleFaceStatisticsResponseDto;
    
    }
    return null;
  }

  /// Get people statistics in a shared space
  ///
  /// Retrieve people counts for a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] limit:
  ///   Maximum number of people to return (named sorted alphabetically, unnamed by asset count)
  ///
  /// * [String] name:
  ///   Search by person name
  ///
  /// * [bool] named:
  ///
  /// * [int] offset:
  ///   Number of people to skip
  ///
  /// * [DateTime] takenAfter:
  ///
  /// * [DateTime] takenBefore:
  ///
  /// * [bool] withHidden:
  Future<Response> getSpacePeopleStatisticsWithHttpInfo(String id, { int? limit, String? name, bool? named, int? offset, DateTime? takenAfter, DateTime? takenBefore, bool? withHidden, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/statistics'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (name != null) {
      queryParams.addAll(_queryParams('', 'name', name));
    }
    if (named != null) {
      queryParams.addAll(_queryParams('', 'named', named));
    }
    if (offset != null) {
      queryParams.addAll(_queryParams('', 'offset', offset));
    }
    if (takenAfter != null) {
      queryParams.addAll(_queryParams('', 'takenAfter', takenAfter));
    }
    if (takenBefore != null) {
      queryParams.addAll(_queryParams('', 'takenBefore', takenBefore));
    }
    if (withHidden != null) {
      queryParams.addAll(_queryParams('', 'withHidden', withHidden));
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

  /// Get people statistics in a shared space
  ///
  /// Retrieve people counts for a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] limit:
  ///   Maximum number of people to return (named sorted alphabetically, unnamed by asset count)
  ///
  /// * [String] name:
  ///   Search by person name
  ///
  /// * [bool] named:
  ///
  /// * [int] offset:
  ///   Number of people to skip
  ///
  /// * [DateTime] takenAfter:
  ///
  /// * [DateTime] takenBefore:
  ///
  /// * [bool] withHidden:
  Future<SharedSpacePeopleStatisticsResponseDto?> getSpacePeopleStatistics(String id, { int? limit, String? name, bool? named, int? offset, DateTime? takenAfter, DateTime? takenBefore, bool? withHidden, Future<void>? abortTrigger, }) async {
    final response = await getSpacePeopleStatisticsWithHttpInfo(id, limit: limit, name: name, named: named, offset: offset, takenAfter: takenAfter, takenBefore: takenBefore, withHidden: withHidden, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpacePeopleStatisticsResponseDto',) as SharedSpacePeopleStatisticsResponseDto;
    
    }
    return null;
  }

  /// Get a person in a shared space
  ///
  /// Retrieve details of a specific person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<Response> getSpacePersonWithHttpInfo(String id, String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get a person in a shared space
  ///
  /// Retrieve details of a specific person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<SharedSpacePersonResponseDto?> getSpacePerson(String id, String personId, { Future<void>? abortTrigger, }) async {
    final response = await getSpacePersonWithHttpInfo(id, personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpacePersonResponseDto',) as SharedSpacePersonResponseDto;
    
    }
    return null;
  }

  /// Get assets for a person in a shared space
  ///
  /// Retrieve asset IDs for all assets containing a specific person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<Response> getSpacePersonAssetsWithHttpInfo(String id, String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/assets'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get assets for a person in a shared space
  ///
  /// Retrieve asset IDs for all assets containing a specific person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<List<String>?> getSpacePersonAssets(String id, String personId, { Future<void>? abortTrigger, }) async {
    final response = await getSpacePersonAssetsWithHttpInfo(id, personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<String>') as List)
        .cast<String>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get space person face thumbnail
  ///
  /// Retrieve an exact face-crop thumbnail for a person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] faceId (required):
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<Response> getSpacePersonFaceThumbnailWithHttpInfo(String faceId, String id, String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/faces/{faceId}/thumbnail'
      .replaceAll('{faceId}', faceId)
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get space person face thumbnail
  ///
  /// Retrieve an exact face-crop thumbnail for a person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] faceId (required):
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<MultipartFile?> getSpacePersonFaceThumbnail(String faceId, String id, String personId, { Future<void>? abortTrigger, }) async {
    final response = await getSpacePersonFaceThumbnailWithHttpInfo(faceId, id, personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MultipartFile',) as MultipartFile;
    
    }
    return null;
  }

  /// Get space person faces
  ///
  /// Retrieve detected face crops for a person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of faces per page
  Future<Response> getSpacePersonFacesWithHttpInfo(String id, String personId, { int? page, int? size, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/faces'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (page != null) {
      queryParams.addAll(_queryParams('', 'page', page));
    }
    if (size != null) {
      queryParams.addAll(_queryParams('', 'size', size));
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

  /// Get space person faces
  ///
  /// Retrieve detected face crops for a person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of faces per page
  Future<PersonFacePageResponseDto?> getSpacePersonFaces(String id, String personId, { int? page, int? size, Future<void>? abortTrigger, }) async {
    final response = await getSpacePersonFacesWithHttpInfo(id, personId, page: page, size: size, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PersonFacePageResponseDto',) as PersonFacePageResponseDto;
    
    }
    return null;
  }

  /// Get space person statistics
  ///
  /// Retrieve asset and face statistics for a person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<Response> getSpacePersonStatisticsWithHttpInfo(String id, String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/statistics'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get space person statistics
  ///
  /// Retrieve asset and face statistics for a person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<PersonStatisticsResponseDto?> getSpacePersonStatistics(String id, String personId, { Future<void>? abortTrigger, }) async {
    final response = await getSpacePersonStatisticsWithHttpInfo(id, personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PersonStatisticsResponseDto',) as PersonStatisticsResponseDto;
    
    }
    return null;
  }

  /// Get a space person thumbnail
  ///
  /// Retrieve the thumbnail image for a person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<Response> getSpacePersonThumbnailWithHttpInfo(String id, String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/thumbnail'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get a space person thumbnail
  ///
  /// Retrieve the thumbnail image for a person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  Future<MultipartFile?> getSpacePersonThumbnail(String id, String personId, { Future<void>? abortTrigger, }) async {
    final response = await getSpacePersonThumbnailWithHttpInfo(id, personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MultipartFile',) as MultipartFile;
    
    }
    return null;
  }

  /// Link an album to a shared space
  ///
  /// Link an album so its photos appear in the space. Requires space editor/owner and album owner/editor.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] albumId (required):
  ///
  /// * [String] id (required):
  Future<Response> linkAlbumWithHttpInfo(String albumId, String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/albums/{albumId}'
      .replaceAll('{albumId}', albumId)
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Link an album to a shared space
  ///
  /// Link an album so its photos appear in the space. Requires space editor/owner and album owner/editor.
  ///
  /// Parameters:
  ///
  /// * [String] albumId (required):
  ///
  /// * [String] id (required):
  Future<void> linkAlbum(String albumId, String id, { Future<void>? abortTrigger, }) async {
    final response = await linkAlbumWithHttpInfo(albumId, id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Link a library to a shared space
  ///
  /// Link an external library so its assets appear in the space. Requires admin and space editor/owner.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceLibraryLinkDto] sharedSpaceLibraryLinkDto (required):
  Future<Response> linkLibraryWithHttpInfo(String id, SharedSpaceLibraryLinkDto sharedSpaceLibraryLinkDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/libraries'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceLibraryLinkDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Link a library to a shared space
  ///
  /// Link an external library so its assets appear in the space. Requires admin and space editor/owner.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceLibraryLinkDto] sharedSpaceLibraryLinkDto (required):
  Future<void> linkLibrary(String id, SharedSpaceLibraryLinkDto sharedSpaceLibraryLinkDto, { Future<void>? abortTrigger, }) async {
    final response = await linkLibraryWithHttpInfo(id, sharedSpaceLibraryLinkDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Mark space as viewed
  ///
  /// Update the last viewed timestamp for the current user in this space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> markSpaceViewedWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/view'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Mark space as viewed
  ///
  /// Update the last viewed timestamp for the current user in this space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> markSpaceViewed(String id, { Future<void>? abortTrigger, }) async {
    final response = await markSpaceViewedWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Merge people in a shared space
  ///
  /// Merge one or more people into the target person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [SharedSpacePersonMergeDto] sharedSpacePersonMergeDto (required):
  Future<Response> mergeSpacePeopleWithHttpInfo(String id, String personId, SharedSpacePersonMergeDto sharedSpacePersonMergeDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/merge'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpacePersonMergeDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Merge people in a shared space
  ///
  /// Merge one or more people into the target person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [SharedSpacePersonMergeDto] sharedSpacePersonMergeDto (required):
  Future<void> mergeSpacePeople(String id, String personId, SharedSpacePersonMergeDto sharedSpacePersonMergeDto, { Future<void>? abortTrigger, }) async {
    final response = await mergeSpacePeopleWithHttpInfo(id, personId, sharedSpacePersonMergeDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Remove assets from a shared space
  ///
  /// Remove one or more assets from a shared space. Returns the ids that were actually removed (a selected asset that is only present via a linked album, not a direct member, is a no-op and is not returned).
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceAssetRemoveDto] sharedSpaceAssetRemoveDto (required):
  Future<Response> removeAssetsWithHttpInfo(String id, SharedSpaceAssetRemoveDto sharedSpaceAssetRemoveDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/assets'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceAssetRemoveDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Remove assets from a shared space
  ///
  /// Remove one or more assets from a shared space. Returns the ids that were actually removed (a selected asset that is only present via a linked album, not a direct member, is a no-op and is not returned).
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceAssetRemoveDto] sharedSpaceAssetRemoveDto (required):
  Future<List<String>?> removeAssets(String id, SharedSpaceAssetRemoveDto sharedSpaceAssetRemoveDto, { Future<void>? abortTrigger, }) async {
    final response = await removeAssetsWithHttpInfo(id, sharedSpaceAssetRemoveDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<String>') as List)
        .cast<String>()
        .toList(growable: false);

    }
    return null;
  }

  /// Remove a member from a shared space
  ///
  /// Remove a member from a shared space, or leave the space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] userId (required):
  Future<Response> removeMemberWithHttpInfo(String id, String userId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/members/{userId}'
      .replaceAll('{id}', id)
      .replaceAll('{userId}', userId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Remove a member from a shared space
  ///
  /// Remove a member from a shared space, or leave the space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] userId (required):
  Future<void> removeMember(String id, String userId, { Future<void>? abortTrigger, }) async {
    final response = await removeMemberWithHttpInfo(id, userId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Delete a shared space
  ///
  /// Permanently delete a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> removeSpaceWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Delete a shared space
  ///
  /// Permanently delete a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> removeSpace(String id, { Future<void>? abortTrigger, }) async {
    final response = await removeSpaceWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Set a person alias in a shared space
  ///
  /// Set a user-specific alias for a person in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [SharedSpacePersonAliasDto] sharedSpacePersonAliasDto (required):
  Future<Response> setSpacePersonAliasWithHttpInfo(String id, String personId, SharedSpacePersonAliasDto sharedSpacePersonAliasDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/alias'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpacePersonAliasDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Set a person alias in a shared space
  ///
  /// Set a user-specific alias for a person in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [SharedSpacePersonAliasDto] sharedSpacePersonAliasDto (required):
  Future<void> setSpacePersonAlias(String id, String personId, SharedSpacePersonAliasDto sharedSpacePersonAliasDto, { Future<void>? abortTrigger, }) async {
    final response = await setSpacePersonAliasWithHttpInfo(id, personId, sharedSpacePersonAliasDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Unlink an album from a shared space
  ///
  /// Remove an album link. Album assets will no longer appear in the space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] albumId (required):
  ///
  /// * [String] id (required):
  Future<Response> unlinkAlbumWithHttpInfo(String albumId, String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/albums/{albumId}'
      .replaceAll('{albumId}', albumId)
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Unlink an album from a shared space
  ///
  /// Remove an album link. Album assets will no longer appear in the space.
  ///
  /// Parameters:
  ///
  /// * [String] albumId (required):
  ///
  /// * [String] id (required):
  Future<void> unlinkAlbum(String albumId, String id, { Future<void>? abortTrigger, }) async {
    final response = await unlinkAlbumWithHttpInfo(albumId, id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Unlink a library from a shared space
  ///
  /// Remove a library link. Library assets will no longer appear in the space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] libraryId (required):
  Future<Response> unlinkLibraryWithHttpInfo(String id, String libraryId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/libraries/{libraryId}'
      .replaceAll('{id}', id)
      .replaceAll('{libraryId}', libraryId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Unlink a library from a shared space
  ///
  /// Remove a library link. Library assets will no longer appear in the space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] libraryId (required):
  Future<void> unlinkLibrary(String id, String libraryId, { Future<void>? abortTrigger, }) async {
    final response = await unlinkLibraryWithHttpInfo(id, libraryId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update a member in a shared space
  ///
  /// Update a member's role in a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] userId (required):
  ///
  /// * [SharedSpaceMemberUpdateDto] sharedSpaceMemberUpdateDto (required):
  Future<Response> updateMemberWithHttpInfo(String id, String userId, SharedSpaceMemberUpdateDto sharedSpaceMemberUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/members/{userId}'
      .replaceAll('{id}', id)
      .replaceAll('{userId}', userId);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceMemberUpdateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Update a member in a shared space
  ///
  /// Update a member's role in a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] userId (required):
  ///
  /// * [SharedSpaceMemberUpdateDto] sharedSpaceMemberUpdateDto (required):
  Future<SharedSpaceMemberResponseDto?> updateMember(String id, String userId, SharedSpaceMemberUpdateDto sharedSpaceMemberUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateMemberWithHttpInfo(id, userId, sharedSpaceMemberUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpaceMemberResponseDto',) as SharedSpaceMemberResponseDto;
    
    }
    return null;
  }

  /// Disable member person metadata contribution
  ///
  /// Disable person metadata contribution for another member. Members must re-enable it themselves.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] userId (required):
  ///
  /// * [SharedSpaceMemberMetadataContributionDto] sharedSpaceMemberMetadataContributionDto (required):
  Future<Response> updateMemberMetadataContributionWithHttpInfo(String id, String userId, SharedSpaceMemberMetadataContributionDto sharedSpaceMemberMetadataContributionDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/members/{userId}/metadata-contribution'
      .replaceAll('{id}', id)
      .replaceAll('{userId}', userId);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceMemberMetadataContributionDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Disable member person metadata contribution
  ///
  /// Disable person metadata contribution for another member. Members must re-enable it themselves.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] userId (required):
  ///
  /// * [SharedSpaceMemberMetadataContributionDto] sharedSpaceMemberMetadataContributionDto (required):
  Future<SharedSpaceMemberResponseDto?> updateMemberMetadataContribution(String id, String userId, SharedSpaceMemberMetadataContributionDto sharedSpaceMemberMetadataContributionDto, { Future<void>? abortTrigger, }) async {
    final response = await updateMemberMetadataContributionWithHttpInfo(id, userId, sharedSpaceMemberMetadataContributionDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpaceMemberResponseDto',) as SharedSpaceMemberResponseDto;
    
    }
    return null;
  }

  /// Update current member preferences
  ///
  /// Update timeline visibility and person metadata contribution for the current member.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceMemberPreferencesDto] sharedSpaceMemberPreferencesDto (required):
  Future<Response> updateMemberPreferencesWithHttpInfo(String id, SharedSpaceMemberPreferencesDto sharedSpaceMemberPreferencesDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/members/me/preferences'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceMemberPreferencesDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Update current member preferences
  ///
  /// Update timeline visibility and person metadata contribution for the current member.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceMemberPreferencesDto] sharedSpaceMemberPreferencesDto (required):
  Future<SharedSpaceMemberResponseDto?> updateMemberPreferences(String id, SharedSpaceMemberPreferencesDto sharedSpaceMemberPreferencesDto, { Future<void>? abortTrigger, }) async {
    final response = await updateMemberPreferencesWithHttpInfo(id, sharedSpaceMemberPreferencesDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpaceMemberResponseDto',) as SharedSpaceMemberResponseDto;
    
    }
    return null;
  }

  /// Update timeline visibility for current member
  ///
  /// Toggle whether this space's assets appear in the current user's personal timeline.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceMemberTimelineDto] sharedSpaceMemberTimelineDto (required):
  Future<Response> updateMemberTimelineWithHttpInfo(String id, SharedSpaceMemberTimelineDto sharedSpaceMemberTimelineDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/members/me/timeline'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceMemberTimelineDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Update timeline visibility for current member
  ///
  /// Toggle whether this space's assets appear in the current user's personal timeline.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceMemberTimelineDto] sharedSpaceMemberTimelineDto (required):
  Future<SharedSpaceMemberResponseDto?> updateMemberTimeline(String id, SharedSpaceMemberTimelineDto sharedSpaceMemberTimelineDto, { Future<void>? abortTrigger, }) async {
    final response = await updateMemberTimelineWithHttpInfo(id, sharedSpaceMemberTimelineDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpaceMemberResponseDto',) as SharedSpaceMemberResponseDto;
    
    }
    return null;
  }

  /// Update a space-album link (showInTimeline)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] albumId (required):
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceAlbumLinkUpdateDto] sharedSpaceAlbumLinkUpdateDto (required):
  Future<Response> updateSharedSpaceAlbumWithHttpInfo(String albumId, String id, SharedSpaceAlbumLinkUpdateDto sharedSpaceAlbumLinkUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/albums/{albumId}'
      .replaceAll('{albumId}', albumId)
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceAlbumLinkUpdateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Update a space-album link (showInTimeline)
  ///
  /// Parameters:
  ///
  /// * [String] albumId (required):
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceAlbumLinkUpdateDto] sharedSpaceAlbumLinkUpdateDto (required):
  Future<void> updateSharedSpaceAlbum(String albumId, String id, SharedSpaceAlbumLinkUpdateDto sharedSpaceAlbumLinkUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateSharedSpaceAlbumWithHttpInfo(albumId, id, sharedSpaceAlbumLinkUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update a shared space
  ///
  /// Update the name or description of a shared space.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceUpdateDto] sharedSpaceUpdateDto (required):
  Future<Response> updateSpaceWithHttpInfo(String id, SharedSpaceUpdateDto sharedSpaceUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpaceUpdateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Update a shared space
  ///
  /// Update the name or description of a shared space.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [SharedSpaceUpdateDto] sharedSpaceUpdateDto (required):
  Future<SharedSpaceResponseDto?> updateSpace(String id, SharedSpaceUpdateDto sharedSpaceUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateSpaceWithHttpInfo(id, sharedSpaceUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpaceResponseDto',) as SharedSpaceResponseDto;
    
    }
    return null;
  }

  /// Update a person in a shared space
  ///
  /// Update the name, visibility, birth date, or representative face of a person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [SharedSpacePersonUpdateDto] sharedSpacePersonUpdateDto (required):
  Future<Response> updateSpacePersonWithHttpInfo(String id, String personId, SharedSpacePersonUpdateDto sharedSpacePersonUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody = sharedSpacePersonUpdateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Update a person in a shared space
  ///
  /// Update the name, visibility, birth date, or representative face of a person.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [SharedSpacePersonUpdateDto] sharedSpacePersonUpdateDto (required):
  Future<SharedSpacePersonResponseDto?> updateSpacePerson(String id, String personId, SharedSpacePersonUpdateDto sharedSpacePersonUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateSpacePersonWithHttpInfo(id, personId, sharedSpacePersonUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpacePersonResponseDto',) as SharedSpacePersonResponseDto;
    
    }
    return null;
  }

  /// Update space person representative face
  ///
  /// Update or clear the exact face crop used as the space person thumbnail.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [SpaceRepresentativeFaceUpdateDto] spaceRepresentativeFaceUpdateDto (required):
  Future<Response> updateSpacePersonRepresentativeFaceWithHttpInfo(String id, String personId, SpaceRepresentativeFaceUpdateDto spaceRepresentativeFaceUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{id}/people/{personId}/representative-face'
      .replaceAll('{id}', id)
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody = spaceRepresentativeFaceUpdateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Update space person representative face
  ///
  /// Update or clear the exact face crop used as the space person thumbnail.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] personId (required):
  ///
  /// * [SpaceRepresentativeFaceUpdateDto] spaceRepresentativeFaceUpdateDto (required):
  Future<SharedSpacePersonResponseDto?> updateSpacePersonRepresentativeFace(String id, String personId, SpaceRepresentativeFaceUpdateDto spaceRepresentativeFaceUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateSpacePersonRepresentativeFaceWithHttpInfo(id, personId, spaceRepresentativeFaceUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SharedSpacePersonResponseDto',) as SharedSpacePersonResponseDto;
    
    }
    return null;
  }
}

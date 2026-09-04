//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class PeopleApi {
  PeopleApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Confirm a face suggestion
  ///
  /// Assign the suggested face to the person. Idempotent — the response reports whether it acted.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  ///   Unassigned asset face ID being reviewed
  ///
  /// * [String] id (required):
  ///   Person ID
  Future<Response> confirmPersonFaceSuggestionWithHttpInfo(String assetFaceId, String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/face-suggestions/{assetFaceId}/confirm'
      .replaceAll('{assetFaceId}', assetFaceId)
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

  /// Confirm a face suggestion
  ///
  /// Assign the suggested face to the person. Idempotent — the response reports whether it acted.
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  ///   Unassigned asset face ID being reviewed
  ///
  /// * [String] id (required):
  ///   Person ID
  Future<FaceSuggestionActionResponseDto?> confirmPersonFaceSuggestion(String assetFaceId, String id, { Future<void>? abortTrigger, }) async {
    final response = await confirmPersonFaceSuggestionWithHttpInfo(assetFaceId, id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceSuggestionActionResponseDto',) as FaceSuggestionActionResponseDto;
    
    }
    return null;
  }

  /// Create a person
  ///
  /// Create a new person that can have multiple faces assigned to them.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [PersonCreateDto] personCreateDto (required):
  Future<Response> createPersonWithHttpInfo(PersonCreateDto personCreateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people';

    // ignore: prefer_final_locals
    Object? postBody = personCreateDto;

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

  /// Create a person
  ///
  /// Create a new person that can have multiple faces assigned to them.
  ///
  /// Parameters:
  ///
  /// * [PersonCreateDto] personCreateDto (required):
  Future<PersonResponseDto?> createPerson(PersonCreateDto personCreateDto, { Future<void>? abortTrigger, }) async {
    final response = await createPersonWithHttpInfo(personCreateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PersonResponseDto',) as PersonResponseDto;
    
    }
    return null;
  }

  /// Delete people
  ///
  /// Bulk delete a list of people at once.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [BulkIdsDto] bulkIdsDto (required):
  Future<Response> deletePeopleWithHttpInfo(BulkIdsDto bulkIdsDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people';

    // ignore: prefer_final_locals
    Object? postBody = bulkIdsDto;

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

  /// Delete people
  ///
  /// Bulk delete a list of people at once.
  ///
  /// Parameters:
  ///
  /// * [BulkIdsDto] bulkIdsDto (required):
  Future<void> deletePeople(BulkIdsDto bulkIdsDto, { Future<void>? abortTrigger, }) async {
    final response = await deletePeopleWithHttpInfo(bulkIdsDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Delete person
  ///
  /// Delete an individual person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> deletePersonWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}'
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

  /// Delete person
  ///
  /// Delete an individual person.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> deletePerson(String id, { Future<void>? abortTrigger, }) async {
    final response = await deletePersonWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Detach a scoped person profile
  ///
  /// Separate one personal or space person profile from a grouped person identity.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [DetachScopedPersonDto] detachScopedPersonDto (required):
  Future<Response> detachScopedPersonWithHttpInfo(DetachScopedPersonDto detachScopedPersonDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/detach-profile';

    // ignore: prefer_final_locals
    Object? postBody = detachScopedPersonDto;

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

  /// Detach a scoped person profile
  ///
  /// Separate one personal or space person profile from a grouped person identity.
  ///
  /// Parameters:
  ///
  /// * [DetachScopedPersonDto] detachScopedPersonDto (required):
  Future<void> detachScopedPerson(DetachScopedPersonDto detachScopedPersonDto, { Future<void>? abortTrigger, }) async {
    final response = await detachScopedPersonWithHttpInfo(detachScopedPersonDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Dismiss a face suggestion
  ///
  /// Compatibility alias for rejecting this suggestion. The face stays unassigned. Idempotent — the response reports whether it acted.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  ///   Unassigned asset face ID being reviewed
  ///
  /// * [String] id (required):
  ///   Person ID
  Future<Response> dismissPersonFaceSuggestionWithHttpInfo(String assetFaceId, String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/face-suggestions/{assetFaceId}/dismiss'
      .replaceAll('{assetFaceId}', assetFaceId)
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

  /// Dismiss a face suggestion
  ///
  /// Compatibility alias for rejecting this suggestion. The face stays unassigned. Idempotent — the response reports whether it acted.
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  ///   Unassigned asset face ID being reviewed
  ///
  /// * [String] id (required):
  ///   Person ID
  Future<FaceSuggestionActionResponseDto?> dismissPersonFaceSuggestion(String assetFaceId, String id, { Future<void>? abortTrigger, }) async {
    final response = await dismissPersonFaceSuggestionWithHttpInfo(assetFaceId, id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceSuggestionActionResponseDto',) as FaceSuggestionActionResponseDto;
    
    }
    return null;
  }

  /// Get all people
  ///
  /// Retrieve a list of all people.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] closestAssetId:
  ///   Closest asset ID for similarity search
  ///
  /// * [String] closestPersonId:
  ///   Closest person ID for similarity search
  ///
  /// * [int] page:
  ///   Page number for pagination
  ///
  /// * [int] size:
  ///   Number of items per page
  ///
  /// * [String] type:
  ///   Filter the list to human people or to pets. Omit for both.
  ///
  /// * [bool] withHidden:
  ///   Include hidden people
  ///
  /// * [bool] withSharedSpaces:
  ///   Include identity-grouped people from timeline-enabled shared spaces
  Future<Response> getAllPeopleWithHttpInfo({ String? closestAssetId, String? closestPersonId, int? page, int? size, String? type, bool? withHidden, bool? withSharedSpaces, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (closestAssetId != null) {
      queryParams.addAll(_queryParams('', 'closestAssetId', closestAssetId));
    }
    if (closestPersonId != null) {
      queryParams.addAll(_queryParams('', 'closestPersonId', closestPersonId));
    }
    if (page != null) {
      queryParams.addAll(_queryParams('', 'page', page));
    }
    if (size != null) {
      queryParams.addAll(_queryParams('', 'size', size));
    }
    if (type != null) {
      queryParams.addAll(_queryParams('', 'type', type));
    }
    if (withHidden != null) {
      queryParams.addAll(_queryParams('', 'withHidden', withHidden));
    }
    if (withSharedSpaces != null) {
      queryParams.addAll(_queryParams('', 'withSharedSpaces', withSharedSpaces));
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

  /// Get all people
  ///
  /// Retrieve a list of all people.
  ///
  /// Parameters:
  ///
  /// * [String] closestAssetId:
  ///   Closest asset ID for similarity search
  ///
  /// * [String] closestPersonId:
  ///   Closest person ID for similarity search
  ///
  /// * [int] page:
  ///   Page number for pagination
  ///
  /// * [int] size:
  ///   Number of items per page
  ///
  /// * [String] type:
  ///   Filter the list to human people or to pets. Omit for both.
  ///
  /// * [bool] withHidden:
  ///   Include hidden people
  ///
  /// * [bool] withSharedSpaces:
  ///   Include identity-grouped people from timeline-enabled shared spaces
  Future<PeopleResponseDto?> getAllPeople({ String? closestAssetId, String? closestPersonId, int? page, int? size, String? type, bool? withHidden, bool? withSharedSpaces, Future<void>? abortTrigger, }) async {
    final response = await getAllPeopleWithHttpInfo(closestAssetId: closestAssetId, closestPersonId: closestPersonId, page: page, size: size, type: type, withHidden: withHidden, withSharedSpaces: withSharedSpaces, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PeopleResponseDto',) as PeopleResponseDto;
    
    }
    return null;
  }

  /// Get people face statistics
  ///
  /// Retrieve detailed detected-face counts for the authenticated user people scope.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] closestAssetId:
  ///   Closest asset ID for similarity search
  ///
  /// * [String] closestPersonId:
  ///   Closest person ID for similarity search
  ///
  /// * [int] page:
  ///   Page number for pagination
  ///
  /// * [int] size:
  ///   Number of items per page
  ///
  /// * [String] type:
  ///   Filter the list to human people or to pets. Omit for both.
  ///
  /// * [bool] withHidden:
  ///   Include hidden people
  ///
  /// * [bool] withSharedSpaces:
  ///   Include identity-grouped people from timeline-enabled shared spaces
  Future<Response> getPeopleFaceStatisticsWithHttpInfo({ String? closestAssetId, String? closestPersonId, int? page, int? size, String? type, bool? withHidden, bool? withSharedSpaces, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/face-statistics';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (closestAssetId != null) {
      queryParams.addAll(_queryParams('', 'closestAssetId', closestAssetId));
    }
    if (closestPersonId != null) {
      queryParams.addAll(_queryParams('', 'closestPersonId', closestPersonId));
    }
    if (page != null) {
      queryParams.addAll(_queryParams('', 'page', page));
    }
    if (size != null) {
      queryParams.addAll(_queryParams('', 'size', size));
    }
    if (type != null) {
      queryParams.addAll(_queryParams('', 'type', type));
    }
    if (withHidden != null) {
      queryParams.addAll(_queryParams('', 'withHidden', withHidden));
    }
    if (withSharedSpaces != null) {
      queryParams.addAll(_queryParams('', 'withSharedSpaces', withSharedSpaces));
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

  /// Get people face statistics
  ///
  /// Retrieve detailed detected-face counts for the authenticated user people scope.
  ///
  /// Parameters:
  ///
  /// * [String] closestAssetId:
  ///   Closest asset ID for similarity search
  ///
  /// * [String] closestPersonId:
  ///   Closest person ID for similarity search
  ///
  /// * [int] page:
  ///   Page number for pagination
  ///
  /// * [int] size:
  ///   Number of items per page
  ///
  /// * [String] type:
  ///   Filter the list to human people or to pets. Omit for both.
  ///
  /// * [bool] withHidden:
  ///   Include hidden people
  ///
  /// * [bool] withSharedSpaces:
  ///   Include identity-grouped people from timeline-enabled shared spaces
  Future<PeopleFaceStatisticsResponseDto?> getPeopleFaceStatistics({ String? closestAssetId, String? closestPersonId, int? page, int? size, String? type, bool? withHidden, bool? withSharedSpaces, Future<void>? abortTrigger, }) async {
    final response = await getPeopleFaceStatisticsWithHttpInfo(closestAssetId: closestAssetId, closestPersonId: closestPersonId, page: page, size: size, type: type, withHidden: withHidden, withSharedSpaces: withSharedSpaces, abortTrigger: abortTrigger,);
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

  /// Get people statistics
  ///
  /// Retrieve people and detected-face counts for the authenticated user people scope.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] closestAssetId:
  ///   Closest asset ID for similarity search
  ///
  /// * [String] closestPersonId:
  ///   Closest person ID for similarity search
  ///
  /// * [int] page:
  ///   Page number for pagination
  ///
  /// * [int] size:
  ///   Number of items per page
  ///
  /// * [String] type:
  ///   Filter the list to human people or to pets. Omit for both.
  ///
  /// * [bool] withHidden:
  ///   Include hidden people
  ///
  /// * [bool] withSharedSpaces:
  ///   Include identity-grouped people from timeline-enabled shared spaces
  Future<Response> getPeopleStatisticsWithHttpInfo({ String? closestAssetId, String? closestPersonId, int? page, int? size, String? type, bool? withHidden, bool? withSharedSpaces, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/statistics';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (closestAssetId != null) {
      queryParams.addAll(_queryParams('', 'closestAssetId', closestAssetId));
    }
    if (closestPersonId != null) {
      queryParams.addAll(_queryParams('', 'closestPersonId', closestPersonId));
    }
    if (page != null) {
      queryParams.addAll(_queryParams('', 'page', page));
    }
    if (size != null) {
      queryParams.addAll(_queryParams('', 'size', size));
    }
    if (type != null) {
      queryParams.addAll(_queryParams('', 'type', type));
    }
    if (withHidden != null) {
      queryParams.addAll(_queryParams('', 'withHidden', withHidden));
    }
    if (withSharedSpaces != null) {
      queryParams.addAll(_queryParams('', 'withSharedSpaces', withSharedSpaces));
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

  /// Get people statistics
  ///
  /// Retrieve people and detected-face counts for the authenticated user people scope.
  ///
  /// Parameters:
  ///
  /// * [String] closestAssetId:
  ///   Closest asset ID for similarity search
  ///
  /// * [String] closestPersonId:
  ///   Closest person ID for similarity search
  ///
  /// * [int] page:
  ///   Page number for pagination
  ///
  /// * [int] size:
  ///   Number of items per page
  ///
  /// * [String] type:
  ///   Filter the list to human people or to pets. Omit for both.
  ///
  /// * [bool] withHidden:
  ///   Include hidden people
  ///
  /// * [bool] withSharedSpaces:
  ///   Include identity-grouped people from timeline-enabled shared spaces
  Future<PeopleStatisticsResponseDto?> getPeopleStatistics({ String? closestAssetId, String? closestPersonId, int? page, int? size, String? type, bool? withHidden, bool? withSharedSpaces, Future<void>? abortTrigger, }) async {
    final response = await getPeopleStatisticsWithHttpInfo(closestAssetId: closestAssetId, closestPersonId: closestPersonId, page: page, size: size, type: type, withHidden: withHidden, withSharedSpaces: withSharedSpaces, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PeopleStatisticsResponseDto',) as PeopleStatisticsResponseDto;
    
    }
    return null;
  }

  /// Get a person
  ///
  /// Retrieve a person by id.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getPersonWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}'
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

  /// Get a person
  ///
  /// Retrieve a person by id.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<PersonResponseDto?> getPerson(String id, { Future<void>? abortTrigger, }) async {
    final response = await getPersonWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PersonResponseDto',) as PersonResponseDto;
    
    }
    return null;
  }

  /// Get face suggestions for a person
  ///
  /// Retrieve near-miss unassigned faces suggested for this person, best match first.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of suggestions per page
  Future<Response> getPersonFaceSuggestionsWithHttpInfo(String id, { int? page, int? size, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/face-suggestions'
      .replaceAll('{id}', id);

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

  /// Get face suggestions for a person
  ///
  /// Retrieve near-miss unassigned faces suggested for this person, best match first.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of suggestions per page
  Future<PersonFaceSuggestionPageResponseDto?> getPersonFaceSuggestions(String id, { int? page, int? size, Future<void>? abortTrigger, }) async {
    final response = await getPersonFaceSuggestionsWithHttpInfo(id, page: page, size: size, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PersonFaceSuggestionPageResponseDto',) as PersonFaceSuggestionPageResponseDto;
    
    }
    return null;
  }

  /// Get person face thumbnail
  ///
  /// Retrieve an exact face-crop thumbnail for a person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] faceId (required):
  ///
  /// * [String] id (required):
  Future<Response> getPersonFaceThumbnailWithHttpInfo(String faceId, String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/faces/{faceId}/thumbnail'
      .replaceAll('{faceId}', faceId)
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

  /// Get person face thumbnail
  ///
  /// Retrieve an exact face-crop thumbnail for a person.
  ///
  /// Parameters:
  ///
  /// * [String] faceId (required):
  ///
  /// * [String] id (required):
  Future<MultipartFile?> getPersonFaceThumbnail(String faceId, String id, { Future<void>? abortTrigger, }) async {
    final response = await getPersonFaceThumbnailWithHttpInfo(faceId, id, abortTrigger: abortTrigger,);
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

  /// Get person faces
  ///
  /// Retrieve detected face crops for a person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of faces per page
  Future<Response> getPersonFacesWithHttpInfo(String id, { int? page, int? size, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/faces'
      .replaceAll('{id}', id);

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

  /// Get person faces
  ///
  /// Retrieve detected face crops for a person.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of faces per page
  Future<PersonFacePageResponseDto?> getPersonFaces(String id, { int? page, int? size, Future<void>? abortTrigger, }) async {
    final response = await getPersonFacesWithHttpInfo(id, page: page, size: size, abortTrigger: abortTrigger,);
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

  /// Get person statistics
  ///
  /// Retrieve statistics about a specific person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getPersonStatisticsWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/statistics'
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

  /// Get person statistics
  ///
  /// Retrieve statistics about a specific person.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<PersonStatisticsResponseDto?> getPersonStatistics(String id, { Future<void>? abortTrigger, }) async {
    final response = await getPersonStatisticsWithHttpInfo(id, abortTrigger: abortTrigger,);
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

  /// Get person thumbnail
  ///
  /// Retrieve the thumbnail file for a person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getPersonThumbnailWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/thumbnail'
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

  /// Get person thumbnail
  ///
  /// Retrieve the thumbnail file for a person.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<MultipartFile?> getPersonThumbnail(String id, { Future<void>? abortTrigger, }) async {
    final response = await getPersonThumbnailWithHttpInfo(id, abortTrigger: abortTrigger,);
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

  /// Ignore a face suggestion
  ///
  /// Ignore this suggestion for the person. The face stays unassigned. Idempotent — the response reports whether it acted.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  ///   Unassigned asset face ID being reviewed
  ///
  /// * [String] id (required):
  ///   Person ID
  Future<Response> ignorePersonFaceSuggestionWithHttpInfo(String assetFaceId, String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/face-suggestions/{assetFaceId}/ignore'
      .replaceAll('{assetFaceId}', assetFaceId)
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

  /// Ignore a face suggestion
  ///
  /// Ignore this suggestion for the person. The face stays unassigned. Idempotent — the response reports whether it acted.
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  ///   Unassigned asset face ID being reviewed
  ///
  /// * [String] id (required):
  ///   Person ID
  Future<FaceSuggestionActionResponseDto?> ignorePersonFaceSuggestion(String assetFaceId, String id, { Future<void>? abortTrigger, }) async {
    final response = await ignorePersonFaceSuggestionWithHttpInfo(assetFaceId, id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceSuggestionActionResponseDto',) as FaceSuggestionActionResponseDto;
    
    }
    return null;
  }

  /// Merge people
  ///
  /// Merge a list of people into the person specified in the path parameter.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [MergePersonDto] mergePersonDto (required):
  Future<Response> mergePersonWithHttpInfo(String id, MergePersonDto mergePersonDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/merge'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = mergePersonDto;

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

  /// Merge people
  ///
  /// Merge a list of people into the person specified in the path parameter.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [MergePersonDto] mergePersonDto (required):
  Future<List<BulkIdResponseDto>?> mergePerson(String id, MergePersonDto mergePersonDto, { Future<void>? abortTrigger, }) async {
    final response = await mergePersonWithHttpInfo(id, mergePersonDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<BulkIdResponseDto>') as List)
        .cast<BulkIdResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Merge scoped people by identity
  ///
  /// Mark personal and space people as the same person without exposing raw face identity IDs.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [MergeScopedPeopleDto] mergeScopedPeopleDto (required):
  Future<Response> mergeScopedPeopleWithHttpInfo(MergeScopedPeopleDto mergeScopedPeopleDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/same-person';

    // ignore: prefer_final_locals
    Object? postBody = mergeScopedPeopleDto;

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

  /// Merge scoped people by identity
  ///
  /// Mark personal and space people as the same person without exposing raw face identity IDs.
  ///
  /// Parameters:
  ///
  /// * [MergeScopedPeopleDto] mergeScopedPeopleDto (required):
  Future<void> mergeScopedPeople(MergeScopedPeopleDto mergeScopedPeopleDto, { Future<void>? abortTrigger, }) async {
    final response = await mergeScopedPeopleWithHttpInfo(mergeScopedPeopleDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Reassign faces
  ///
  /// Bulk reassign a list of faces to a different person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [AssetFaceUpdateDto] assetFaceUpdateDto (required):
  Future<Response> reassignFacesWithHttpInfo(String id, AssetFaceUpdateDto assetFaceUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/reassign'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = assetFaceUpdateDto;

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

  /// Reassign faces
  ///
  /// Bulk reassign a list of faces to a different person.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [AssetFaceUpdateDto] assetFaceUpdateDto (required):
  Future<List<PersonResponseDto>?> reassignFaces(String id, AssetFaceUpdateDto assetFaceUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await reassignFacesWithHttpInfo(id, assetFaceUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<PersonResponseDto>') as List)
        .cast<PersonResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Reject a face suggestion
  ///
  /// Reject this suggestion for the person. The face stays unassigned. Idempotent — the response reports whether it acted.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  ///   Unassigned asset face ID being reviewed
  ///
  /// * [String] id (required):
  ///   Person ID
  Future<Response> rejectPersonFaceSuggestionWithHttpInfo(String assetFaceId, String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/face-suggestions/{assetFaceId}/reject'
      .replaceAll('{assetFaceId}', assetFaceId)
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

  /// Reject a face suggestion
  ///
  /// Reject this suggestion for the person. The face stays unassigned. Idempotent — the response reports whether it acted.
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  ///   Unassigned asset face ID being reviewed
  ///
  /// * [String] id (required):
  ///   Person ID
  Future<FaceSuggestionActionResponseDto?> rejectPersonFaceSuggestion(String assetFaceId, String id, { Future<void>? abortTrigger, }) async {
    final response = await rejectPersonFaceSuggestionWithHttpInfo(assetFaceId, id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceSuggestionActionResponseDto',) as FaceSuggestionActionResponseDto;
    
    }
    return null;
  }

  /// Update people
  ///
  /// Bulk update multiple people at once.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [PeopleUpdateDto] peopleUpdateDto (required):
  Future<Response> updatePeopleWithHttpInfo(PeopleUpdateDto peopleUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people';

    // ignore: prefer_final_locals
    Object? postBody = peopleUpdateDto;

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

  /// Update people
  ///
  /// Bulk update multiple people at once.
  ///
  /// Parameters:
  ///
  /// * [PeopleUpdateDto] peopleUpdateDto (required):
  Future<List<BulkIdResponseDto>?> updatePeople(PeopleUpdateDto peopleUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updatePeopleWithHttpInfo(peopleUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<BulkIdResponseDto>') as List)
        .cast<BulkIdResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Update person
  ///
  /// Update an individual person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [PersonUpdateDto] personUpdateDto (required):
  Future<Response> updatePersonWithHttpInfo(String id, PersonUpdateDto personUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = personUpdateDto;

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

  /// Update person
  ///
  /// Update an individual person.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [PersonUpdateDto] personUpdateDto (required):
  Future<PersonResponseDto?> updatePerson(String id, PersonUpdateDto personUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updatePersonWithHttpInfo(id, personUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PersonResponseDto',) as PersonResponseDto;
    
    }
    return null;
  }

  /// Update representative face
  ///
  /// Update the exact face crop used as the person thumbnail.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [RepresentativeFaceUpdateDto] representativeFaceUpdateDto (required):
  Future<Response> updateRepresentativeFaceWithHttpInfo(String id, RepresentativeFaceUpdateDto representativeFaceUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/people/{id}/representative-face'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = representativeFaceUpdateDto;

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

  /// Update representative face
  ///
  /// Update the exact face crop used as the person thumbnail.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [RepresentativeFaceUpdateDto] representativeFaceUpdateDto (required):
  Future<PersonResponseDto?> updateRepresentativeFace(String id, RepresentativeFaceUpdateDto representativeFaceUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateRepresentativeFaceWithHttpInfo(id, representativeFaceUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'PersonResponseDto',) as PersonResponseDto;
    
    }
    return null;
  }
}

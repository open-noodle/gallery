//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class FamilyApi {
  FamilyApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Add a participant to a family union
  ///
  /// Add an identity to a family union as a partner or a child.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [FamilyParticipantAddDto] familyParticipantAddDto (required):
  Future<Response> addParticipantWithHttpInfo(String id, FamilyParticipantAddDto familyParticipantAddDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/unions/{id}/participants'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = familyParticipantAddDto;

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

  /// Add a participant to a family union
  ///
  /// Add an identity to a family union as a partner or a child.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [FamilyParticipantAddDto] familyParticipantAddDto (required):
  Future<void> addParticipant(String id, FamilyParticipantAddDto familyParticipantAddDto, { Future<void>? abortTrigger, }) async {
    final response = await addParticipantWithHttpInfo(id, familyParticipantAddDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Create a family union
  ///
  /// Create a new family union (a partnership and/or parent-child relationship).
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FamilyUnionCreateDto] familyUnionCreateDto (required):
  Future<Response> createUnionWithHttpInfo(FamilyUnionCreateDto familyUnionCreateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/unions';

    // ignore: prefer_final_locals
    Object? postBody = familyUnionCreateDto;

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

  /// Create a family union
  ///
  /// Create a new family union (a partnership and/or parent-child relationship).
  ///
  /// Parameters:
  ///
  /// * [FamilyUnionCreateDto] familyUnionCreateDto (required):
  Future<FamilyUnionCreateResponseDto?> createUnion(FamilyUnionCreateDto familyUnionCreateDto, { Future<void>? abortTrigger, }) async {
    final response = await createUnionWithHttpInfo(familyUnionCreateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FamilyUnionCreateResponseDto',) as FamilyUnionCreateResponseDto;
    
    }
    return null;
  }

  /// Remove a user's family access grant
  ///
  /// Remove a user's explicit family access grant, reverting them to the instance default.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] userId (required):
  Future<Response> deleteAccessWithHttpInfo(String userId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/access/{userId}'
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

  /// Remove a user's family access grant
  ///
  /// Remove a user's explicit family access grant, reverting them to the instance default.
  ///
  /// Parameters:
  ///
  /// * [String] userId (required):
  Future<void> deleteAccess(String userId, { Future<void>? abortTrigger, }) async {
    final response = await deleteAccessWithHttpInfo(userId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Delete a family union
  ///
  /// Permanently delete a family union.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> deleteUnionWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/unions/{id}'
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

  /// Delete a family union
  ///
  /// Permanently delete a family union.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> deleteUnion(String id, { Future<void>? abortTrigger, }) async {
    final response = await deleteUnionWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get all family access grants
  ///
  /// Retrieve every explicit family access grant on the instance, for admin management.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getAllAccessWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/access';

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

  /// Get all family access grants
  ///
  /// Retrieve every explicit family access grant on the instance, for admin management.
  Future<List<FamilyAccessGrantResponseDto>?> getAllAccess({ Future<void>? abortTrigger, }) async {
    final response = await getAllAccessWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<FamilyAccessGrantResponseDto>') as List)
        .cast<FamilyAccessGrantResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get family clusters
  ///
  /// Retrieve the disconnected components of the family graph the caller can see — how \"multiple family trees\" surfaces without a tree object.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getClustersWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/clusters';

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

  /// Get family clusters
  ///
  /// Retrieve the disconnected components of the family graph the caller can see — how \"multiple family trees\" surfaces without a tree object.
  Future<List<FamilyClusterResponseDto>?> getClusters({ Future<void>? abortTrigger, }) async {
    final response = await getClustersWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<FamilyClusterResponseDto>') as List)
        .cast<FamilyClusterResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get the person behind a family identity
  ///
  /// Retrieve the caller's own accessible person profile for an identity they can resolve, so a family client can show and edit that person.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getIdentityPersonWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/identities/{id}/person'
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

  /// Get the person behind a family identity
  ///
  /// Retrieve the caller's own accessible person profile for an identity they can resolve, so a family client can show and edit that person.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<PersonResponseDto?> getIdentityPerson(String id, { Future<void>? abortTrigger, }) async {
    final response = await getIdentityPersonWithHttpInfo(id, abortTrigger: abortTrigger,);
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

  /// Get a family identity's thumbnail
  ///
  /// Retrieve the face thumbnail for an identity the caller can resolve, for the family canvas.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getIdentityThumbnailWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/identities/{id}/thumbnail'
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

  /// Get a family identity's thumbnail
  ///
  /// Retrieve the face thumbnail for an identity the caller can resolve, for the family canvas.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<MultipartFile?> getIdentityThumbnail(String id, { Future<void>? abortTrigger, }) async {
    final response = await getIdentityThumbnailWithHttpInfo(id, abortTrigger: abortTrigger,);
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

  /// Get the viewer's family root and access level
  ///
  /// Retrieve the identity the caller previously nominated as themselves (or null if never set) and their own effective family access level, so a client can decide what to render in one call.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getMyRootWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/me';

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

  /// Get the viewer's family root and access level
  ///
  /// Retrieve the identity the caller previously nominated as themselves (or null if never set) and their own effective family access level, so a client can decide what to render in one call.
  Future<FamilyMyRootResponseDto?> getMyRoot({ Future<void>? abortTrigger, }) async {
    final response = await getMyRootWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FamilyMyRootResponseDto',) as FamilyMyRootResponseDto;
    
    }
    return null;
  }

  /// Get a person's own family relations
  ///
  /// Retrieve a person's direct relations (parents, partners, children, siblings, etc.), each labelled relative to that person rather than the caller.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] personId (required):
  Future<Response> getPersonRelationsWithHttpInfo(String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/people/{personId}/relations'
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

  /// Get a person's own family relations
  ///
  /// Retrieve a person's direct relations (parents, partners, children, siblings, etc.), each labelled relative to that person rather than the caller.
  ///
  /// Parameters:
  ///
  /// * [String] personId (required):
  Future<FamilyPersonRelationsResponseDto?> getPersonRelations(String personId, { Future<void>? abortTrigger, }) async {
    final response = await getPersonRelationsWithHttpInfo(personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FamilyPersonRelationsResponseDto',) as FamilyPersonRelationsResponseDto;
    
    }
    return null;
  }

  /// Get family unions
  ///
  /// Retrieve the family unions the caller can see, as a flat, paginated collection.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of unions per page
  Future<Response> getUnionsWithHttpInfo({ int? page, int? size, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/unions';

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

  /// Get family unions
  ///
  /// Retrieve the family unions the caller can see, as a flat, paginated collection.
  ///
  /// Parameters:
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of unions per page
  Future<FamilyGraphResponseDto?> getUnions({ int? page, int? size, Future<void>? abortTrigger, }) async {
    final response = await getUnionsWithHttpInfo(page: page, size: size, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FamilyGraphResponseDto',) as FamilyGraphResponseDto;
    
    }
    return null;
  }

  /// Remove a participant from a family union
  ///
  /// Remove an identity from a family union, whichever role it holds.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] identityId (required):
  Future<Response> removeParticipantWithHttpInfo(String id, String identityId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/unions/{id}/participants/{identityId}'
      .replaceAll('{id}', id)
      .replaceAll('{identityId}', identityId);

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

  /// Remove a participant from a family union
  ///
  /// Remove an identity from a family union, whichever role it holds.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [String] identityId (required):
  Future<void> removeParticipant(String id, String identityId, { Future<void>? abortTrigger, }) async {
    final response = await removeParticipantWithHttpInfo(id, identityId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Set a user's family access grant
  ///
  /// Grant a user an explicit family access level, overriding the instance default.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] userId (required):
  ///
  /// * [FamilyAccessUpdateDto] familyAccessUpdateDto (required):
  Future<Response> setAccessWithHttpInfo(String userId, FamilyAccessUpdateDto familyAccessUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/access/{userId}'
      .replaceAll('{userId}', userId);

    // ignore: prefer_final_locals
    Object? postBody = familyAccessUpdateDto;

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

  /// Set a user's family access grant
  ///
  /// Grant a user an explicit family access level, overriding the instance default.
  ///
  /// Parameters:
  ///
  /// * [String] userId (required):
  ///
  /// * [FamilyAccessUpdateDto] familyAccessUpdateDto (required):
  Future<FamilyAccessGrantResponseDto?> setAccess(String userId, FamilyAccessUpdateDto familyAccessUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await setAccessWithHttpInfo(userId, familyAccessUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FamilyAccessGrantResponseDto',) as FamilyAccessGrantResponseDto;
    
    }
    return null;
  }

  /// Set the viewer's family root
  ///
  /// Nominate the identity that represents the caller, used to derive relative labels (\"your sister\"). Pass a null identityId to clear it.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FamilyMyRootUpdateDto] familyMyRootUpdateDto (required):
  Future<Response> setMyRootWithHttpInfo(FamilyMyRootUpdateDto familyMyRootUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/me';

    // ignore: prefer_final_locals
    Object? postBody = familyMyRootUpdateDto;

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

  /// Set the viewer's family root
  ///
  /// Nominate the identity that represents the caller, used to derive relative labels (\"your sister\"). Pass a null identityId to clear it.
  ///
  /// Parameters:
  ///
  /// * [FamilyMyRootUpdateDto] familyMyRootUpdateDto (required):
  Future<void> setMyRoot(FamilyMyRootUpdateDto familyMyRootUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await setMyRootWithHttpInfo(familyMyRootUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Set an identity's gender
  ///
  /// Set or clear the gender recorded for an identity, used only to pick relation-label wording.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [FamilyGenderUpdateDto] familyGenderUpdateDto (required):
  Future<Response> updateGenderWithHttpInfo(String id, FamilyGenderUpdateDto familyGenderUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/identities/{id}/gender'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = familyGenderUpdateDto;

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

  /// Set an identity's gender
  ///
  /// Set or clear the gender recorded for an identity, used only to pick relation-label wording.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [FamilyGenderUpdateDto] familyGenderUpdateDto (required):
  Future<void> updateGender(String id, FamilyGenderUpdateDto familyGenderUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateGenderWithHttpInfo(id, familyGenderUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update a family union
  ///
  /// Update the status or dates of a family union.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [FamilyUnionUpdateDto] familyUnionUpdateDto (required):
  Future<Response> updateUnionWithHttpInfo(String id, FamilyUnionUpdateDto familyUnionUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/family/unions/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = familyUnionUpdateDto;

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

  /// Update a family union
  ///
  /// Update the status or dates of a family union.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [FamilyUnionUpdateDto] familyUnionUpdateDto (required):
  Future<void> updateUnion(String id, FamilyUnionUpdateDto familyUnionUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateUnionWithHttpInfo(id, familyUnionUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}

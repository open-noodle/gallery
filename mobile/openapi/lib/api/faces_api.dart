//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class FacesApi {
  FacesApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Create a face
  ///
  /// Create a new face that has not been discovered by facial recognition. The content of the bounding box is considered a face.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [AssetFaceCreateDto] assetFaceCreateDto (required):
  Future<Response> createFaceWithHttpInfo(AssetFaceCreateDto assetFaceCreateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/faces';

    // ignore: prefer_final_locals
    Object? postBody = assetFaceCreateDto;

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

  /// Create a face
  ///
  /// Create a new face that has not been discovered by facial recognition. The content of the bounding box is considered a face.
  ///
  /// Parameters:
  ///
  /// * [AssetFaceCreateDto] assetFaceCreateDto (required):
  Future<void> createFace(AssetFaceCreateDto assetFaceCreateDto, { Future<void>? abortTrigger, }) async {
    final response = await createFaceWithHttpInfo(assetFaceCreateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Create a person under an owner for the move-to-chosen-person picker
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] ownerId (required):
  ///
  /// * [FaceRepairOwnerPersonCreateRequestDto] faceRepairOwnerPersonCreateRequestDto (required):
  Future<Response> createFaceRepairOwnerPersonWithHttpInfo(String ownerId, FaceRepairOwnerPersonCreateRequestDto faceRepairOwnerPersonCreateRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/owner/{ownerId}/people'
      .replaceAll('{ownerId}', ownerId);

    // ignore: prefer_final_locals
    Object? postBody = faceRepairOwnerPersonCreateRequestDto;

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

  /// Create a person under an owner for the move-to-chosen-person picker
  ///
  /// Parameters:
  ///
  /// * [String] ownerId (required):
  ///
  /// * [FaceRepairOwnerPersonCreateRequestDto] faceRepairOwnerPersonCreateRequestDto (required):
  Future<FaceRepairOwnerPersonCreatedResponseDto?> createFaceRepairOwnerPerson(String ownerId, FaceRepairOwnerPersonCreateRequestDto faceRepairOwnerPersonCreateRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await createFaceRepairOwnerPersonWithHttpInfo(ownerId, faceRepairOwnerPersonCreateRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairOwnerPersonCreatedResponseDto',) as FaceRepairOwnerPersonCreatedResponseDto;
    
    }
    return null;
  }

  /// Decline flagged faces / dismiss flagged persons
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FaceRepairDeclineRequestDto] faceRepairDeclineRequestDto (required):
  Future<Response> declineFaceRepairWithHttpInfo(FaceRepairDeclineRequestDto faceRepairDeclineRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/decline';

    // ignore: prefer_final_locals
    Object? postBody = faceRepairDeclineRequestDto;

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

  /// Decline flagged faces / dismiss flagged persons
  ///
  /// Parameters:
  ///
  /// * [FaceRepairDeclineRequestDto] faceRepairDeclineRequestDto (required):
  Future<FaceRepairDeclineCreatedDto?> declineFaceRepair(FaceRepairDeclineRequestDto faceRepairDeclineRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await declineFaceRepairWithHttpInfo(faceRepairDeclineRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairDeclineCreatedDto',) as FaceRepairDeclineCreatedDto;
    
    }
    return null;
  }

  /// Delete a face
  ///
  /// Delete a face identified by the id. Optionally can be force deleted.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [AssetFaceDeleteDto] assetFaceDeleteDto (required):
  Future<Response> deleteFaceWithHttpInfo(String id, AssetFaceDeleteDto assetFaceDeleteDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/faces/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = assetFaceDeleteDto;

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

  /// Delete a face
  ///
  /// Delete a face identified by the id. Optionally can be force deleted.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [AssetFaceDeleteDto] assetFaceDeleteDto (required):
  Future<void> deleteFace(String id, AssetFaceDeleteDto assetFaceDeleteDto, { Future<void>? abortTrigger, }) async {
    final response = await deleteFaceWithHttpInfo(id, assetFaceDeleteDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// List a person's cluster faces (paginated, excluding the supplied flagged ids)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] personId (required):
  ///
  /// * [FaceRepairClusterFacesRequestDto] faceRepairClusterFacesRequestDto (required):
  Future<Response> getFaceRepairClusterFacesWithHttpInfo(String personId, FaceRepairClusterFacesRequestDto faceRepairClusterFacesRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/scan/person/{personId}/cluster-faces'
      .replaceAll('{personId}', personId);

    // ignore: prefer_final_locals
    Object? postBody = faceRepairClusterFacesRequestDto;

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

  /// List a person's cluster faces (paginated, excluding the supplied flagged ids)
  ///
  /// Parameters:
  ///
  /// * [String] personId (required):
  ///
  /// * [FaceRepairClusterFacesRequestDto] faceRepairClusterFacesRequestDto (required):
  Future<FaceRepairClusterFacesResponseDto?> getFaceRepairClusterFaces(String personId, FaceRepairClusterFacesRequestDto faceRepairClusterFacesRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairClusterFacesWithHttpInfo(personId, faceRepairClusterFacesRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairClusterFacesResponseDto',) as FaceRepairClusterFacesResponseDto;
    
    }
    return null;
  }

  /// List face-repair declines
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getFaceRepairDeclinesWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/decline';

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

  /// List face-repair declines
  Future<FaceRepairDeclineListDto?> getFaceRepairDeclines({ Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairDeclinesWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairDeclineListDto',) as FaceRepairDeclineListDto;
    
    }
    return null;
  }

  /// Get an admin face-repair source photo
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  Future<Response> getFaceRepairFacePreviewWithHttpInfo(String assetFaceId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/faces/{assetFaceId}/preview'
      .replaceAll('{assetFaceId}', assetFaceId);

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

  /// Get an admin face-repair source photo
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  Future<MultipartFile?> getFaceRepairFacePreview(String assetFaceId, { Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairFacePreviewWithHttpInfo(assetFaceId, abortTrigger: abortTrigger,);
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

  /// Get an admin face-repair face thumbnail
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  Future<Response> getFaceRepairFaceThumbnailWithHttpInfo(String assetFaceId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/faces/{assetFaceId}/thumbnail'
      .replaceAll('{assetFaceId}', assetFaceId);

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

  /// Get an admin face-repair face thumbnail
  ///
  /// Parameters:
  ///
  /// * [String] assetFaceId (required):
  Future<MultipartFile?> getFaceRepairFaceThumbnail(String assetFaceId, { Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairFaceThumbnailWithHttpInfo(assetFaceId, abortTrigger: abortTrigger,);
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

  /// Search an owner's people for the move-to-chosen-person picker
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] ownerId (required):
  ///
  /// * [int] page:
  ///
  /// * [String] query:
  Future<Response> getFaceRepairOwnerPeopleWithHttpInfo(String ownerId, { int? page, String? query, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/owner/{ownerId}/people'
      .replaceAll('{ownerId}', ownerId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (page != null) {
      queryParams.addAll(_queryParams('', 'page', page));
    }
    if (query != null) {
      queryParams.addAll(_queryParams('', 'query', query));
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

  /// Search an owner's people for the move-to-chosen-person picker
  ///
  /// Parameters:
  ///
  /// * [String] ownerId (required):
  ///
  /// * [int] page:
  ///
  /// * [String] query:
  Future<FaceRepairOwnerPeopleResponseDto?> getFaceRepairOwnerPeople(String ownerId, { int? page, String? query, Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairOwnerPeopleWithHttpInfo(ownerId, page: page, query: query, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairOwnerPeopleResponseDto',) as FaceRepairOwnerPeopleResponseDto;
    
    }
    return null;
  }

  /// Get a person's flagged faces for review
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] personId (required):
  Future<Response> getFaceRepairPersonFacesWithHttpInfo(String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/scan/person/{personId}'
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

  /// Get a person's flagged faces for review
  ///
  /// Parameters:
  ///
  /// * [String] personId (required):
  Future<FaceRepairPersonFacesDto?> getFaceRepairPersonFaces(String personId, { Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairPersonFacesWithHttpInfo(personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairPersonFacesDto',) as FaceRepairPersonFacesDto;
    
    }
    return null;
  }

  /// Get a person for manual review
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] personId (required):
  Future<Response> getFaceRepairPersonMetadataWithHttpInfo(String personId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/person/{personId}'
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

  /// Get a person for manual review
  ///
  /// Parameters:
  ///
  /// * [String] personId (required):
  Future<FaceRepairPersonMetadataResponseDto?> getFaceRepairPersonMetadata(String personId, { Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairPersonMetadataWithHttpInfo(personId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairPersonMetadataResponseDto',) as FaceRepairPersonMetadataResponseDto;
    
    }
    return null;
  }

  /// List face-repair resolutions (negative verdicts from both engines)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of resolutions per page
  Future<Response> getFaceRepairResolutionsWithHttpInfo({ int? page, int? size, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/resolutions';

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

  /// List face-repair resolutions (negative verdicts from both engines)
  ///
  /// Parameters:
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of resolutions per page
  Future<FaceRepairResolutionsListDto?> getFaceRepairResolutions({ int? page, int? size, Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairResolutionsWithHttpInfo(page: page, size: size, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairResolutionsListDto',) as FaceRepairResolutionsListDto;
    
    }
    return null;
  }

  /// Get effective face-repair scan defaults
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getFaceRepairScanDefaultsWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/scan/defaults';

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

  /// Get effective face-repair scan defaults
  Future<FaceRepairScanDefaultsDto?> getFaceRepairScanDefaults({ Future<void>? abortTrigger, }) async {
    final response = await getFaceRepairScanDefaultsWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairScanDefaultsDto',) as FaceRepairScanDefaultsDto;
    
    }
    return null;
  }

  /// Retrieve faces for asset
  ///
  /// Retrieve all faces belonging to an asset.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///   Face ID
  Future<Response> getFacesWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/faces';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'id', id));

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

  /// Retrieve faces for asset
  ///
  /// Retrieve all faces belonging to an asset.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///   Face ID
  Future<List<AssetFaceResponseDto>?> getFaces(String id, { Future<void>? abortTrigger, }) async {
    final response = await getFacesWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<AssetFaceResponseDto>') as List)
        .cast<AssetFaceResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get the latest face-repair scan
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getLatestScanWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/scan/latest';

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

  /// Get the latest face-repair scan
  Future<Object?> getLatestScan({ Future<void>? abortTrigger, }) async {
    final response = await getLatestScanWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'Object',) as Object;
    
    }
    return null;
  }

  /// Re-assign a face to another person
  ///
  /// Re-assign the face provided in the body to the person identified by the id in the path parameter.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [FaceDto] faceDto (required):
  Future<Response> reassignFacesByIdWithHttpInfo(String id, FaceDto faceDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/faces/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = faceDto;

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

  /// Re-assign a face to another person
  ///
  /// Re-assign the face provided in the body to the person identified by the id in the path parameter.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [FaceDto] faceDto (required):
  Future<PersonResponseDto?> reassignFacesById(String id, FaceDto faceDto, { Future<void>? abortTrigger, }) async {
    final response = await reassignFacesByIdWithHttpInfo(id, faceDto, abortTrigger: abortTrigger,);
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

  /// Remove face-repair declines
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FaceRepairDeclineRemoveRequestDto] faceRepairDeclineRemoveRequestDto (required):
  Future<Response> removeFaceRepairDeclinesWithHttpInfo(FaceRepairDeclineRemoveRequestDto faceRepairDeclineRemoveRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/decline';

    // ignore: prefer_final_locals
    Object? postBody = faceRepairDeclineRemoveRequestDto;

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

  /// Remove face-repair declines
  ///
  /// Parameters:
  ///
  /// * [FaceRepairDeclineRemoveRequestDto] faceRepairDeclineRemoveRequestDto (required):
  Future<FaceRepairDeclineRemovedDto?> removeFaceRepairDeclines(FaceRepairDeclineRemoveRequestDto faceRepairDeclineRemoveRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await removeFaceRepairDeclinesWithHttpInfo(faceRepairDeclineRemoveRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairDeclineRemovedDto',) as FaceRepairDeclineRemovedDto;
    
    }
    return null;
  }

  /// Remove face-repair resolutions (undo)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FaceRepairResolutionsRemoveRequestDto] faceRepairResolutionsRemoveRequestDto (required):
  Future<Response> removeFaceRepairResolutionsWithHttpInfo(FaceRepairResolutionsRemoveRequestDto faceRepairResolutionsRemoveRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/resolutions/remove';

    // ignore: prefer_final_locals
    Object? postBody = faceRepairResolutionsRemoveRequestDto;

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

  /// Remove face-repair resolutions (undo)
  ///
  /// Parameters:
  ///
  /// * [FaceRepairResolutionsRemoveRequestDto] faceRepairResolutionsRemoveRequestDto (required):
  Future<FaceRepairResolutionsRemovedDto?> removeFaceRepairResolutions(FaceRepairResolutionsRemoveRequestDto faceRepairResolutionsRemoveRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await removeFaceRepairResolutionsWithHttpInfo(faceRepairResolutionsRemoveRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairResolutionsRemovedDto',) as FaceRepairResolutionsRemovedDto;
    
    }
    return null;
  }

  /// Resolve reviewed faces
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FaceRepairResolveRequestDto] faceRepairResolveRequestDto (required):
  Future<Response> resolveFacesWithHttpInfo(FaceRepairResolveRequestDto faceRepairResolveRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/resolve';

    // ignore: prefer_final_locals
    Object? postBody = faceRepairResolveRequestDto;

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

  /// Resolve reviewed faces
  ///
  /// Parameters:
  ///
  /// * [FaceRepairResolveRequestDto] faceRepairResolveRequestDto (required):
  Future<FaceRepairResolveResponseDto?> resolveFaces(FaceRepairResolveRequestDto faceRepairResolveRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await resolveFacesWithHttpInfo(faceRepairResolveRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairResolveResponseDto',) as FaceRepairResolveResponseDto;
    
    }
    return null;
  }

  /// Run face re-attribution repair
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FaceRepairRequestDto] faceRepairRequestDto (required):
  Future<Response> runFaceRepairWithHttpInfo(FaceRepairRequestDto faceRepairRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair';

    // ignore: prefer_final_locals
    Object? postBody = faceRepairRequestDto;

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

  /// Run face re-attribution repair
  ///
  /// Parameters:
  ///
  /// * [FaceRepairRequestDto] faceRepairRequestDto (required):
  Future<FaceRepairResponseDto?> runFaceRepair(FaceRepairRequestDto faceRepairRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await runFaceRepairWithHttpInfo(faceRepairRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairResponseDto',) as FaceRepairResponseDto;
    
    }
    return null;
  }

  /// Trigger a face-repair scan
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FaceRepairScanTriggerRequestDto] faceRepairScanTriggerRequestDto (required):
  Future<Response> triggerScanWithHttpInfo(FaceRepairScanTriggerRequestDto faceRepairScanTriggerRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/scan';

    // ignore: prefer_final_locals
    Object? postBody = faceRepairScanTriggerRequestDto;

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

  /// Trigger a face-repair scan
  ///
  /// Parameters:
  ///
  /// * [FaceRepairScanTriggerRequestDto] faceRepairScanTriggerRequestDto (required):
  Future<FaceRepairScanTriggerResponseDto?> triggerScan(FaceRepairScanTriggerRequestDto faceRepairScanTriggerRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await triggerScanWithHttpInfo(faceRepairScanTriggerRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairScanTriggerResponseDto',) as FaceRepairScanTriggerResponseDto;
    
    }
    return null;
  }

  /// Un-confirm human-placed faces so a re-scan may flag them again
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [FaceRepairUnconfirmRequestDto] faceRepairUnconfirmRequestDto (required):
  Future<Response> unconfirmFaceRepairFacesWithHttpInfo(FaceRepairUnconfirmRequestDto faceRepairUnconfirmRequestDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/admin/face-repair/unconfirm';

    // ignore: prefer_final_locals
    Object? postBody = faceRepairUnconfirmRequestDto;

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

  /// Un-confirm human-placed faces so a re-scan may flag them again
  ///
  /// Parameters:
  ///
  /// * [FaceRepairUnconfirmRequestDto] faceRepairUnconfirmRequestDto (required):
  Future<FaceRepairResolutionsRemovedDto?> unconfirmFaceRepairFaces(FaceRepairUnconfirmRequestDto faceRepairUnconfirmRequestDto, { Future<void>? abortTrigger, }) async {
    final response = await unconfirmFaceRepairFacesWithHttpInfo(faceRepairUnconfirmRequestDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'FaceRepairResolutionsRemovedDto',) as FaceRepairResolutionsRemovedDto;
    
    }
    return null;
  }
}

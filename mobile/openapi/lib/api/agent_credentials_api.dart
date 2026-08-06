//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentCredentialsApi {
  AgentCredentialsApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Create an agent provider credential
  ///
  /// Create an encrypted AI agent provider credential for the current user.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [AgentProviderCredentialCreateDto] agentProviderCredentialCreateDto (required):
  Future<Response> createAgentProviderCredentialWithHttpInfo(AgentProviderCredentialCreateDto agentProviderCredentialCreateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/agent/provider-credentials';

    // ignore: prefer_final_locals
    Object? postBody = agentProviderCredentialCreateDto;

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

  /// Create an agent provider credential
  ///
  /// Create an encrypted AI agent provider credential for the current user.
  ///
  /// Parameters:
  ///
  /// * [AgentProviderCredentialCreateDto] agentProviderCredentialCreateDto (required):
  Future<AgentProviderCredentialResponseDto?> createAgentProviderCredential(AgentProviderCredentialCreateDto agentProviderCredentialCreateDto, { Future<void>? abortTrigger, }) async {
    final response = await createAgentProviderCredentialWithHttpInfo(agentProviderCredentialCreateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'AgentProviderCredentialResponseDto',) as AgentProviderCredentialResponseDto;
    
    }
    return null;
  }

  /// Delete an agent provider credential
  ///
  /// Delete an AI agent provider credential by ID. The current user must own this credential.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> deleteAgentProviderCredentialWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/agent/provider-credentials/{id}'
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

  /// Delete an agent provider credential
  ///
  /// Delete an AI agent provider credential by ID. The current user must own this credential.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> deleteAgentProviderCredential(String id, { Future<void>? abortTrigger, }) async {
    final response = await deleteAgentProviderCredentialWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Retrieve an agent provider credential
  ///
  /// Retrieve an AI agent provider credential by ID. The current user must own this credential.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getAgentProviderCredentialWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/agent/provider-credentials/{id}'
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

  /// Retrieve an agent provider credential
  ///
  /// Retrieve an AI agent provider credential by ID. The current user must own this credential.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<AgentProviderCredentialResponseDto?> getAgentProviderCredential(String id, { Future<void>? abortTrigger, }) async {
    final response = await getAgentProviderCredentialWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'AgentProviderCredentialResponseDto',) as AgentProviderCredentialResponseDto;
    
    }
    return null;
  }

  /// List agent provider credentials
  ///
  /// Retrieve all AI agent provider credentials owned by the current user.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getAgentProviderCredentialsWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/agent/provider-credentials';

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

  /// List agent provider credentials
  ///
  /// Retrieve all AI agent provider credentials owned by the current user.
  Future<List<AgentProviderCredentialResponseDto>?> getAgentProviderCredentials({ Future<void>? abortTrigger, }) async {
    final response = await getAgentProviderCredentialsWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<AgentProviderCredentialResponseDto>') as List)
        .cast<AgentProviderCredentialResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Update an agent provider credential
  ///
  /// Update an AI agent provider credential by ID. The current user must own this credential.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [AgentProviderCredentialUpdateDto] agentProviderCredentialUpdateDto (required):
  Future<Response> updateAgentProviderCredentialWithHttpInfo(String id, AgentProviderCredentialUpdateDto agentProviderCredentialUpdateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/agent/provider-credentials/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody = agentProviderCredentialUpdateDto;

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

  /// Update an agent provider credential
  ///
  /// Update an AI agent provider credential by ID. The current user must own this credential.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [AgentProviderCredentialUpdateDto] agentProviderCredentialUpdateDto (required):
  Future<AgentProviderCredentialResponseDto?> updateAgentProviderCredential(String id, AgentProviderCredentialUpdateDto agentProviderCredentialUpdateDto, { Future<void>? abortTrigger, }) async {
    final response = await updateAgentProviderCredentialWithHttpInfo(id, agentProviderCredentialUpdateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'AgentProviderCredentialResponseDto',) as AgentProviderCredentialResponseDto;
    
    }
    return null;
  }
}

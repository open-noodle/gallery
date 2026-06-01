//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class StorageMigrationAdminApi {
  StorageMigrationAdminApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Get storage migration estimate
  ///
  /// Estimate the number of files and approximate size that would be migrated for the given direction.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [StorageMigrationDirection] direction (required):
  ///   Migration direction
  Future<Response> getEstimateWithHttpInfo(StorageMigrationDirection direction, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/storage-migration/estimate';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'direction', direction));

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

  /// Get storage migration estimate
  ///
  /// Estimate the number of files and approximate size that would be migrated for the given direction.
  ///
  /// Parameters:
  ///
  /// * [StorageMigrationDirection] direction (required):
  ///   Migration direction
  Future<void> getEstimate(StorageMigrationDirection direction, { Future<void>? abortTrigger, }) async {
    final response = await getEstimateWithHttpInfo(direction, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get storage migration status
  ///
  /// Retrieve the current status of the storage migration queue, including active and pending job counts.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getStatusWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/storage-migration/status';

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

  /// Get storage migration status
  ///
  /// Retrieve the current status of the storage migration queue, including active and pending job counts.
  Future<void> getStatus({ Future<void>? abortTrigger, }) async {
    final response = await getStatusWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Rollback a storage migration batch
  ///
  /// Rollback a previously completed storage migration batch by reverting all database path changes.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] batchId (required):
  ///   Batch ID
  Future<Response> rollbackWithHttpInfo(String batchId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/storage-migration/rollback/{batchId}'
      .replaceAll('{batchId}', batchId);

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

  /// Rollback a storage migration batch
  ///
  /// Rollback a previously completed storage migration batch by reverting all database path changes.
  ///
  /// Parameters:
  ///
  /// * [String] batchId (required):
  ///   Batch ID
  Future<void> rollback(String batchId, { Future<void>? abortTrigger, }) async {
    final response = await rollbackWithHttpInfo(batchId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Start storage migration
  ///
  /// Start a storage backend migration job to move files between disk and S3 storage.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [StorageMigrationStartDto] storageMigrationStartDto (required):
  Future<Response> startWithHttpInfo(StorageMigrationStartDto storageMigrationStartDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/storage-migration/start';

    // ignore: prefer_final_locals
    Object? postBody = storageMigrationStartDto;

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

  /// Start storage migration
  ///
  /// Start a storage backend migration job to move files between disk and S3 storage.
  ///
  /// Parameters:
  ///
  /// * [StorageMigrationStartDto] storageMigrationStartDto (required):
  Future<void> start(StorageMigrationStartDto storageMigrationStartDto, { Future<void>? abortTrigger, }) async {
    final response = await startWithHttpInfo(storageMigrationStartDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}

//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiClient {
  ApiClient({this.basePath = '/api', this.authentication,});

  String basePath;
  final Authentication? authentication;

  var _client = Client();
  final _defaultHeaderMap = <String, String>{};

  /// Returns the current HTTP [Client] instance to use in this class.
  ///
  /// The return value is guaranteed to never be null.
  Client get client => _client;

  /// Requests to use a new HTTP [Client] in this class.
  set client(Client newClient) {
    _client = newClient;
  }

  Map<String, String> get defaultHeaderMap => _defaultHeaderMap;

  void addDefaultHeader(String key, String value) {
     _defaultHeaderMap[key] = value;
  }

  // We don't use a Map<String, String> for queryParams.
  // If collectionFormat is 'multi', a key might appear multiple times.
  Future<Response> invokeAPI(
    String path,
    String method,
    List<QueryParam> queryParams,
    Object? body,
    Map<String, String> headerParams,
    Map<String, String> formParams,
    String? contentType, {
    Future<void>? abortTrigger,
  }) async {
    await authentication?.applyToParams(queryParams, headerParams);

    headerParams.addAll(_defaultHeaderMap);
    if (contentType != null) {
      headerParams['Content-Type'] = contentType;
    }

    final urlEncodedQueryParams = queryParams.map((param) => '$param');
    final queryString = urlEncodedQueryParams.isNotEmpty ? '?${urlEncodedQueryParams.join('&')}' : '';
    final uri = Uri.parse('$basePath$path$queryString');

    try {
      // Special case for uploading a single file which isn't a 'multipart/form-data'.
      if (
        body is MultipartFile && (contentType == null ||
        !contentType.toLowerCase().startsWith('multipart/form-data'))
      ) {
        final request = AbortableStreamedRequest(method, uri, abortTrigger: abortTrigger);
        request.headers.addAll(headerParams);
        request.contentLength = body.length;
        body.finalize().listen(
          request.sink.add,
          onDone: request.sink.close,
          // ignore: avoid_types_on_closure_parameters
          onError: (Object error, StackTrace trace) => request.sink.close(),
          cancelOnError: true,
        );
        final response = await _client.send(request);
        return Response.fromStream(response);
      }

      if (body is MultipartRequest) {
        final request = AbortableMultipartRequest(method, uri, abortTrigger: abortTrigger);
        request.fields.addAll(body.fields);
        request.files.addAll(body.files);
        request.headers.addAll(body.headers);
        request.headers.addAll(headerParams);
        final response = await _client.send(request);
        return Response.fromStream(response);
      }

      final msgBody = contentType == 'application/x-www-form-urlencoded'
        ? formParams
        : await serializeAsync(body);
      final nullableHeaderParams = headerParams.isEmpty ? null : headerParams;

      final request = AbortableRequest(method, uri, abortTrigger: abortTrigger);
      if (nullableHeaderParams != null) {
        request.headers.addAll(nullableHeaderParams);
      }
      if (msgBody is String && msgBody.isNotEmpty) {
        request.body = msgBody;
      } else if (msgBody is List<int> && msgBody.isNotEmpty) {
        request.bodyBytes = msgBody;
      } else if (msgBody is Map<String, String>) {
        request.bodyFields = msgBody;
      }
      final response = await _client.send(request);
      return Response.fromStream(response);
    } on SocketException catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'Socket operation failed: $method $path',
        error,
        trace,
      );
    } on TlsException catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'TLS/SSL communication failed: $method $path',
        error,
        trace,
      );
    } on IOException catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'I/O operation failed: $method $path',
        error,
        trace,
      );
    } on ClientException catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'HTTP connection failed: $method $path',
        error,
        trace,
      );
    } on Exception catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'Exception occurred: $method $path',
        error,
        trace,
      );
    }
  }

  Future<dynamic> deserializeAsync(String value, String targetType, {bool growable = false,}) =>
    // ignore: deprecated_member_use_from_same_package
    deserialize(value, targetType, growable: growable);

  @Deprecated('Scheduled for removal in OpenAPI Generator 6.x. Use deserializeAsync() instead.')
  Future<dynamic> deserialize(String value, String targetType, {bool growable = false,}) async {
    // Remove all spaces. Necessary for regular expressions as well.
    targetType = targetType.replaceAll(' ', ''); // ignore: parameter_assignments

    // If the expected target type is String, nothing to do...
    return targetType == 'String'
      ? value
      : fromJson(await compute((String j) => json.decode(j), value), targetType, growable: growable);
  }

  // ignore: deprecated_member_use_from_same_package
  Future<String> serializeAsync(Object? value) async => serialize(value);

  @Deprecated('Scheduled for removal in OpenAPI Generator 6.x. Use serializeAsync() instead.')
  String serialize(Object? value) => value == null ? '' : json.encode(value);

  /// Returns a native instance of an OpenAPI class matching the [specified type][targetType].
  static dynamic fromJson(dynamic value, String targetType, {bool growable = false,}) {
    try {
      switch (targetType) {
        case 'String':
          return value is String ? value : value.toString();
        case 'int':
          return value is int ? value : int.parse('$value');
        case 'double':
          return value is double ? value : double.parse('$value');
        case 'bool':
          if (value is bool) {
            return value;
          }
          final valueString = '$value'.toLowerCase();
          return valueString == 'true' || valueString == '1';
        case 'DateTime':
          return value is DateTime ? value : DateTime.tryParse(value);
        case 'ActivityCreateDto':
          return ActivityCreateDto.fromJson(value);
        case 'ActivityResponseDto':
          return ActivityResponseDto.fromJson(value);
        case 'ActivityStatisticsResponseDto':
          return ActivityStatisticsResponseDto.fromJson(value);
        case 'AddUsersDto':
          return AddUsersDto.fromJson(value);
        case 'AdjustParameters':
          return AdjustParameters.fromJson(value);
        case 'AdminOnboardingUpdateDto':
          return AdminOnboardingUpdateDto.fromJson(value);
        case 'AgentAlbumAddAssetsOperationType':
          return AgentAlbumAddAssetsOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumAddUsersOperationType':
          return AgentAlbumAddUsersOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumCreateOperationType':
          return AgentAlbumCreateOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumDeleteOperationType':
          return AgentAlbumDeleteOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumDetail':
          return AgentAlbumDetail.fromJson(value);
        case 'AgentAlbumRemoveAssetsOperationType':
          return AgentAlbumRemoveAssetsOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumRemoveUsersOperationType':
          return AgentAlbumRemoveUsersOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumSetCoverOperationType':
          return AgentAlbumSetCoverOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumSummary':
          return AgentAlbumSummary.fromJson(value);
        case 'AgentAlbumUpdateDetailsOperationType':
          return AgentAlbumUpdateDetailsOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumUpdateUserRoleOperationType':
          return AgentAlbumUpdateUserRoleOperationTypeTypeTransformer().decode(value);
        case 'AgentAlbumUserSummary':
          return AgentAlbumUserSummary.fromJson(value);
        case 'AgentApprovalMode':
          return AgentApprovalModeTypeTransformer().decode(value);
        case 'AgentAssetAddTagOperationType':
          return AgentAssetAddTagOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetAdjustOperationType':
          return AgentAssetAdjustOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetCropOperationType':
          return AgentAssetCropOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetFlipOperationType':
          return AgentAssetFlipOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetMediaReference':
          return AgentAssetMediaReference.fromJson(value);
        case 'AgentAssetMetadataDetail':
          return AgentAssetMetadataDetailTypeTransformer().decode(value);
        case 'AgentAssetMetadataField':
          return AgentAssetMetadataFieldTypeTransformer().decode(value);
        case 'AgentAssetMetadataQuality':
          return AgentAssetMetadataQuality.fromJson(value);
        case 'AgentAssetMetadataResult':
          return AgentAssetMetadataResult.fromJson(value);
        case 'AgentAssetMetadataResultExifInfo':
          return AgentAssetMetadataResultExifInfo.fromJson(value);
        case 'AgentAssetMetadataTag':
          return AgentAssetMetadataTag.fromJson(value);
        case 'AgentAssetRemoveTagOperationType':
          return AgentAssetRemoveTagOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetRestoreOperationType':
          return AgentAssetRestoreOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetRotateOperationType':
          return AgentAssetRotateOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetSetArchiveOperationType':
          return AgentAssetSetArchiveOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetSetFavoriteOperationType':
          return AgentAssetSetFavoriteOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetSetVisibilityOperationType':
          return AgentAssetSetVisibilityOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetSourceInput':
          return AgentAssetSourceInput.fromJson(value);
        case 'AgentAssetStackOperationType':
          return AgentAssetStackOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetTrashOperationType':
          return AgentAssetTrashOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetUnstackOperationType':
          return AgentAssetUnstackOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetUpdateMetadataOperationType':
          return AgentAssetUpdateMetadataOperationTypeTypeTransformer().decode(value);
        case 'AgentAssetUpdateMetadataTargetKind':
          return AgentAssetUpdateMetadataTargetKindTypeTransformer().decode(value);
        case 'AgentAssignableAlbumUserRole':
          return AgentAssignableAlbumUserRoleTypeTransformer().decode(value);
        case 'AgentAssignableSharedSpaceMemberRole':
          return AgentAssignableSharedSpaceMemberRoleTypeTransformer().decode(value);
        case 'AgentCredentialSnapshot':
          return AgentCredentialSnapshot.fromJson(value);
        case 'AgentDeclarativeAssetFilters':
          return AgentDeclarativeAssetFilters.fromJson(value);
        case 'AgentDeclarativeCameraFilter':
          return AgentDeclarativeCameraFilter.fromJson(value);
        case 'AgentDeclarativeNameMatch':
          return AgentDeclarativeNameMatchTypeTransformer().decode(value);
        case 'AgentDeclarativeNamedFilter':
          return AgentDeclarativeNamedFilter.fromJson(value);
        case 'AgentDeclarativeSpaceFilter':
          return AgentDeclarativeSpaceFilter.fromJson(value);
        case 'AgentDuplicateAsset':
          return AgentDuplicateAsset.fromJson(value);
        case 'AgentDuplicateGroup':
          return AgentDuplicateGroup.fromJson(value);
        case 'AgentExplicitAssetsAssetSourceInput':
          return AgentExplicitAssetsAssetSourceInput.fromJson(value);
        case 'AgentFindTripCandidatesToolApprovalRequiredResponse':
          return AgentFindTripCandidatesToolApprovalRequiredResponse.fromJson(value);
        case 'AgentFindTripCandidatesToolDeniedResponse':
          return AgentFindTripCandidatesToolDeniedResponse.fromJson(value);
        case 'AgentFindTripCandidatesToolRequestDto':
          return AgentFindTripCandidatesToolRequestDto.fromJson(value);
        case 'AgentFindTripCandidatesToolResponseDto':
          return AgentFindTripCandidatesToolResponseDto.fromJson(value);
        case 'AgentFindTripCandidatesToolSuccessResponse':
          return AgentFindTripCandidatesToolSuccessResponse.fromJson(value);
        case 'AgentListAlbumsToolApprovalRequiredResponse':
          return AgentListAlbumsToolApprovalRequiredResponse.fromJson(value);
        case 'AgentListAlbumsToolDeniedResponse':
          return AgentListAlbumsToolDeniedResponse.fromJson(value);
        case 'AgentListAlbumsToolRequestDto':
          return AgentListAlbumsToolRequestDto.fromJson(value);
        case 'AgentListAlbumsToolResponseDto':
          return AgentListAlbumsToolResponseDto.fromJson(value);
        case 'AgentListAlbumsToolSuccessResponse':
          return AgentListAlbumsToolSuccessResponse.fromJson(value);
        case 'AgentListDuplicateGroupsToolApprovalRequiredResponse':
          return AgentListDuplicateGroupsToolApprovalRequiredResponse.fromJson(value);
        case 'AgentListDuplicateGroupsToolDeniedResponse':
          return AgentListDuplicateGroupsToolDeniedResponse.fromJson(value);
        case 'AgentListDuplicateGroupsToolRequestDto':
          return AgentListDuplicateGroupsToolRequestDto.fromJson(value);
        case 'AgentListDuplicateGroupsToolResponseDto':
          return AgentListDuplicateGroupsToolResponseDto.fromJson(value);
        case 'AgentListDuplicateGroupsToolSuccessResponse':
          return AgentListDuplicateGroupsToolSuccessResponse.fromJson(value);
        case 'AgentListSpacesToolApprovalRequiredResponse':
          return AgentListSpacesToolApprovalRequiredResponse.fromJson(value);
        case 'AgentListSpacesToolDeniedResponse':
          return AgentListSpacesToolDeniedResponse.fromJson(value);
        case 'AgentListSpacesToolRequestDto':
          return AgentListSpacesToolRequestDto.fromJson(value);
        case 'AgentListSpacesToolResponseDto':
          return AgentListSpacesToolResponseDto.fromJson(value);
        case 'AgentListSpacesToolSuccessResponse':
          return AgentListSpacesToolSuccessResponse.fromJson(value);
        case 'AgentMessageAssetBlock':
          return AgentMessageAssetBlock.fromJson(value);
        case 'AgentMessageAssetBlockType':
          return AgentMessageAssetBlockTypeTypeTransformer().decode(value);
        case 'AgentMessageBlock':
          return AgentMessageBlock.fromJson(value);
        case 'AgentMessageClarificationBlock':
          return AgentMessageClarificationBlock.fromJson(value);
        case 'AgentMessageClarificationBlockType':
          return AgentMessageClarificationBlockTypeTypeTransformer().decode(value);
        case 'AgentMessageClarificationChoice':
          return AgentMessageClarificationChoice.fromJson(value);
        case 'AgentMessageContent':
          return AgentMessageContent.fromJson(value);
        case 'AgentMessageCreateDto':
          return AgentMessageCreateDto.fromJson(value);
        case 'AgentMessagePlanBlock':
          return AgentMessagePlanBlock.fromJson(value);
        case 'AgentMessagePlanBlockType':
          return AgentMessagePlanBlockTypeTypeTransformer().decode(value);
        case 'AgentMessageResponseDto':
          return AgentMessageResponseDto.fromJson(value);
        case 'AgentMessageRole':
          return AgentMessageRoleTypeTransformer().decode(value);
        case 'AgentMessageTextBlock':
          return AgentMessageTextBlock.fromJson(value);
        case 'AgentMessageTextBlockType':
          return AgentMessageTextBlockTypeTypeTransformer().decode(value);
        case 'AgentMessageToolCallBlock':
          return AgentMessageToolCallBlock.fromJson(value);
        case 'AgentMessageToolCallBlockType':
          return AgentMessageToolCallBlockTypeTypeTransformer().decode(value);
        case 'AgentModelSnapshot':
          return AgentModelSnapshot.fromJson(value);
        case 'AgentOperationApplyStatus':
          return AgentOperationApplyStatusTypeTransformer().decode(value);
        case 'AgentOperationExistingAlbumTargetKind':
          return AgentOperationExistingAlbumTargetKindTypeTransformer().decode(value);
        case 'AgentOperationExistingSpaceTargetKind':
          return AgentOperationExistingSpaceTargetKindTypeTransformer().decode(value);
        case 'AgentOperationItemKind':
          return AgentOperationItemKindTypeTransformer().decode(value);
        case 'AgentOperationItemSelection':
          return AgentOperationItemSelection.fromJson(value);
        case 'AgentOperationItemSelectionOneOf':
          return AgentOperationItemSelectionOneOf.fromJson(value);
        case 'AgentOperationItemSelectionOneOf1':
          return AgentOperationItemSelectionOneOf1.fromJson(value);
        case 'AgentOperationItemSelectionOneOf2':
          return AgentOperationItemSelectionOneOf2.fromJson(value);
        case 'AgentOperationItemSelectionOneOf3':
          return AgentOperationItemSelectionOneOf3.fromJson(value);
        case 'AgentOperationNewAlbumTargetKind':
          return AgentOperationNewAlbumTargetKindTypeTransformer().decode(value);
        case 'AgentOperationNewSpaceTargetKind':
          return AgentOperationNewSpaceTargetKindTypeTransformer().decode(value);
        case 'AgentOperationPersonTargetKind':
          return AgentOperationPersonTargetKindTypeTransformer().decode(value);
        case 'AgentOperationPlanApplyRequestDto':
          return AgentOperationPlanApplyRequestDto.fromJson(value);
        case 'AgentOperationPlanApplyResponseDto':
          return AgentOperationPlanApplyResponseDto.fromJson(value);
        case 'AgentOperationPlanResponseDto':
          return AgentOperationPlanResponseDto.fromJson(value);
        case 'AgentOperationPlanStatus':
          return AgentOperationPlanStatusTypeTransformer().decode(value);
        case 'AgentOperationPlanSummaryRequestDto':
          return AgentOperationPlanSummaryRequestDto.fromJson(value);
        case 'AgentOperationPlanToolResponseDto':
          return AgentOperationPlanToolResponseDto.fromJson(value);
        case 'AgentOperationPlanningAssetSourceInput':
          return AgentOperationPlanningAssetSourceInput.fromJson(value);
        case 'AgentOperationResponseDto':
          return AgentOperationResponseDto.fromJson(value);
        case 'AgentOperationResponseDtoReviewMetadata':
          return AgentOperationResponseDtoReviewMetadata.fromJson(value);
        case 'AgentOperationResponseDtoReviewMetadataAssetMetadata':
          return AgentOperationResponseDtoReviewMetadataAssetMetadata.fromJson(value);
        case 'AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner':
          return AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInner.fromJson(value);
        case 'AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner':
          return AgentOperationResponseDtoReviewMetadataAssetMetadataFieldsInnerPreviousValuesInner.fromJson(value);
        case 'AgentOperationReviewMetadataValueKind':
          return AgentOperationReviewMetadataValueKindTypeTransformer().decode(value);
        case 'AgentOperationRiskLevel':
          return AgentOperationRiskLevelTypeTransformer().decode(value);
        case 'AgentOperationStatus':
          return AgentOperationStatusTypeTransformer().decode(value);
        case 'AgentOperationTargetKind':
          return AgentOperationTargetKindTypeTransformer().decode(value);
        case 'AgentOperationType':
          return AgentOperationTypeTypeTransformer().decode(value);
        case 'AgentPermissionPlan':
          return AgentPermissionPlan.fromJson(value);
        case 'AgentPermissionPlanAssetScope':
          return AgentPermissionPlanAssetScope.fromJson(value);
        case 'AgentPermissionPlanLimits':
          return AgentPermissionPlanLimits.fromJson(value);
        case 'AgentPermissionPlanProviderExposure':
          return AgentPermissionPlanProviderExposure.fromJson(value);
        case 'AgentPermissionPlanRead':
          return AgentPermissionPlanRead.fromJson(value);
        case 'AgentPermissionPlanWriteScope':
          return AgentPermissionPlanWriteScope.fromJson(value);
        case 'AgentPermissionPreset':
          return AgentPermissionPresetTypeTransformer().decode(value);
        case 'AgentPersonMergeOperationType':
          return AgentPersonMergeOperationTypeTypeTransformer().decode(value);
        case 'AgentPersonUpdateOperationType':
          return AgentPersonUpdateOperationTypeTypeTransformer().decode(value);
        case 'AgentPreviousSearchAssetSourceInput':
          return AgentPreviousSearchAssetSourceInput.fromJson(value);
        case 'AgentProposeAlbumOperationsDto':
          return AgentProposeAlbumOperationsDto.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInner':
          return AgentProposeAlbumOperationsDtoOperationsInner.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf1':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf1.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf10':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf10.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf10Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf10Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf11':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf11.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf11Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf11Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf12':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf12.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf12Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf12Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf12PayloadAlbumUsersInner':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf12PayloadAlbumUsersInner.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf13':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf13.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf14':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf14.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf15':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf15.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf16':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf16.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf17':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf17.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf17Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf17Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf18':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf18.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf18Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf18Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf19':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf2':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf2.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf20':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf20.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf20Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf21':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf21.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf21Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf21Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf22':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf22.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf22Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf22Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf23':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf23.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf23Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf24':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf24.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf24Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf25':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf25.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf25Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf25Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf26':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf26.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf26Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf26Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf27':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf27.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf28':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf28.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf29':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf29.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf3':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf3.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf30':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf30.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf31':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf31.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf32':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf32.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf33':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf33.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf33Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf33Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf34':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf34.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf34Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf34Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf3Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf3Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf4':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf4.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf5':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf5.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf5Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf5Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf6':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf6.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf7':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf7.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf8':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf8.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf8Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf8Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf9':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf9.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf9Payload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf9Payload.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf9PayloadMembersInner':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOf9PayloadMembersInner.fromJson(value);
        case 'AgentProposeAlbumOperationsDtoOperationsInnerOneOfPayload':
          return AgentProposeAlbumOperationsDtoOperationsInnerOneOfPayload.fromJson(value);
        case 'AgentProviderCredentialCreateDto':
          return AgentProviderCredentialCreateDto.fromJson(value);
        case 'AgentProviderCredentialResponseDto':
          return AgentProviderCredentialResponseDto.fromJson(value);
        case 'AgentProviderCredentialUpdateDto':
          return AgentProviderCredentialUpdateDto.fromJson(value);
        case 'AgentProviderType':
          return AgentProviderTypeTypeTransformer().decode(value);
        case 'AgentReadAlbumToolApprovalRequiredResponse':
          return AgentReadAlbumToolApprovalRequiredResponse.fromJson(value);
        case 'AgentReadAlbumToolDeniedResponse':
          return AgentReadAlbumToolDeniedResponse.fromJson(value);
        case 'AgentReadAlbumToolRequestDto':
          return AgentReadAlbumToolRequestDto.fromJson(value);
        case 'AgentReadAlbumToolResponseDto':
          return AgentReadAlbumToolResponseDto.fromJson(value);
        case 'AgentReadAlbumToolSuccessResponse':
          return AgentReadAlbumToolSuccessResponse.fromJson(value);
        case 'AgentReadAssetMetadataToolApprovalRequiredResponse':
          return AgentReadAssetMetadataToolApprovalRequiredResponse.fromJson(value);
        case 'AgentReadAssetMetadataToolDeniedResponse':
          return AgentReadAssetMetadataToolDeniedResponse.fromJson(value);
        case 'AgentReadAssetMetadataToolRequestDto':
          return AgentReadAssetMetadataToolRequestDto.fromJson(value);
        case 'AgentReadAssetMetadataToolResponseDto':
          return AgentReadAssetMetadataToolResponseDto.fromJson(value);
        case 'AgentReadAssetMetadataToolSuccessResponse':
          return AgentReadAssetMetadataToolSuccessResponse.fromJson(value);
        case 'AgentReadAssetOriginalsToolApprovalRequiredResponse':
          return AgentReadAssetOriginalsToolApprovalRequiredResponse.fromJson(value);
        case 'AgentReadAssetOriginalsToolDeniedResponse':
          return AgentReadAssetOriginalsToolDeniedResponse.fromJson(value);
        case 'AgentReadAssetOriginalsToolRequestDto':
          return AgentReadAssetOriginalsToolRequestDto.fromJson(value);
        case 'AgentReadAssetOriginalsToolResponseDto':
          return AgentReadAssetOriginalsToolResponseDto.fromJson(value);
        case 'AgentReadAssetOriginalsToolSuccessResponse':
          return AgentReadAssetOriginalsToolSuccessResponse.fromJson(value);
        case 'AgentReadAssetPreviewsToolApprovalRequiredResponse':
          return AgentReadAssetPreviewsToolApprovalRequiredResponse.fromJson(value);
        case 'AgentReadAssetPreviewsToolDeniedResponse':
          return AgentReadAssetPreviewsToolDeniedResponse.fromJson(value);
        case 'AgentReadAssetPreviewsToolRequestDto':
          return AgentReadAssetPreviewsToolRequestDto.fromJson(value);
        case 'AgentReadAssetPreviewsToolResponseDto':
          return AgentReadAssetPreviewsToolResponseDto.fromJson(value);
        case 'AgentReadAssetPreviewsToolSuccessResponse':
          return AgentReadAssetPreviewsToolSuccessResponse.fromJson(value);
        case 'AgentReadSpaceToolApprovalRequiredResponse':
          return AgentReadSpaceToolApprovalRequiredResponse.fromJson(value);
        case 'AgentReadSpaceToolDeniedResponse':
          return AgentReadSpaceToolDeniedResponse.fromJson(value);
        case 'AgentReadSpaceToolRequestDto':
          return AgentReadSpaceToolRequestDto.fromJson(value);
        case 'AgentReadSpaceToolResponseDto':
          return AgentReadSpaceToolResponseDto.fromJson(value);
        case 'AgentReadSpaceToolSuccessResponse':
          return AgentReadSpaceToolSuccessResponse.fromJson(value);
        case 'AgentReviseAlbumOperationsDto':
          return AgentReviseAlbumOperationsDto.fromJson(value);
        case 'AgentRunnerCapabilitiesDto':
          return AgentRunnerCapabilitiesDto.fromJson(value);
        case 'AgentRunnerStatusDto':
          return AgentRunnerStatusDto.fromJson(value);
        case 'AgentRunnerStatusReason':
          return AgentRunnerStatusReasonTypeTransformer().decode(value);
        case 'AgentSearchAssetSourceInput':
          return AgentSearchAssetSourceInput.fromJson(value);
        case 'AgentSearchAssetsDetail':
          return AgentSearchAssetsDetailTypeTransformer().decode(value);
        case 'AgentSearchAssetsField':
          return AgentSearchAssetsFieldTypeTransformer().decode(value);
        case 'AgentSearchAssetsFilters':
          return AgentSearchAssetsFilters.fromJson(value);
        case 'AgentSearchAssetsMode':
          return AgentSearchAssetsModeTypeTransformer().decode(value);
        case 'AgentSearchAssetsOrder':
          return AgentSearchAssetsOrderTypeTransformer().decode(value);
        case 'AgentSearchAssetsRequestDetail':
          return AgentSearchAssetsRequestDetailTypeTransformer().decode(value);
        case 'AgentSearchAssetsSample':
          return AgentSearchAssetsSample.fromJson(value);
        case 'AgentSearchAssetsSampleItem':
          return AgentSearchAssetsSampleItem.fromJson(value);
        case 'AgentSearchAssetsSampleItemTagsInner':
          return AgentSearchAssetsSampleItemTagsInner.fromJson(value);
        case 'AgentSearchAssetsSelectionHandle':
          return AgentSearchAssetsSelectionHandle.fromJson(value);
        case 'AgentSearchAssetsToolApprovalRequiredResponse':
          return AgentSearchAssetsToolApprovalRequiredResponse.fromJson(value);
        case 'AgentSearchAssetsToolDeniedResponse':
          return AgentSearchAssetsToolDeniedResponse.fromJson(value);
        case 'AgentSearchAssetsToolRequestDto':
          return AgentSearchAssetsToolRequestDto.fromJson(value);
        case 'AgentSearchAssetsToolResponseDto':
          return AgentSearchAssetsToolResponseDto.fromJson(value);
        case 'AgentSearchAssetsToolSuccessResponse':
          return AgentSearchAssetsToolSuccessResponse.fromJson(value);
        case 'AgentSearchPeopleAmbiguousResult':
          return AgentSearchPeopleAmbiguousResult.fromJson(value);
        case 'AgentSearchPeopleChoice':
          return AgentSearchPeopleChoice.fromJson(value);
        case 'AgentSearchPeopleMatchedResult':
          return AgentSearchPeopleMatchedResult.fromJson(value);
        case 'AgentSearchPeopleNotFoundResult':
          return AgentSearchPeopleNotFoundResult.fromJson(value);
        case 'AgentSearchPeopleResult':
          return AgentSearchPeopleResult.fromJson(value);
        case 'AgentSearchPeopleToolApprovalRequiredResponse':
          return AgentSearchPeopleToolApprovalRequiredResponse.fromJson(value);
        case 'AgentSearchPeopleToolDeniedResponse':
          return AgentSearchPeopleToolDeniedResponse.fromJson(value);
        case 'AgentSearchPeopleToolRequestDto':
          return AgentSearchPeopleToolRequestDto.fromJson(value);
        case 'AgentSearchPeopleToolResponseDto':
          return AgentSearchPeopleToolResponseDto.fromJson(value);
        case 'AgentSearchPeopleToolSuccessResponse':
          return AgentSearchPeopleToolSuccessResponse.fromJson(value);
        case 'AgentSearchUsersToolApprovalRequiredResponse':
          return AgentSearchUsersToolApprovalRequiredResponse.fromJson(value);
        case 'AgentSearchUsersToolDeniedResponse':
          return AgentSearchUsersToolDeniedResponse.fromJson(value);
        case 'AgentSearchUsersToolRequestDto':
          return AgentSearchUsersToolRequestDto.fromJson(value);
        case 'AgentSearchUsersToolResponseDto':
          return AgentSearchUsersToolResponseDto.fromJson(value);
        case 'AgentSearchUsersToolSuccessResponse':
          return AgentSearchUsersToolSuccessResponse.fromJson(value);
        case 'AgentSelectionHandleAssetSourceInput':
          return AgentSelectionHandleAssetSourceInput.fromJson(value);
        case 'AgentSessionActivityEventCounts':
          return AgentSessionActivityEventCounts.fromJson(value);
        case 'AgentSessionActivityEventResponseDto':
          return AgentSessionActivityEventResponseDto.fromJson(value);
        case 'AgentSessionActivityEventSource':
          return AgentSessionActivityEventSourceTypeTransformer().decode(value);
        case 'AgentSessionActivityEventStatus':
          return AgentSessionActivityEventStatusTypeTransformer().decode(value);
        case 'AgentSessionCreateDto':
          return AgentSessionCreateDto.fromJson(value);
        case 'AgentSessionResponseDto':
          return AgentSessionResponseDto.fromJson(value);
        case 'AgentSessionStatus':
          return AgentSessionStatusTypeTransformer().decode(value);
        case 'AgentSessionUpdateDto':
          return AgentSessionUpdateDto.fromJson(value);
        case 'AgentShareLinkCreateAlbumOperationType':
          return AgentShareLinkCreateAlbumOperationTypeTypeTransformer().decode(value);
        case 'AgentShareLinkCreateOperationType':
          return AgentShareLinkCreateOperationTypeTypeTransformer().decode(value);
        case 'AgentSpaceAddMembersOperationType':
          return AgentSpaceAddMembersOperationTypeTypeTransformer().decode(value);
        case 'AgentSpaceCreateOperationType':
          return AgentSpaceCreateOperationTypeTypeTransformer().decode(value);
        case 'AgentSpaceDeleteOperationType':
          return AgentSpaceDeleteOperationTypeTypeTransformer().decode(value);
        case 'AgentSpaceDetail':
          return AgentSpaceDetail.fromJson(value);
        case 'AgentSpaceMemberSummary':
          return AgentSpaceMemberSummary.fromJson(value);
        case 'AgentSpaceRemoveMembersOperationType':
          return AgentSpaceRemoveMembersOperationTypeTypeTransformer().decode(value);
        case 'AgentSpaceSummary':
          return AgentSpaceSummary.fromJson(value);
        case 'AgentSpaceUpdateDetailsOperationType':
          return AgentSpaceUpdateDetailsOperationTypeTypeTransformer().decode(value);
        case 'AgentSpaceUpdateMemberRoleOperationType':
          return AgentSpaceUpdateMemberRoleOperationTypeTypeTransformer().decode(value);
        case 'AgentToolApprovalDecision':
          return AgentToolApprovalDecisionTypeTransformer().decode(value);
        case 'AgentToolApprovalDto':
          return AgentToolApprovalDto.fromJson(value);
        case 'AgentToolCallResponseDto':
          return AgentToolCallResponseDto.fromJson(value);
        case 'AgentToolCallStatus':
          return AgentToolCallStatusTypeTransformer().decode(value);
        case 'AgentToolDataClass':
          return AgentToolDataClassTypeTransformer().decode(value);
        case 'AgentToolName':
          return AgentToolNameTypeTransformer().decode(value);
        case 'AgentToolResultSize':
          return AgentToolResultSize.fromJson(value);
        case 'AgentTripCandidateConfidence':
          return AgentTripCandidateConfidenceTypeTransformer().decode(value);
        case 'AgentTripCandidateNonAutoRecommendation':
          return AgentTripCandidateNonAutoRecommendation.fromJson(value);
        case 'AgentTripCandidateNonAutoRecommendationAction':
          return AgentTripCandidateNonAutoRecommendationActionTypeTransformer().decode(value);
        case 'AgentTripCandidateRecommendation':
          return AgentTripCandidateRecommendation.fromJson(value);
        case 'AgentTripCandidateSummary':
          return AgentTripCandidateSummary.fromJson(value);
        case 'AgentTripCandidateUseTopRecommendation':
          return AgentTripCandidateUseTopRecommendation.fromJson(value);
        case 'AgentTripCandidateUseTopRecommendationAction':
          return AgentTripCandidateUseTopRecommendationActionTypeTransformer().decode(value);
        case 'AgentUserLookupResult':
          return AgentUserLookupResult.fromJson(value);
        case 'AgentUserMessageContent':
          return AgentUserMessageContent.fromJson(value);
        case 'AlbumNameDto':
          return AlbumNameDto.fromJson(value);
        case 'AlbumResponseDto':
          return AlbumResponseDto.fromJson(value);
        case 'AlbumSharedSpaceLinkResponseDto':
          return AlbumSharedSpaceLinkResponseDto.fromJson(value);
        case 'AlbumStatisticsResponseDto':
          return AlbumStatisticsResponseDto.fromJson(value);
        case 'AlbumUserAddDto':
          return AlbumUserAddDto.fromJson(value);
        case 'AlbumUserCreateDto':
          return AlbumUserCreateDto.fromJson(value);
        case 'AlbumUserResponseDto':
          return AlbumUserResponseDto.fromJson(value);
        case 'AlbumUserRole':
          return AlbumUserRoleTypeTransformer().decode(value);
        case 'AlbumsAddAssetsDto':
          return AlbumsAddAssetsDto.fromJson(value);
        case 'AlbumsAddAssetsResponseDto':
          return AlbumsAddAssetsResponseDto.fromJson(value);
        case 'AlbumsResponse':
          return AlbumsResponse.fromJson(value);
        case 'AlbumsUpdate':
          return AlbumsUpdate.fromJson(value);
        case 'ApiKeyCreateDto':
          return ApiKeyCreateDto.fromJson(value);
        case 'ApiKeyCreateResponseDto':
          return ApiKeyCreateResponseDto.fromJson(value);
        case 'ApiKeyResponseDto':
          return ApiKeyResponseDto.fromJson(value);
        case 'ApiKeyUpdateDto':
          return ApiKeyUpdateDto.fromJson(value);
        case 'AssetBulkDeleteDto':
          return AssetBulkDeleteDto.fromJson(value);
        case 'AssetBulkUpdateDto':
          return AssetBulkUpdateDto.fromJson(value);
        case 'AssetBulkUploadCheckDto':
          return AssetBulkUploadCheckDto.fromJson(value);
        case 'AssetBulkUploadCheckItem':
          return AssetBulkUploadCheckItem.fromJson(value);
        case 'AssetBulkUploadCheckResponseDto':
          return AssetBulkUploadCheckResponseDto.fromJson(value);
        case 'AssetBulkUploadCheckResult':
          return AssetBulkUploadCheckResult.fromJson(value);
        case 'AssetCopyDto':
          return AssetCopyDto.fromJson(value);
        case 'AssetEditAction':
          return AssetEditActionTypeTransformer().decode(value);
        case 'AssetEditActionItemDto':
          return AssetEditActionItemDto.fromJson(value);
        case 'AssetEditActionItemDtoParameters':
          return AssetEditActionItemDtoParameters.fromJson(value);
        case 'AssetEditActionItemResponseDto':
          return AssetEditActionItemResponseDto.fromJson(value);
        case 'AssetEditsCreateDto':
          return AssetEditsCreateDto.fromJson(value);
        case 'AssetEditsResponseDto':
          return AssetEditsResponseDto.fromJson(value);
        case 'AssetFaceCreateDto':
          return AssetFaceCreateDto.fromJson(value);
        case 'AssetFaceDeleteDto':
          return AssetFaceDeleteDto.fromJson(value);
        case 'AssetFaceResponseDto':
          return AssetFaceResponseDto.fromJson(value);
        case 'AssetFaceUpdateDto':
          return AssetFaceUpdateDto.fromJson(value);
        case 'AssetFaceUpdateItem':
          return AssetFaceUpdateItem.fromJson(value);
        case 'AssetIdErrorReason':
          return AssetIdErrorReasonTypeTransformer().decode(value);
        case 'AssetIdsDto':
          return AssetIdsDto.fromJson(value);
        case 'AssetIdsResponseDto':
          return AssetIdsResponseDto.fromJson(value);
        case 'AssetJobName':
          return AssetJobNameTypeTransformer().decode(value);
        case 'AssetJobsDto':
          return AssetJobsDto.fromJson(value);
        case 'AssetMediaResponseDto':
          return AssetMediaResponseDto.fromJson(value);
        case 'AssetMediaSize':
          return AssetMediaSizeTypeTransformer().decode(value);
        case 'AssetMediaStatus':
          return AssetMediaStatusTypeTransformer().decode(value);
        case 'AssetMetadataBulkDeleteDto':
          return AssetMetadataBulkDeleteDto.fromJson(value);
        case 'AssetMetadataBulkDeleteItemDto':
          return AssetMetadataBulkDeleteItemDto.fromJson(value);
        case 'AssetMetadataBulkResponseDto':
          return AssetMetadataBulkResponseDto.fromJson(value);
        case 'AssetMetadataBulkUpsertDto':
          return AssetMetadataBulkUpsertDto.fromJson(value);
        case 'AssetMetadataBulkUpsertItemDto':
          return AssetMetadataBulkUpsertItemDto.fromJson(value);
        case 'AssetMetadataResponseDto':
          return AssetMetadataResponseDto.fromJson(value);
        case 'AssetMetadataUpsertDto':
          return AssetMetadataUpsertDto.fromJson(value);
        case 'AssetMetadataUpsertItemDto':
          return AssetMetadataUpsertItemDto.fromJson(value);
        case 'AssetOcrResponseDto':
          return AssetOcrResponseDto.fromJson(value);
        case 'AssetOrder':
          return AssetOrderTypeTransformer().decode(value);
        case 'AssetOrderBy':
          return AssetOrderByTypeTransformer().decode(value);
        case 'AssetRejectReason':
          return AssetRejectReasonTypeTransformer().decode(value);
        case 'AssetResponseDto':
          return AssetResponseDto.fromJson(value);
        case 'AssetStackResponseDto':
          return AssetStackResponseDto.fromJson(value);
        case 'AssetStatsResponseDto':
          return AssetStatsResponseDto.fromJson(value);
        case 'AssetTypeEnum':
          return AssetTypeEnumTypeTransformer().decode(value);
        case 'AssetUploadAction':
          return AssetUploadActionTypeTransformer().decode(value);
        case 'AssetVisibility':
          return AssetVisibilityTypeTransformer().decode(value);
        case 'AudioCodec':
          return AudioCodecTypeTransformer().decode(value);
        case 'AuthStatusResponseDto':
          return AuthStatusResponseDto.fromJson(value);
        case 'AvatarUpdate':
          return AvatarUpdate.fromJson(value);
        case 'BulkIdErrorReason':
          return BulkIdErrorReasonTypeTransformer().decode(value);
        case 'BulkIdResponseDto':
          return BulkIdResponseDto.fromJson(value);
        case 'BulkIdsDto':
          return BulkIdsDto.fromJson(value);
        case 'CLIPConfig':
          return CLIPConfig.fromJson(value);
        case 'CQMode':
          return CQModeTypeTransformer().decode(value);
        case 'CalendarHeatmapResponseDto':
          return CalendarHeatmapResponseDto.fromJson(value);
        case 'CalendarHeatmapResponseDtoSeriesInner':
          return CalendarHeatmapResponseDtoSeriesInner.fromJson(value);
        case 'CalendarHeatmapType':
          return CalendarHeatmapTypeTypeTransformer().decode(value);
        case 'CastResponse':
          return CastResponse.fromJson(value);
        case 'CastUpdate':
          return CastUpdate.fromJson(value);
        case 'ChangePasswordDto':
          return ChangePasswordDto.fromJson(value);
        case 'ClassificationFaceExclusion':
          return ClassificationFaceExclusionTypeTransformer().decode(value);
        case 'Colorspace':
          return ColorspaceTypeTransformer().decode(value);
        case 'ContributorCountResponseDto':
          return ContributorCountResponseDto.fromJson(value);
        case 'CreateAlbumDto':
          return CreateAlbumDto.fromJson(value);
        case 'CreateLibraryDto':
          return CreateLibraryDto.fromJson(value);
        case 'CreateProfileImageResponseDto':
          return CreateProfileImageResponseDto.fromJson(value);
        case 'CropParameters':
          return CropParameters.fromJson(value);
        case 'DatabaseBackupConfig':
          return DatabaseBackupConfig.fromJson(value);
        case 'DatabaseBackupDeleteDto':
          return DatabaseBackupDeleteDto.fromJson(value);
        case 'DatabaseBackupDto':
          return DatabaseBackupDto.fromJson(value);
        case 'DatabaseBackupListResponseDto':
          return DatabaseBackupListResponseDto.fromJson(value);
        case 'DetachScopedPersonDto':
          return DetachScopedPersonDto.fromJson(value);
        case 'DownloadArchiveDto':
          return DownloadArchiveDto.fromJson(value);
        case 'DownloadArchiveInfo':
          return DownloadArchiveInfo.fromJson(value);
        case 'DownloadInfoDto':
          return DownloadInfoDto.fromJson(value);
        case 'DownloadResponse':
          return DownloadResponse.fromJson(value);
        case 'DownloadResponseDto':
          return DownloadResponseDto.fromJson(value);
        case 'DownloadUpdate':
          return DownloadUpdate.fromJson(value);
        case 'DuplicateDetectionConfig':
          return DuplicateDetectionConfig.fromJson(value);
        case 'DuplicateResolveDto':
          return DuplicateResolveDto.fromJson(value);
        case 'DuplicateResolveGroupDto':
          return DuplicateResolveGroupDto.fromJson(value);
        case 'DuplicateResponseDto':
          return DuplicateResponseDto.fromJson(value);
        case 'EmailNotificationsResponse':
          return EmailNotificationsResponse.fromJson(value);
        case 'EmailNotificationsUpdate':
          return EmailNotificationsUpdate.fromJson(value);
        case 'ExifResponseDto':
          return ExifResponseDto.fromJson(value);
        case 'FaceDto':
          return FaceDto.fromJson(value);
        case 'FaceRepairClusterFacesRequestDto':
          return FaceRepairClusterFacesRequestDto.fromJson(value);
        case 'FaceRepairClusterFacesResponseDto':
          return FaceRepairClusterFacesResponseDto.fromJson(value);
        case 'FaceRepairClusterFacesResponseDtoFacesInner':
          return FaceRepairClusterFacesResponseDtoFacesInner.fromJson(value);
        case 'FaceRepairDeclineCreatedDto':
          return FaceRepairDeclineCreatedDto.fromJson(value);
        case 'FaceRepairDeclineListDto':
          return FaceRepairDeclineListDto.fromJson(value);
        case 'FaceRepairDeclineListDtoDeclinesInner':
          return FaceRepairDeclineListDtoDeclinesInner.fromJson(value);
        case 'FaceRepairDeclineRemoveRequestDto':
          return FaceRepairDeclineRemoveRequestDto.fromJson(value);
        case 'FaceRepairDeclineRemoveRequestDtoFacesInner':
          return FaceRepairDeclineRemoveRequestDtoFacesInner.fromJson(value);
        case 'FaceRepairDeclineRemovedDto':
          return FaceRepairDeclineRemovedDto.fromJson(value);
        case 'FaceRepairDeclineRequestDto':
          return FaceRepairDeclineRequestDto.fromJson(value);
        case 'FaceRepairDeclineRequestDtoPersonsInner':
          return FaceRepairDeclineRequestDtoPersonsInner.fromJson(value);
        case 'FaceRepairOwnerPeopleResponseDto':
          return FaceRepairOwnerPeopleResponseDto.fromJson(value);
        case 'FaceRepairOwnerPeopleResponseDtoPeopleInner':
          return FaceRepairOwnerPeopleResponseDtoPeopleInner.fromJson(value);
        case 'FaceRepairOwnerPersonCreateRequestDto':
          return FaceRepairOwnerPersonCreateRequestDto.fromJson(value);
        case 'FaceRepairOwnerPersonCreatedResponseDto':
          return FaceRepairOwnerPersonCreatedResponseDto.fromJson(value);
        case 'FaceRepairPersonFacesDto':
          return FaceRepairPersonFacesDto.fromJson(value);
        case 'FaceRepairPersonFacesDtoFlaggedFacesInner':
          return FaceRepairPersonFacesDtoFlaggedFacesInner.fromJson(value);
        case 'FaceRepairPersonMetadataResponseDto':
          return FaceRepairPersonMetadataResponseDto.fromJson(value);
        case 'FaceRepairRequestDto':
          return FaceRepairRequestDto.fromJson(value);
        case 'FaceRepairResolutionsListDto':
          return FaceRepairResolutionsListDto.fromJson(value);
        case 'FaceRepairResolutionsListDtoResolutionsInner':
          return FaceRepairResolutionsListDtoResolutionsInner.fromJson(value);
        case 'FaceRepairResolutionsRemoveRequestDto':
          return FaceRepairResolutionsRemoveRequestDto.fromJson(value);
        case 'FaceRepairResolutionsRemovedDto':
          return FaceRepairResolutionsRemovedDto.fromJson(value);
        case 'FaceRepairResolveRequestDto':
          return FaceRepairResolveRequestDto.fromJson(value);
        case 'FaceRepairResolveRequestDtoEntireCluster':
          return FaceRepairResolveRequestDtoEntireCluster.fromJson(value);
        case 'FaceRepairResolveRequestDtoMoveToPersonInner':
          return FaceRepairResolveRequestDtoMoveToPersonInner.fromJson(value);
        case 'FaceRepairResolveResponseDto':
          return FaceRepairResolveResponseDto.fromJson(value);
        case 'FaceRepairResponseDto':
          return FaceRepairResponseDto.fromJson(value);
        case 'FaceRepairResponseDtoExecuted':
          return FaceRepairResponseDtoExecuted.fromJson(value);
        case 'FaceRepairResponseDtoReport':
          return FaceRepairResponseDtoReport.fromJson(value);
        case 'FaceRepairResponseDtoReportPersonsInner':
          return FaceRepairResponseDtoReportPersonsInner.fromJson(value);
        case 'FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner':
          return FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner.fromJson(value);
        case 'FaceRepairResponseDtoReportTotals':
          return FaceRepairResponseDtoReportTotals.fromJson(value);
        case 'FaceRepairResponseDtoReportTotalsReviewOnlyByReason':
          return FaceRepairResponseDtoReportTotalsReviewOnlyByReason.fromJson(value);
        case 'FaceRepairScanDefaultsDto':
          return FaceRepairScanDefaultsDto.fromJson(value);
        case 'FaceRepairScanTriggerRequestDto':
          return FaceRepairScanTriggerRequestDto.fromJson(value);
        case 'FaceRepairScanTriggerRequestDtoParams':
          return FaceRepairScanTriggerRequestDtoParams.fromJson(value);
        case 'FaceRepairScanTriggerResponseDto':
          return FaceRepairScanTriggerResponseDto.fromJson(value);
        case 'FaceRepairUnconfirmRequestDto':
          return FaceRepairUnconfirmRequestDto.fromJson(value);
        case 'FaceSuggestionActionResponseDto':
          return FaceSuggestionActionResponseDto.fromJson(value);
        case 'FaceSuggestionConfig':
          return FaceSuggestionConfig.fromJson(value);
        case 'FacialRecognitionConfig':
          return FacialRecognitionConfig.fromJson(value);
        case 'FilterSuggestionsPersonDto':
          return FilterSuggestionsPersonDto.fromJson(value);
        case 'FilterSuggestionsResponseDto':
          return FilterSuggestionsResponseDto.fromJson(value);
        case 'FilterSuggestionsTagDto':
          return FilterSuggestionsTagDto.fromJson(value);
        case 'FoldersResponse':
          return FoldersResponse.fromJson(value);
        case 'FoldersUpdate':
          return FoldersUpdate.fromJson(value);
        case 'HlsVideoResolution':
          return HlsVideoResolutionTypeTransformer().decode(value);
        case 'ImageFormat':
          return ImageFormatTypeTransformer().decode(value);
        case 'IntegrityReport':
          return IntegrityReportTypeTransformer().decode(value);
        case 'IntegrityReportResponseDto':
          return IntegrityReportResponseDto.fromJson(value);
        case 'IntegrityReportResponseDtoItemsInner':
          return IntegrityReportResponseDtoItemsInner.fromJson(value);
        case 'IntegrityReportSummaryResponseDto':
          return IntegrityReportSummaryResponseDto.fromJson(value);
        case 'JobCreateDto':
          return JobCreateDto.fromJson(value);
        case 'JobName':
          return JobNameTypeTransformer().decode(value);
        case 'JobSettingsDto':
          return JobSettingsDto.fromJson(value);
        case 'LibraryManifestAlbumDto':
          return LibraryManifestAlbumDto.fromJson(value);
        case 'LibraryManifestAssetDto':
          return LibraryManifestAssetDto.fromJson(value);
        case 'LibraryManifestOwnerDto':
          return LibraryManifestOwnerDto.fromJson(value);
        case 'LibraryManifestResponseDto':
          return LibraryManifestResponseDto.fromJson(value);
        case 'LibraryResponseDto':
          return LibraryResponseDto.fromJson(value);
        case 'LibraryStatsResponseDto':
          return LibraryStatsResponseDto.fromJson(value);
        case 'LicenseKeyDto':
          return LicenseKeyDto.fromJson(value);
        case 'LogLevel':
          return LogLevelTypeTransformer().decode(value);
        case 'LoginCredentialDto':
          return LoginCredentialDto.fromJson(value);
        case 'LoginResponseDto':
          return LoginResponseDto.fromJson(value);
        case 'LogoutResponseDto':
          return LogoutResponseDto.fromJson(value);
        case 'MachineLearningAvailabilityChecksDto':
          return MachineLearningAvailabilityChecksDto.fromJson(value);
        case 'MaintenanceAction':
          return MaintenanceActionTypeTransformer().decode(value);
        case 'MaintenanceAuthDto':
          return MaintenanceAuthDto.fromJson(value);
        case 'MaintenanceDetectInstallResponseDto':
          return MaintenanceDetectInstallResponseDto.fromJson(value);
        case 'MaintenanceDetectInstallStorageFolderDto':
          return MaintenanceDetectInstallStorageFolderDto.fromJson(value);
        case 'MaintenanceLoginDto':
          return MaintenanceLoginDto.fromJson(value);
        case 'MaintenanceStatusResponseDto':
          return MaintenanceStatusResponseDto.fromJson(value);
        case 'ManualJobName':
          return ManualJobNameTypeTransformer().decode(value);
        case 'MapMarkerResponseDto':
          return MapMarkerResponseDto.fromJson(value);
        case 'MapMediaType':
          return MapMediaTypeTypeTransformer().decode(value);
        case 'MapReverseGeocodeResponseDto':
          return MapReverseGeocodeResponseDto.fromJson(value);
        case 'MemoriesResponse':
          return MemoriesResponse.fromJson(value);
        case 'MemoriesUpdate':
          return MemoriesUpdate.fromJson(value);
        case 'MemoryCreateDto':
          return MemoryCreateDto.fromJson(value);
        case 'MemoryResponseDto':
          return MemoryResponseDto.fromJson(value);
        case 'MemorySearchOrder':
          return MemorySearchOrderTypeTransformer().decode(value);
        case 'MemoryStatisticsResponseDto':
          return MemoryStatisticsResponseDto.fromJson(value);
        case 'MemoryType':
          return MemoryTypeTypeTransformer().decode(value);
        case 'MemoryUpdateDto':
          return MemoryUpdateDto.fromJson(value);
        case 'MergePersonDto':
          return MergePersonDto.fromJson(value);
        case 'MergeScopedPeopleDto':
          return MergeScopedPeopleDto.fromJson(value);
        case 'MetadataSearchDto':
          return MetadataSearchDto.fromJson(value);
        case 'MirrorAxis':
          return MirrorAxisTypeTransformer().decode(value);
        case 'MirrorParameters':
          return MirrorParameters.fromJson(value);
        case 'NotificationCreateDto':
          return NotificationCreateDto.fromJson(value);
        case 'NotificationDeleteAllDto':
          return NotificationDeleteAllDto.fromJson(value);
        case 'NotificationDto':
          return NotificationDto.fromJson(value);
        case 'NotificationLevel':
          return NotificationLevelTypeTransformer().decode(value);
        case 'NotificationType':
          return NotificationTypeTypeTransformer().decode(value);
        case 'NotificationUpdateAllDto':
          return NotificationUpdateAllDto.fromJson(value);
        case 'NotificationUpdateDto':
          return NotificationUpdateDto.fromJson(value);
        case 'OAuthAuthorizeResponseDto':
          return OAuthAuthorizeResponseDto.fromJson(value);
        case 'OAuthCallbackDto':
          return OAuthCallbackDto.fromJson(value);
        case 'OAuthConfigDto':
          return OAuthConfigDto.fromJson(value);
        case 'OAuthTokenEndpointAuthMethod':
          return OAuthTokenEndpointAuthMethodTypeTransformer().decode(value);
        case 'OcrConfig':
          return OcrConfig.fromJson(value);
        case 'OnboardingDto':
          return OnboardingDto.fromJson(value);
        case 'OnboardingResponseDto':
          return OnboardingResponseDto.fromJson(value);
        case 'PartnerCreateDto':
          return PartnerCreateDto.fromJson(value);
        case 'PartnerDirection':
          return PartnerDirectionTypeTransformer().decode(value);
        case 'PartnerResponseDto':
          return PartnerResponseDto.fromJson(value);
        case 'PartnerUpdateDto':
          return PartnerUpdateDto.fromJson(value);
        case 'PeopleFaceStatisticsResponseDto':
          return PeopleFaceStatisticsResponseDto.fromJson(value);
        case 'PeopleResponse':
          return PeopleResponse.fromJson(value);
        case 'PeopleResponseDto':
          return PeopleResponseDto.fromJson(value);
        case 'PeopleStatisticsResponseDto':
          return PeopleStatisticsResponseDto.fromJson(value);
        case 'PeopleUpdate':
          return PeopleUpdate.fromJson(value);
        case 'PeopleUpdateDto':
          return PeopleUpdateDto.fromJson(value);
        case 'PeopleUpdateItem':
          return PeopleUpdateItem.fromJson(value);
        case 'Permission':
          return PermissionTypeTransformer().decode(value);
        case 'PersonCreateDto':
          return PersonCreateDto.fromJson(value);
        case 'PersonFacePageResponseDto':
          return PersonFacePageResponseDto.fromJson(value);
        case 'PersonFaceResponseDto':
          return PersonFaceResponseDto.fromJson(value);
        case 'PersonFaceSuggestionPageResponseDto':
          return PersonFaceSuggestionPageResponseDto.fromJson(value);
        case 'PersonFaceSuggestionResponseDto':
          return PersonFaceSuggestionResponseDto.fromJson(value);
        case 'PersonResponseDto':
          return PersonResponseDto.fromJson(value);
        case 'PersonStatisticsResponseDto':
          return PersonStatisticsResponseDto.fromJson(value);
        case 'PersonUpdateDto':
          return PersonUpdateDto.fromJson(value);
        case 'PetDetectionConfig':
          return PetDetectionConfig.fromJson(value);
        case 'PinCodeChangeDto':
          return PinCodeChangeDto.fromJson(value);
        case 'PinCodeResetDto':
          return PinCodeResetDto.fromJson(value);
        case 'PinCodeSetupDto':
          return PinCodeSetupDto.fromJson(value);
        case 'PlacesResponseDto':
          return PlacesResponseDto.fromJson(value);
        case 'PluginMethodResponseDto':
          return PluginMethodResponseDto.fromJson(value);
        case 'PluginResponseDto':
          return PluginResponseDto.fromJson(value);
        case 'PluginTemplateResponseDto':
          return PluginTemplateResponseDto.fromJson(value);
        case 'PluginTemplateStepResponseDto':
          return PluginTemplateStepResponseDto.fromJson(value);
        case 'PurchaseResponse':
          return PurchaseResponse.fromJson(value);
        case 'PurchaseUpdate':
          return PurchaseUpdate.fromJson(value);
        case 'QueueCommand':
          return QueueCommandTypeTransformer().decode(value);
        case 'QueueCommandDto':
          return QueueCommandDto.fromJson(value);
        case 'QueueDeleteDto':
          return QueueDeleteDto.fromJson(value);
        case 'QueueJobResponseDto':
          return QueueJobResponseDto.fromJson(value);
        case 'QueueJobStatus':
          return QueueJobStatusTypeTransformer().decode(value);
        case 'QueueJobTypeCountsDto':
          return QueueJobTypeCountsDto.fromJson(value);
        case 'QueueName':
          return QueueNameTypeTransformer().decode(value);
        case 'QueueResponseDto':
          return QueueResponseDto.fromJson(value);
        case 'QueueResponseLegacyDto':
          return QueueResponseLegacyDto.fromJson(value);
        case 'QueueStatisticsDto':
          return QueueStatisticsDto.fromJson(value);
        case 'QueueStatusLegacyDto':
          return QueueStatusLegacyDto.fromJson(value);
        case 'QueueUpdateDto':
          return QueueUpdateDto.fromJson(value);
        case 'QueuesResponseLegacyDto':
          return QueuesResponseLegacyDto.fromJson(value);
        case 'RandomSearchDto':
          return RandomSearchDto.fromJson(value);
        case 'RatingsResponse':
          return RatingsResponse.fromJson(value);
        case 'RatingsUpdate':
          return RatingsUpdate.fromJson(value);
        case 'ReactionLevel':
          return ReactionLevelTypeTransformer().decode(value);
        case 'ReactionType':
          return ReactionTypeTypeTransformer().decode(value);
        case 'RecentlyAddedResponse':
          return RecentlyAddedResponse.fromJson(value);
        case 'RecentlyAddedUpdate':
          return RecentlyAddedUpdate.fromJson(value);
        case 'ReleaseChannel':
          return ReleaseChannelTypeTransformer().decode(value);
        case 'ReleaseEventV1':
          return ReleaseEventV1.fromJson(value);
        case 'ReleaseType':
          return ReleaseTypeTypeTransformer().decode(value);
        case 'RepresentativeFaceUpdateDto':
          return RepresentativeFaceUpdateDto.fromJson(value);
        case 'ReverseGeocodingStateResponseDto':
          return ReverseGeocodingStateResponseDto.fromJson(value);
        case 'RotateParameters':
          return RotateParameters.fromJson(value);
        case 'ScopedPersonProfileRefDto':
          return ScopedPersonProfileRefDto.fromJson(value);
        case 'ScopedPrimaryProfile':
          return ScopedPrimaryProfile.fromJson(value);
        case 'SearchAlbumResponseDto':
          return SearchAlbumResponseDto.fromJson(value);
        case 'SearchAssetResponseDto':
          return SearchAssetResponseDto.fromJson(value);
        case 'SearchExploreItem':
          return SearchExploreItem.fromJson(value);
        case 'SearchExploreResponseDto':
          return SearchExploreResponseDto.fromJson(value);
        case 'SearchFacetCountResponseDto':
          return SearchFacetCountResponseDto.fromJson(value);
        case 'SearchFacetResponseDto':
          return SearchFacetResponseDto.fromJson(value);
        case 'SearchResponseDto':
          return SearchResponseDto.fromJson(value);
        case 'SearchStatisticsResponseDto':
          return SearchStatisticsResponseDto.fromJson(value);
        case 'SearchSuggestionType':
          return SearchSuggestionTypeTypeTransformer().decode(value);
        case 'ServerAboutResponseDto':
          return ServerAboutResponseDto.fromJson(value);
        case 'ServerApkLinksDto':
          return ServerApkLinksDto.fromJson(value);
        case 'ServerConfigDto':
          return ServerConfigDto.fromJson(value);
        case 'ServerFeaturesDto':
          return ServerFeaturesDto.fromJson(value);
        case 'ServerMediaTypesResponseDto':
          return ServerMediaTypesResponseDto.fromJson(value);
        case 'ServerMlHealthResponseDto':
          return ServerMlHealthResponseDto.fromJson(value);
        case 'ServerPingResponse':
          return ServerPingResponse.fromJson(value);
        case 'ServerStatsResponseDto':
          return ServerStatsResponseDto.fromJson(value);
        case 'ServerStorageResponseDto':
          return ServerStorageResponseDto.fromJson(value);
        case 'ServerVersionHistoryResponseDto':
          return ServerVersionHistoryResponseDto.fromJson(value);
        case 'ServerVersionResponseDto':
          return ServerVersionResponseDto.fromJson(value);
        case 'SessionCreateDto':
          return SessionCreateDto.fromJson(value);
        case 'SessionCreateResponseDto':
          return SessionCreateResponseDto.fromJson(value);
        case 'SessionResponseDto':
          return SessionResponseDto.fromJson(value);
        case 'SessionUnlockDto':
          return SessionUnlockDto.fromJson(value);
        case 'SessionUpdateDto':
          return SessionUpdateDto.fromJson(value);
        case 'SetMaintenanceModeDto':
          return SetMaintenanceModeDto.fromJson(value);
        case 'SharedLinkCreateDto':
          return SharedLinkCreateDto.fromJson(value);
        case 'SharedLinkEditDto':
          return SharedLinkEditDto.fromJson(value);
        case 'SharedLinkLoginDto':
          return SharedLinkLoginDto.fromJson(value);
        case 'SharedLinkResponseDto':
          return SharedLinkResponseDto.fromJson(value);
        case 'SharedLinkType':
          return SharedLinkTypeTypeTransformer().decode(value);
        case 'SharedLinksResponse':
          return SharedLinksResponse.fromJson(value);
        case 'SharedLinksUpdate':
          return SharedLinksUpdate.fromJson(value);
        case 'SharedSpaceActivityResponseDto':
          return SharedSpaceActivityResponseDto.fromJson(value);
        case 'SharedSpaceAlbumLinkUpdateDto':
          return SharedSpaceAlbumLinkUpdateDto.fromJson(value);
        case 'SharedSpaceAssetAddDto':
          return SharedSpaceAssetAddDto.fromJson(value);
        case 'SharedSpaceAssetLinkedAlbumDto':
          return SharedSpaceAssetLinkedAlbumDto.fromJson(value);
        case 'SharedSpaceAssetRemoveDto':
          return SharedSpaceAssetRemoveDto.fromJson(value);
        case 'SharedSpaceCreateDto':
          return SharedSpaceCreateDto.fromJson(value);
        case 'SharedSpaceLibraryLinkDto':
          return SharedSpaceLibraryLinkDto.fromJson(value);
        case 'SharedSpaceLinkedAlbumDto':
          return SharedSpaceLinkedAlbumDto.fromJson(value);
        case 'SharedSpaceLinkedLibraryDto':
          return SharedSpaceLinkedLibraryDto.fromJson(value);
        case 'SharedSpaceMemberCreateDto':
          return SharedSpaceMemberCreateDto.fromJson(value);
        case 'SharedSpaceMemberMetadataContributionDto':
          return SharedSpaceMemberMetadataContributionDto.fromJson(value);
        case 'SharedSpaceMemberPreferencesDto':
          return SharedSpaceMemberPreferencesDto.fromJson(value);
        case 'SharedSpaceMemberResponseDto':
          return SharedSpaceMemberResponseDto.fromJson(value);
        case 'SharedSpaceMemberTimelineDto':
          return SharedSpaceMemberTimelineDto.fromJson(value);
        case 'SharedSpaceMemberUpdateDto':
          return SharedSpaceMemberUpdateDto.fromJson(value);
        case 'SharedSpacePeopleStatisticsResponseDto':
          return SharedSpacePeopleStatisticsResponseDto.fromJson(value);
        case 'SharedSpacePersonAliasDto':
          return SharedSpacePersonAliasDto.fromJson(value);
        case 'SharedSpacePersonMergeDto':
          return SharedSpacePersonMergeDto.fromJson(value);
        case 'SharedSpacePersonResponseDto':
          return SharedSpacePersonResponseDto.fromJson(value);
        case 'SharedSpacePersonUpdateDto':
          return SharedSpacePersonUpdateDto.fromJson(value);
        case 'SharedSpaceResponseDto':
          return SharedSpaceResponseDto.fromJson(value);
        case 'SharedSpaceResponseDtoLastContributor':
          return SharedSpaceResponseDtoLastContributor.fromJson(value);
        case 'SharedSpaceRole':
          return SharedSpaceRoleTypeTransformer().decode(value);
        case 'SharedSpaceUpdateDto':
          return SharedSpaceUpdateDto.fromJson(value);
        case 'SignUpDto':
          return SignUpDto.fromJson(value);
        case 'SmartSearchDto':
          return SmartSearchDto.fromJson(value);
        case 'SmartSearchFacetsDto':
          return SmartSearchFacetsDto.fromJson(value);
        case 'SmartSearchFacetsResponseDto':
          return SmartSearchFacetsResponseDto.fromJson(value);
        case 'SourceType':
          return SourceTypeTypeTransformer().decode(value);
        case 'SpaceRepresentativeFaceUpdateDto':
          return SpaceRepresentativeFaceUpdateDto.fromJson(value);
        case 'StackCreateDto':
          return StackCreateDto.fromJson(value);
        case 'StackResponseDto':
          return StackResponseDto.fromJson(value);
        case 'StackUpdateDto':
          return StackUpdateDto.fromJson(value);
        case 'StatisticsSearchDto':
          return StatisticsSearchDto.fromJson(value);
        case 'StorageFolder':
          return StorageFolderTypeTransformer().decode(value);
        case 'StorageMigrationDirection':
          return StorageMigrationDirectionTypeTransformer().decode(value);
        case 'StorageMigrationFileTypesDto':
          return StorageMigrationFileTypesDto.fromJson(value);
        case 'StorageMigrationStartDto':
          return StorageMigrationStartDto.fromJson(value);
        case 'SyncAckDeleteDto':
          return SyncAckDeleteDto.fromJson(value);
        case 'SyncAckDto':
          return SyncAckDto.fromJson(value);
        case 'SyncAckSetDto':
          return SyncAckSetDto.fromJson(value);
        case 'SyncAlbumDeleteV1':
          return SyncAlbumDeleteV1.fromJson(value);
        case 'SyncAlbumToAssetDeleteV1':
          return SyncAlbumToAssetDeleteV1.fromJson(value);
        case 'SyncAlbumToAssetV1':
          return SyncAlbumToAssetV1.fromJson(value);
        case 'SyncAlbumUserDeleteV1':
          return SyncAlbumUserDeleteV1.fromJson(value);
        case 'SyncAlbumUserV1':
          return SyncAlbumUserV1.fromJson(value);
        case 'SyncAlbumV1':
          return SyncAlbumV1.fromJson(value);
        case 'SyncAlbumV2':
          return SyncAlbumV2.fromJson(value);
        case 'SyncAssetDeleteV1':
          return SyncAssetDeleteV1.fromJson(value);
        case 'SyncAssetEditDeleteV1':
          return SyncAssetEditDeleteV1.fromJson(value);
        case 'SyncAssetEditV1':
          return SyncAssetEditV1.fromJson(value);
        case 'SyncAssetExifV1':
          return SyncAssetExifV1.fromJson(value);
        case 'SyncAssetFaceDeleteV1':
          return SyncAssetFaceDeleteV1.fromJson(value);
        case 'SyncAssetFaceV1':
          return SyncAssetFaceV1.fromJson(value);
        case 'SyncAssetFaceV2':
          return SyncAssetFaceV2.fromJson(value);
        case 'SyncAssetMetadataDeleteV1':
          return SyncAssetMetadataDeleteV1.fromJson(value);
        case 'SyncAssetMetadataV1':
          return SyncAssetMetadataV1.fromJson(value);
        case 'SyncAssetOcrDeleteV1':
          return SyncAssetOcrDeleteV1.fromJson(value);
        case 'SyncAssetOcrV1':
          return SyncAssetOcrV1.fromJson(value);
        case 'SyncAssetV1':
          return SyncAssetV1.fromJson(value);
        case 'SyncAssetV2':
          return SyncAssetV2.fromJson(value);
        case 'SyncAuthUserV1':
          return SyncAuthUserV1.fromJson(value);
        case 'SyncEntityType':
          return SyncEntityTypeTypeTransformer().decode(value);
        case 'SyncLibraryAssetDeleteV1':
          return SyncLibraryAssetDeleteV1.fromJson(value);
        case 'SyncLibraryDeleteV1':
          return SyncLibraryDeleteV1.fromJson(value);
        case 'SyncLibraryV1':
          return SyncLibraryV1.fromJson(value);
        case 'SyncMemoryAssetDeleteV1':
          return SyncMemoryAssetDeleteV1.fromJson(value);
        case 'SyncMemoryAssetV1':
          return SyncMemoryAssetV1.fromJson(value);
        case 'SyncMemoryDeleteV1':
          return SyncMemoryDeleteV1.fromJson(value);
        case 'SyncMemoryV1':
          return SyncMemoryV1.fromJson(value);
        case 'SyncPartnerDeleteV1':
          return SyncPartnerDeleteV1.fromJson(value);
        case 'SyncPartnerV1':
          return SyncPartnerV1.fromJson(value);
        case 'SyncPersonDeleteV1':
          return SyncPersonDeleteV1.fromJson(value);
        case 'SyncPersonV1':
          return SyncPersonV1.fromJson(value);
        case 'SyncRequestType':
          return SyncRequestTypeTypeTransformer().decode(value);
        case 'SyncSharedSpaceAlbumLinkDeleteV1':
          return SyncSharedSpaceAlbumLinkDeleteV1.fromJson(value);
        case 'SyncSharedSpaceAlbumLinkV1':
          return SyncSharedSpaceAlbumLinkV1.fromJson(value);
        case 'SyncSharedSpaceDeleteV1':
          return SyncSharedSpaceDeleteV1.fromJson(value);
        case 'SyncSharedSpaceLibraryDeleteV1':
          return SyncSharedSpaceLibraryDeleteV1.fromJson(value);
        case 'SyncSharedSpaceLibraryV1':
          return SyncSharedSpaceLibraryV1.fromJson(value);
        case 'SyncSharedSpaceMemberDeleteV1':
          return SyncSharedSpaceMemberDeleteV1.fromJson(value);
        case 'SyncSharedSpaceMemberV1':
          return SyncSharedSpaceMemberV1.fromJson(value);
        case 'SyncSharedSpaceToAssetDeleteV1':
          return SyncSharedSpaceToAssetDeleteV1.fromJson(value);
        case 'SyncSharedSpaceToAssetV1':
          return SyncSharedSpaceToAssetV1.fromJson(value);
        case 'SyncSharedSpaceV1':
          return SyncSharedSpaceV1.fromJson(value);
        case 'SyncStackDeleteV1':
          return SyncStackDeleteV1.fromJson(value);
        case 'SyncStackV1':
          return SyncStackV1.fromJson(value);
        case 'SyncStreamDto':
          return SyncStreamDto.fromJson(value);
        case 'SyncUserDeleteV1':
          return SyncUserDeleteV1.fromJson(value);
        case 'SyncUserMetadataDeleteV1':
          return SyncUserMetadataDeleteV1.fromJson(value);
        case 'SyncUserMetadataV1':
          return SyncUserMetadataV1.fromJson(value);
        case 'SyncUserV1':
          return SyncUserV1.fromJson(value);
        case 'SystemConfigBackupsDto':
          return SystemConfigBackupsDto.fromJson(value);
        case 'SystemConfigClassificationCategoryDto':
          return SystemConfigClassificationCategoryDto.fromJson(value);
        case 'SystemConfigClassificationDto':
          return SystemConfigClassificationDto.fromJson(value);
        case 'SystemConfigDto':
          return SystemConfigDto.fromJson(value);
        case 'SystemConfigFFmpegDto':
          return SystemConfigFFmpegDto.fromJson(value);
        case 'SystemConfigFFmpegRealtimeDto':
          return SystemConfigFFmpegRealtimeDto.fromJson(value);
        case 'SystemConfigFacesDto':
          return SystemConfigFacesDto.fromJson(value);
        case 'SystemConfigGeneratedFullsizeImageDto':
          return SystemConfigGeneratedFullsizeImageDto.fromJson(value);
        case 'SystemConfigGeneratedImageDto':
          return SystemConfigGeneratedImageDto.fromJson(value);
        case 'SystemConfigImageDto':
          return SystemConfigImageDto.fromJson(value);
        case 'SystemConfigIntegrityChecks':
          return SystemConfigIntegrityChecks.fromJson(value);
        case 'SystemConfigIntegrityChecksumJob':
          return SystemConfigIntegrityChecksumJob.fromJson(value);
        case 'SystemConfigIntegrityJob':
          return SystemConfigIntegrityJob.fromJson(value);
        case 'SystemConfigJobDto':
          return SystemConfigJobDto.fromJson(value);
        case 'SystemConfigLibraryDto':
          return SystemConfigLibraryDto.fromJson(value);
        case 'SystemConfigLibraryScanDto':
          return SystemConfigLibraryScanDto.fromJson(value);
        case 'SystemConfigLibraryWatchDto':
          return SystemConfigLibraryWatchDto.fromJson(value);
        case 'SystemConfigLoggingDto':
          return SystemConfigLoggingDto.fromJson(value);
        case 'SystemConfigMachineLearningDto':
          return SystemConfigMachineLearningDto.fromJson(value);
        case 'SystemConfigMapDto':
          return SystemConfigMapDto.fromJson(value);
        case 'SystemConfigMemoriesDto':
          return SystemConfigMemoriesDto.fromJson(value);
        case 'SystemConfigMetadataDto':
          return SystemConfigMetadataDto.fromJson(value);
        case 'SystemConfigNewVersionCheckDto':
          return SystemConfigNewVersionCheckDto.fromJson(value);
        case 'SystemConfigNightlyTasksDto':
          return SystemConfigNightlyTasksDto.fromJson(value);
        case 'SystemConfigNotificationsDto':
          return SystemConfigNotificationsDto.fromJson(value);
        case 'SystemConfigOAuthDto':
          return SystemConfigOAuthDto.fromJson(value);
        case 'SystemConfigPasswordLoginDto':
          return SystemConfigPasswordLoginDto.fromJson(value);
        case 'SystemConfigReverseGeocodingDto':
          return SystemConfigReverseGeocodingDto.fromJson(value);
        case 'SystemConfigServerDto':
          return SystemConfigServerDto.fromJson(value);
        case 'SystemConfigSmtpDto':
          return SystemConfigSmtpDto.fromJson(value);
        case 'SystemConfigSmtpTransportDto':
          return SystemConfigSmtpTransportDto.fromJson(value);
        case 'SystemConfigStorageTemplateDto':
          return SystemConfigStorageTemplateDto.fromJson(value);
        case 'SystemConfigStorageUsageDto':
          return SystemConfigStorageUsageDto.fromJson(value);
        case 'SystemConfigTemplateEmailsDto':
          return SystemConfigTemplateEmailsDto.fromJson(value);
        case 'SystemConfigTemplateStorageOptionDto':
          return SystemConfigTemplateStorageOptionDto.fromJson(value);
        case 'SystemConfigTemplatesDto':
          return SystemConfigTemplatesDto.fromJson(value);
        case 'SystemConfigThemeDto':
          return SystemConfigThemeDto.fromJson(value);
        case 'SystemConfigTrashDto':
          return SystemConfigTrashDto.fromJson(value);
        case 'SystemConfigUserDto':
          return SystemConfigUserDto.fromJson(value);
        case 'TagBulkAssetsDto':
          return TagBulkAssetsDto.fromJson(value);
        case 'TagBulkAssetsResponseDto':
          return TagBulkAssetsResponseDto.fromJson(value);
        case 'TagCreateDto':
          return TagCreateDto.fromJson(value);
        case 'TagResponseDto':
          return TagResponseDto.fromJson(value);
        case 'TagSuggestionResponseDto':
          return TagSuggestionResponseDto.fromJson(value);
        case 'TagUpdateDto':
          return TagUpdateDto.fromJson(value);
        case 'TagUpsertDto':
          return TagUpsertDto.fromJson(value);
        case 'TagsResponse':
          return TagsResponse.fromJson(value);
        case 'TagsUpdate':
          return TagsUpdate.fromJson(value);
        case 'TemplateDto':
          return TemplateDto.fromJson(value);
        case 'TemplateResponseDto':
          return TemplateResponseDto.fromJson(value);
        case 'TestEmailResponseDto':
          return TestEmailResponseDto.fromJson(value);
        case 'TimeBucketAssetResponseDto':
          return TimeBucketAssetResponseDto.fromJson(value);
        case 'TimeBucketCoverResponseDto':
          return TimeBucketCoverResponseDto.fromJson(value);
        case 'TimeBucketSize':
          return TimeBucketSizeTypeTransformer().decode(value);
        case 'TimeBucketsResponseDto':
          return TimeBucketsResponseDto.fromJson(value);
        case 'TonalLevel':
          return TonalLevelTypeTransformer().decode(value);
        case 'ToneMapping':
          return ToneMappingTypeTransformer().decode(value);
        case 'TranscodeHWAccel':
          return TranscodeHWAccelTypeTransformer().decode(value);
        case 'TranscodePolicy':
          return TranscodePolicyTypeTransformer().decode(value);
        case 'TrashResponseDto':
          return TrashResponseDto.fromJson(value);
        case 'TrimParameters':
          return TrimParameters.fromJson(value);
        case 'UpdateAlbumDto':
          return UpdateAlbumDto.fromJson(value);
        case 'UpdateAlbumUserDto':
          return UpdateAlbumUserDto.fromJson(value);
        case 'UpdateAssetDto':
          return UpdateAssetDto.fromJson(value);
        case 'UpdateLibraryDto':
          return UpdateLibraryDto.fromJson(value);
        case 'UsageByUserDto':
          return UsageByUserDto.fromJson(value);
        case 'UserAdminCreateDto':
          return UserAdminCreateDto.fromJson(value);
        case 'UserAdminDeleteDto':
          return UserAdminDeleteDto.fromJson(value);
        case 'UserAdminResponseDto':
          return UserAdminResponseDto.fromJson(value);
        case 'UserAdminUpdateDto':
          return UserAdminUpdateDto.fromJson(value);
        case 'UserAvatarColor':
          return UserAvatarColorTypeTransformer().decode(value);
        case 'UserGroupCreateDto':
          return UserGroupCreateDto.fromJson(value);
        case 'UserGroupMemberResponseDto':
          return UserGroupMemberResponseDto.fromJson(value);
        case 'UserGroupMemberSetDto':
          return UserGroupMemberSetDto.fromJson(value);
        case 'UserGroupResponseDto':
          return UserGroupResponseDto.fromJson(value);
        case 'UserGroupUpdateDto':
          return UserGroupUpdateDto.fromJson(value);
        case 'UserLicense':
          return UserLicense.fromJson(value);
        case 'UserMetadataKey':
          return UserMetadataKeyTypeTransformer().decode(value);
        case 'UserPreferencesResponseDto':
          return UserPreferencesResponseDto.fromJson(value);
        case 'UserPreferencesUpdateDto':
          return UserPreferencesUpdateDto.fromJson(value);
        case 'UserResponseDto':
          return UserResponseDto.fromJson(value);
        case 'UserStatus':
          return UserStatusTypeTransformer().decode(value);
        case 'UserUpdateMeDto':
          return UserUpdateMeDto.fromJson(value);
        case 'ValidateAccessTokenResponseDto':
          return ValidateAccessTokenResponseDto.fromJson(value);
        case 'ValidateLibraryDto':
          return ValidateLibraryDto.fromJson(value);
        case 'ValidateLibraryImportPathResponseDto':
          return ValidateLibraryImportPathResponseDto.fromJson(value);
        case 'ValidateLibraryResponseDto':
          return ValidateLibraryResponseDto.fromJson(value);
        case 'VersionCheckStateResponseDto':
          return VersionCheckStateResponseDto.fromJson(value);
        case 'VideoCodec':
          return VideoCodecTypeTransformer().decode(value);
        case 'VideoContainer':
          return VideoContainerTypeTransformer().decode(value);
        case 'WorkflowCreateDto':
          return WorkflowCreateDto.fromJson(value);
        case 'WorkflowResponseDto':
          return WorkflowResponseDto.fromJson(value);
        case 'WorkflowShareResponseDto':
          return WorkflowShareResponseDto.fromJson(value);
        case 'WorkflowShareStepDto':
          return WorkflowShareStepDto.fromJson(value);
        case 'WorkflowStepDto':
          return WorkflowStepDto.fromJson(value);
        case 'WorkflowTrigger':
          return WorkflowTriggerTypeTransformer().decode(value);
        case 'WorkflowTriggerResponseDto':
          return WorkflowTriggerResponseDto.fromJson(value);
        case 'WorkflowType':
          return WorkflowTypeTypeTransformer().decode(value);
        case 'WorkflowUpdateDto':
          return WorkflowUpdateDto.fromJson(value);
        default:
          dynamic match;
          if (value is List && (match = _regList.firstMatch(targetType)?.group(1)) != null) {
            return value
              .map<dynamic>((dynamic v) => fromJson(v, match, growable: growable,))
              .toList(growable: growable);
          }
          if (value is Set && (match = _regSet.firstMatch(targetType)?.group(1)) != null) {
            return value
              .map<dynamic>((dynamic v) => fromJson(v, match, growable: growable,))
              .toSet();
          }
          if (value is Map && (match = _regMap.firstMatch(targetType)?.group(1)) != null) {
            return Map<String, dynamic>.fromIterables(
              value.keys.cast<String>(),
              value.values.map<dynamic>((dynamic v) => fromJson(v, match, growable: growable,)),
            );
          }
      }
    } on Exception catch (error, trace) {
      throw ApiException.withInner(HttpStatus.internalServerError, 'Exception during deserialization.', error, trace,);
    }
    throw ApiException(HttpStatus.internalServerError, 'Could not find a suitable class for deserialization',);
  }
}

/// Primarily intended for use in an isolate.
class DeserializationMessage {
  const DeserializationMessage({
    required this.json,
    required this.targetType,
    this.growable = false,
  });

  /// The JSON value to deserialize.
  final String json;

  /// Target type to deserialize to.
  final String targetType;

  /// Whether to make deserialized lists or maps growable.
  final bool growable;
}

/// Primarily intended for use in an isolate.
Future<dynamic> decodeAsync(DeserializationMessage message) async {
  // Remove all spaces. Necessary for regular expressions as well.
  final targetType = message.targetType.replaceAll(' ', '');

  // If the expected target type is String, nothing to do...
  return targetType == 'String'
    ? message.json
    : json.decode(message.json);
}

/// Primarily intended for use in an isolate.
Future<dynamic> deserializeAsync(DeserializationMessage message) async {
  // Remove all spaces. Necessary for regular expressions as well.
  final targetType = message.targetType.replaceAll(' ', '');

  // If the expected target type is String, nothing to do...
  return targetType == 'String'
    ? message.json
    : ApiClient.fromJson(
        json.decode(message.json),
        targetType,
        growable: message.growable,
      );
}

/// Primarily intended for use in an isolate.
Future<String> serializeAsync(Object? value) async => value == null ? '' : json.encode(value);

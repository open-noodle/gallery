import { Injectable } from '@nestjs/common';
import { AgentOperationTargetKind, AgentOperationType, AgentToolName, UserAvatarColor } from 'src/enum';
import type {
  AgentMcpApprovalRetryContract,
  AgentMcpArgumentMode,
  AgentMcpCommonMistake,
  AgentMcpFailureMatrixCase,
  AgentMcpPlanningToolContract,
  AgentMcpPlanningToolName,
  AgentMcpReadToolContract,
  AgentMcpReadToolName,
  AgentMcpToolContract,
  AgentMcpToolExample,
  AgentMcpToolSafetyContract,
  AgentMcpValidationCorrection,
  AgentMcpValidationCorrectionRequest,
  AgentMcpValidationIssue,
} from 'src/types/agent-mcp-contract.types';

const exampleAssetId = '00000000-0000-4000-8000-000000000001';
const exampleAlbumId = '00000000-0000-4000-8000-000000000010';
const exampleSpaceId = '00000000-0000-4000-8000-000000000020';
const exampleSpacePersonId = '00000000-0000-4000-8000-000000000021';
const exampleTagId = '00000000-0000-4000-8000-000000000030';
const exampleToolCallId = '00000000-0000-4000-8000-000000000111';
const examplePlanId = '00000000-0000-4000-8000-000000000222';
const exampleSelectionHandleId = '00000000-0000-4000-8000-000000000333';

const validationCorrectionTextMaxLength = 500;

const safety: AgentMcpToolSafetyContract = {
  allowsDirectMutation: false,
  exposesSecrets: false,
  requiresGalleryApplyForWrites: true,
};

const approvalRetry: AgentMcpApprovalRetryContract = {
  field: 'toolCallId',
  instruction: 'After approval, retry with only toolCallId.',
};

const approvedRetryMode: AgentMcpArgumentMode = {
  name: 'approved-retry',
  description: 'Retry a read request that Gallery already approved.',
  requiredFields: ['toolCallId'],
  forbiddenFields: ['assetIds', 'albumId', 'spaceId', 'filters', 'limit', 'detail', 'fields'],
  whenToUse: 'Use only after Gallery resumes the assistant from an approved tool request.',
};

const approvedRetryExample: AgentMcpToolExample = {
  name: 'approved-retry',
  description: 'Retry an approved read request by id.',
  arguments: { toolCallId: exampleToolCallId },
};

const selectionMetadataApprovedRetryMode: AgentMcpArgumentMode = {
  ...approvedRetryMode,
  forbiddenFields: ['selectionHandleId', 'fields', 'sampleSize'],
};

const searchApprovedRetryMode: AgentMcpArgumentMode = {
  name: 'approved-retry',
  description: 'Retry a search request that Gallery already approved.',
  requiredFields: ['toolCallId'],
  forbiddenFields: ['mode', 'query', 'filters', 'limit', 'page', 'order', 'detail', 'fields', 'sampleSize'],
  whenToUse: 'Use only after Gallery resumes the assistant from an approved search request.',
};

const tripCandidateLookupMode: AgentMcpArgumentMode = {
  name: 'trip-candidate-lookup',
  description: 'Find likely recent trip candidates and album-ready selection handles.',
  requiredFields: [],
  forbiddenFields: ['toolCallId'],
  whenToUse: 'Use before planning trip albums or trip highlight albums, with placeHint when the user names a place.',
};

const tripCandidateApprovedRetryMode: AgentMcpArgumentMode = {
  ...approvedRetryMode,
  forbiddenFields: ['placeHint', 'targetDate', 'lookbackDays', 'maxCandidates'],
};

const assetIdsMode: AgentMcpArgumentMode = {
  name: 'asset-ids',
  description: 'Start a new asset read request for selected assets.',
  requiredFields: ['assetIds'],
  forbiddenFields: ['toolCallId'],
  whenToUse: 'Use when the assistant already has concrete asset ids from search or album reads.',
};

const assetIdsExample: AgentMcpToolExample = {
  name: 'read-selected-assets',
  description: 'Read selected assets by id.',
  arguments: { assetIds: [exampleAssetId] },
};

const metadataDetailMode: AgentMcpArgumentMode = {
  name: 'metadata-detail',
  description: 'Read selected assets using a named metadata detail preset.',
  requiredFields: ['assetIds'],
  forbiddenFields: ['fields', 'toolCallId'],
  whenToUse: 'Use when basic, descriptive, technical, or allSafe metadata coverage is enough.',
};

const metadataFieldsMode: AgentMcpArgumentMode = {
  name: 'metadata-fields',
  description: 'Read selected assets using exact metadata field groups.',
  requiredFields: ['assetIds', 'fields'],
  forbiddenFields: ['detail', 'toolCallId'],
  whenToUse:
    'Use when the task only needs specific field groups such as filename, rating, tags, location, camera, favorite, visibility, type, or dates.',
};

const toolCallArgumentsMissingMistake: AgentMcpCommonMistake = {
  id: 'tool-call-arguments-missing',
  match: { missingField: 'arguments', requestShape: 'json-rpc' },
  hint: 'Put the tool arguments object at params.arguments in the MCP tools/call request.',
  exampleName: 'read-selected-assets',
};

const toolCallArgumentsObjectMistake: AgentMcpCommonMistake = {
  id: 'tool-call-arguments-not-object',
  match: { issuePath: 'arguments', requestShape: 'json-rpc' },
  hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
  exampleName: 'read-selected-assets',
};

const assetIdMistakes: AgentMcpCommonMistake[] = [
  {
    id: 'asset-read-missing-asset-ids-or-tool-call-id',
    match: { messageIncludes: 'Provide assetIds for a new tool request or toolCallId for an approved request' },
    hint: 'For a new asset read, provide assetIds. For an approved retry, provide only toolCallId.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'asset-read-combined-asset-ids-and-tool-call-id',
    match: { messageIncludes: 'Provide either assetIds or toolCallId, not both' },
    hint: 'Use either assetIds for a new request or toolCallId for an approved retry, not both.',
    exampleName: 'approved-retry',
  },
  {
    id: 'asset-read-empty-asset-ids',
    match: { issuePath: 'assetIds' },
    hint: 'Provide at least one valid asset id, or retry an approved request with only toolCallId.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'asset-read-invalid-asset-id',
    match: { issuePath: 'assetIds.0' },
    hint: 'Asset ids must be UUID strings returned by Gallery tools.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'asset-read-duplicate-asset-ids',
    match: { issuePath: 'assetIds', messageIncludes: 'assetIds must be unique' },
    hint: 'Provide each asset id only once.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'asset-read-too-many-asset-ids',
    match: { issuePath: 'assetIds', messageIncludes: 'expected array to have <=10000 items' },
    hint: 'Asset read requests may include at most 10000 asset ids. Search or narrow the request before reading.',
    exampleName: 'read-selected-assets',
  },
  toolCallArgumentsMissingMistake,
  toolCallArgumentsObjectMistake,
];

const defineAssetReadContract = (
  name: AgentToolName.ReadAssetMetadata | AgentToolName.ReadAssetPreviews | AgentToolName.ReadAssetOriginals,
  title: string,
  description: string,
): AgentMcpToolContract<typeof name> => ({
  name,
  title,
  description,
  usage: 'Use assetIds for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [assetIdsMode, approvedRetryMode],
  examples: [assetIdsExample, approvedRetryExample],
  commonMistakes: assetIdMistakes,
  approvalRetry,
  safety,
});

const readAssetMetadataContract: AgentMcpToolContract<AgentToolName.ReadAssetMetadata> = {
  name: AgentToolName.ReadAssetMetadata,
  title: 'Read asset metadata',
  description:
    'Legacy exact non-search metadata read for selected assets. The technical and allSafe presets include qualityInfo (sharpness, exposure, brightness, quality scores).',
  usage:
    'Legacy exact non-search ID usage only. For search results, use readSelectionMetadata with selectionHandle.id instead. Use assetIds with detail for a metadata preset: basic, descriptive, technical, or allSafe. Use assetIds with fields for exact metadata field groups: type, dates, location, camera, tags, rating, filename, favorite, visibility, quality. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [metadataDetailMode, metadataFieldsMode, approvedRetryMode],
  examples: [assetIdsExample, approvedRetryExample],
  commonMistakes: assetIdMistakes,
  approvalRetry,
  safety,
};

const readSelectionMetadataContract: AgentMcpToolContract<AgentToolName.ReadSelectionMetadata> = {
  name: AgentToolName.ReadSelectionMetadata,
  title: 'Read selection metadata',
  description: 'Read aggregate counts and bounded itemRef metadata samples for a search selection handle.',
  usage:
    'Use selectionHandleId from searchAssets selectionHandle.id to inspect search-backed selections. Returns aggregate counts and bounded itemRef samples without provider-visible asset IDs. Use fields for exact metadata groups and sampleSize from 0 to 25. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'selection-metadata',
      description: 'Start a metadata read for a search selection handle.',
      requiredFields: ['selectionHandleId'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use after searchAssets returns selectionHandle.id and metadata samples are needed.',
    },
    selectionMetadataApprovedRetryMode,
  ],
  examples: [
    {
      name: 'read-selection-metadata-sample',
      description: 'Read bounded camera, date, and filename metadata samples from a search handle.',
      arguments: {
        selectionHandleId: '00000000-0000-4000-8000-000000000333',
        fields: ['dates', 'camera', 'filename'],
        sampleSize: 5,
      },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'selection-metadata-missing-selection-handle-or-tool-call-id',
      match: {
        messageIncludes: 'Provide selectionHandleId for a new tool request or toolCallId for an approved request',
      },
      hint: 'Call readSelectionMetadata with selectionHandleId from searchAssets selectionHandle.id, or retry an approved request with only toolCallId.',
      exampleName: 'read-selection-metadata-sample',
    },
    {
      id: 'selection-metadata-combined-selection-handle-and-tool-call-id',
      match: { messageIncludes: 'Provide either selectionHandleId or toolCallId, not both' },
      hint: 'Use selectionHandleId for a new selection metadata read or toolCallId for an approved retry, not both.',
      exampleName: 'approved-retry',
    },
    {
      id: 'selection-metadata-invalid-sample-size',
      match: { issuePath: 'sampleSize' },
      hint: 'Use sampleSize from 0 to 25 for readSelectionMetadata.',
      exampleName: 'read-selection-metadata-sample',
    },
  ],
  approvalRetry,
  safety,
};

const curateSelectionContract: AgentMcpToolContract<AgentToolName.CurateSelection> = {
  name: AgentToolName.CurateSelection,
  title: 'Curate selection',
  description: 'Create a derived selection handle from metadata-only ranking and diversification.',
  usage:
    'Use after searchAssets returns selectionHandle.id and before planning highlight, cover-candidate, favorite-first, date-spread, or stored quality-score filtering workflows. This tool returns a new selectionHandle plus criteriaSummary and itemRef samples without selected asset IDs. It is metadata-only; objective quality constraints use stored scores only, and no previews are inspected.',
  argumentModes: [
    {
      name: 'selection-curation',
      description: 'Curate a same-session selection handle into a smaller derived handle.',
      requiredFields: ['selectionHandleId', 'targetCount'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when a broad search handle needs deterministic metadata-only narrowing before planning.',
    },
    {
      ...approvedRetryMode,
      forbiddenFields: ['selectionHandleId', 'targetCount', 'strategy', 'criteria', 'constraints', 'sampleSize'],
    },
  ],
  examples: [
    {
      name: 'curate-metadata-highlights',
      description: 'Select metadata-only highlights with date and location variety.',
      arguments: {
        selectionHandleId: exampleSelectionHandleId,
        targetCount: 15,
        strategy: 'metadata-highlights',
        constraints: { diversifyBy: ['date', 'location'] },
        sampleSize: 5,
      },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'curation-missing-handle-or-target-count',
      match: { messageIncludes: 'Provide selectionHandleId and targetCount' },
      hint: 'Call searchAssets first, then pass selectionHandle.id and a targetCount to curateSelection.',
      exampleName: 'curate-metadata-highlights',
    },
    {
      id: 'curation-target-count-out-of-range',
      match: { issuePath: 'targetCount' },
      hint: 'Use targetCount from 1 to 1000. If the source selection is huge, narrow searchAssets first.',
      exampleName: 'curate-metadata-highlights',
    },
    {
      ...toolCallArgumentsMissingMistake,
      exampleName: 'curate-metadata-highlights',
    },
    {
      ...toolCallArgumentsObjectMistake,
      exampleName: 'curate-metadata-highlights',
    },
  ],
  approvalRetry,
  safety,
};

const searchAssetsContract: AgentMcpToolContract<AgentToolName.SearchAssets> = {
  name: AgentToolName.SearchAssets,
  title: 'Search assets',
  description:
    'Find assets using Gallery text search or metadata filters for people, spaces, visibility, dates, albums, tags, camera fields, ratings, media types, and bounded result pages.',
  usage:
    'Known ID filters: people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types. Use returned personIds or spaceId plus spacePersonIds. Use mode smart, description, ocr, or filename with query for text search. Default to handle-first search results with selectionHandle/sourceRef; use selectionHandle.id as assetSelectionHandleId for large bounded pages. For bounded handle-first searches, use limit up to 1000 when the session policy allows it; samples stay small. For broad or ambiguous requests, ask one narrowing question or repeat the same mode, query, filters, order, and limit using the returned nextPage value as page. When resolveAssetSearchFilters returns resolvedFilters, copy those fields into searchAssets.filters exactly. For people OR requests, use one personIds array with every resolved person id. For shared-space people, include both spaceId and spacePersonIds.',
  argumentModes: [
    {
      name: 'empty-search',
      description: 'Search visible assets with default filters and default limit.',
      requiredFields: [],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when the user asks a broad library question and no narrower filters are known.',
    },
    {
      name: 'filtered-search',
      description: 'Search visible assets with metadata filters.',
      requiredFields: ['filters'],
      forbiddenFields: ['toolCallId', 'query'],
      whenToUse:
        'Use when the user provides date, place, favorite, rating, album, tag, camera, media, people, space, or visibility filters.',
    },
    {
      name: 'text-search',
      description: 'Search visible assets using text query modes.',
      requiredFields: ['mode', 'query'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when the user asks for words found by smart, description, OCR, or filename search.',
    },
    searchApprovedRetryMode,
  ],
  examples: [
    {
      name: 'empty-search',
      description: 'Search with default filters and limit.',
      arguments: {},
    },
    {
      name: 'bounded-date-location-search',
      description: 'Search photos from a known place and date window.',
      arguments: {
        filters: {
          takenAfter: '2026-05-01T00:00:00.000Z',
          takenBefore: '2026-05-18T23:59:59.999Z',
          city: 'Berlin',
          country: 'Germany',
        },
        limit: 50,
      },
    },
  ],
  commonMistakes: [
    {
      id: 'search-filters-outside-filters',
      match: {
        issuePath: '',
        unexpectedFields: [
          'takenAfter',
          'takenBefore',
          'createdAfter',
          'createdBefore',
          'updatedAfter',
          'updatedBefore',
          'city',
          'state',
          'country',
          'make',
          'model',
          'lensModel',
          'isFavorite',
          'isNotInAlbum',
          'type',
          'rating',
          'tagIds',
          'albumIds',
          'personIds',
          'spaceId',
          'spacePersonIds',
          'withSharedSpaces',
          'visibility',
        ],
      },
      hint: 'Place supported metadata filters for date, location, favorite, rating, album, tag, camera, media, people, space, shared-space, and visibility inside the filters object.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-query-with-metadata-mode',
      match: { issuePath: 'query', messageIncludes: 'query is only supported' },
      hint: 'Use mode smart, description, ocr, or filename with query for text search, or omit query for metadata-only search.',
      exampleName: 'empty-search',
    },
    {
      id: 'search-space-person-without-space',
      match: { issuePath: 'filters.spacePersonIds', messageIncludes: 'spacePersonIds requires spaceId' },
      hint: 'spacePersonIds requires filters.spaceId. Resolve or choose the space first, then call searchAssets with both fields under filters.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-filter-name-in-tag-ids',
      match: { issuePath: 'filters.tagIds.0' },
      hint: 'Use resolveAssetSearchFilters for user-facing tag names, then call searchAssets with the returned tagIds under filters.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-filter-name-in-album-ids',
      match: { issuePath: 'filters.albumIds.0' },
      hint: 'Use resolveAssetSearchFilters for user-facing album names, then call searchAssets with the returned albumIds under filters.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-filter-name-in-person-ids',
      match: { issuePath: 'filters.personIds.0' },
      hint: 'Use resolveAssetSearchFilters for user-facing person names, then call searchAssets with the returned personIds under filters.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-filter-name-in-space-id',
      match: { issuePath: 'filters.spaceId' },
      hint: 'Use resolveAssetSearchFilters for user-facing space names, then call searchAssets with the returned spaceId under filters.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-filter-name-in-space-person-ids',
      match: { issuePath: 'filters.spacePersonIds.0' },
      hint: 'Use resolveAssetSearchFilters for user-facing shared-space person names, then call searchAssets with the returned spacePersonIds under filters.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-combined-filters-and-tool-call-id',
      match: { messageIncludes: 'Provide either search fields or toolCallId, not both' },
      hint: 'Use either mode, query, filters, limit, page, or order for a new search, or only toolCallId for an approved retry.',
      exampleName: 'empty-search',
    },
    {
      id: 'search-limit-out-of-range',
      match: { issuePath: 'limit' },
      hint: 'Use a positive integer limit no greater than 10000.',
      exampleName: 'empty-search',
    },
    {
      id: 'search-large-limit',
      match: { issuePath: 'limit', messageIncludes: 'limit 1000 ' },
      hint: 'Use limit up to 1000 only for bounded handle-first searches where the user supplied a clear album, space, date, person, tag, rating, or media-type scope; otherwise page with nextPage or ask a narrowing question.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-broad-full-metadata',
      match: { messageIncludes: 'metadata detail is too broad' },
      hint: 'Search for a handle/sourceRef first, then inspect summary samples or exact fields only for a small inspected set. Do not request full metadata for broad searches.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-preview-before-shortlist',
      match: { messageIncludes: 'preview reads require selected asset ids' },
      hint: 'For visual curation, start with a bounded handle/sourceRef and summary samples; use preview reads only for exact small non-search assetIds after narrowing.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-truncated-needs-more-detail',
      match: { messageIncludes: 'resultSize.truncated' },
      hint: 'When resultSize.truncated is true, request fewer assets, page with nextPage, or ask one narrowing question before requesting more fields.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-page-continuation',
      match: { issuePath: 'page' },
      hint: 'Use the returned nextPage value as page, and keep the same mode, query, filters, order, and limit from the previous bounded search.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-order-unavailable',
      match: { issuePath: 'order' },
      hint: 'Only order desc is executable in the current slice. Non-desc order is a contract field for a later slice.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put the search arguments object at params.arguments in the MCP tools/call request.',
      exampleName: 'empty-search',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
      exampleName: 'empty-search',
    },
  ],
  approvalRetry,
  safety,
};

const findTripCandidatesContract: AgentMcpToolContract<AgentToolName.FindTripCandidates> = {
  name: AgentToolName.FindTripCandidates,
  title: 'Find trip candidates',
  description: 'Find likely recent trip candidates from existing date and location metadata.',
  usage:
    'Use this first for requests like "create an album for my recent trip to USA". Returns compact candidates and selectionHandle.id values without raw asset IDs. Follow recommendation.action: use_top_candidate means use candidateDedupeKey, ask_user means ask one question with candidate labels, and none means ask for one concrete source before planning. For generic trip albums, pass the selected candidate selectionHandle.id to proposeAlbumFromSelection. For explicit highlights requests, pass it to curateSelection first. Do not ask for dates before trying this tool unless the user has already narrowed the request.',
  argumentModes: [tripCandidateLookupMode, tripCandidateApprovedRetryMode],
  examples: [
    {
      name: 'recent-trip-to-place',
      description: 'Find a recent USA trip candidate.',
      arguments: { placeHint: 'USA' },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'trip-candidates-mixed-tool-call-id',
      match: { messageIncludes: 'Provide either trip search fields or toolCallId, not both' },
      hint: 'Use either trip search fields for a new request or toolCallId for an approved retry, not both.',
      exampleName: 'approved-retry',
    },
    {
      id: 'trip-candidates-invalid-lookback-days',
      match: { issuePath: 'lookbackDays' },
      hint: 'Use lookbackDays between 1 and 365.',
      exampleName: 'recent-trip-to-place',
    },
    {
      id: 'trip-candidates-invalid-max-candidates',
      match: { issuePath: 'maxCandidates' },
      hint: 'Use maxCandidates between 1 and 10.',
      exampleName: 'recent-trip-to-place',
    },
  ],
  approvalRetry,
  safety,
};

const resolverApprovedRetryMode: AgentMcpArgumentMode = {
  name: 'approved-retry',
  description: 'Retry a filter resolver request that Gallery already approved.',
  requiredFields: ['toolCallId'],
  forbiddenFields: ['people', 'tags', 'albums', 'spaces', 'cameraMakes', 'cameraModels', 'lensModels', 'scope'],
  whenToUse: 'Use only after Gallery resumes the assistant from an approved resolver request.',
};

const resolveLocationContract: AgentMcpToolContract<AgentToolName.ResolveLocation> = {
  name: AgentToolName.ResolveLocation,
  title: 'Resolve location',
  description:
    'Forward-geocode a place name to coordinates. Returns matched (single clear result), ambiguous (up to 5 candidate places), or not_found.',
  usage:
    'Use when a user specifies a place name to set as a photo location. If the result is ambiguous, present the choices to the user and ask them to pick one. If not_found, tell the user the place was not recognised and ask for a more specific name.',
  argumentModes: [
    {
      name: 'forward-geocode',
      description: 'Forward-geocode a place name string.',
      requiredFields: ['query'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when you have a place name from the user that needs to be resolved to coordinates.',
    },
    {
      name: 'approved-retry',
      description: 'Retry a location resolve request that Gallery already approved.',
      requiredFields: ['toolCallId'],
      forbiddenFields: ['query'],
      whenToUse: 'Use only after Gallery resumes the assistant from an approved resolve-location request.',
    },
  ],
  examples: [
    {
      name: 'resolve-paris-matched',
      description: 'Forward-geocode "Paris" — likely returns matched with Île-de-France coordinates.',
      arguments: { query: 'Paris, France' },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'resolve-location-missing-query',
      match: { messageIncludes: 'Provide a query string' },
      hint: 'Provide the query field with the place name string to forward-geocode.',
      exampleName: 'resolve-paris-matched',
    },
  ],
  approvalRetry,
  safety,
};

const searchPeopleContract: AgentMcpToolContract<AgentToolName.SearchPeople> = {
  name: AgentToolName.SearchPeople,
  title: 'Search people',
  description:
    'Resolve a person by name to an id. Returns matched (single clear result), ambiguous (up to 5 candidate people), or not_found. Scrubbed: id, name, thumbnail asset id — no face data.',
  usage:
    'Use when a user refers to a person by name and you need their person id. If the result is ambiguous, present the choices to the user and ask them to pick one. If not_found, tell the user the person was not recognised and ask for a more specific name.',
  argumentModes: [
    {
      name: 'search-by-name',
      description: 'Search for a person by name string.',
      requiredFields: ['name'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when you have a person name from the user that needs to be resolved to a person id.',
    },
    {
      name: 'approved-retry',
      description: 'Retry a people search request that Gallery already approved.',
      requiredFields: ['toolCallId'],
      forbiddenFields: ['name'],
      whenToUse: 'Use only after Gallery resumes the assistant from an approved search-people request.',
    },
  ],
  examples: [
    {
      name: 'search-alice-matched',
      description: 'Search for a person named "Alice" — likely returns matched with person id.',
      arguments: { name: 'Alice' },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'search-people-missing-name',
      match: { messageIncludes: 'Provide a name string' },
      hint: 'Provide the name field with the person name string to search for.',
      exampleName: 'search-alice-matched',
    },
  ],
  approvalRetry,
  safety,
};

const resolveAssetSearchFiltersContract: AgentMcpToolContract<AgentToolName.ResolveAssetSearchFilters> = {
  name: AgentToolName.ResolveAssetSearchFilters,
  title: 'Resolve asset search filters',
  description: 'Resolve visible album, tag, person, space, and camera names into searchAssets-compatible filters.',
  usage:
    'Use before searchAssets when the user gives names for tags, albums, people, spaces, camera makes, camera models, or lenses. For named people in a named shared space, resolve the space and person together so the result can return spaceId plus spacePersonIds. Call searchAssets only after this returns unambiguous resolvedFilters. Use only toolCallId when retrying a Gallery-approved resolver request. If any requested people, albums, tags, spaces, or camera names cannot be resolved unambiguously, ask a clarifying question instead of running a broad search without the missing resolved filter.',
  argumentModes: [
    {
      name: 'resolve-named-filters',
      description: 'Resolve visible names into canonical search filter ids and values.',
      requiredFields: [],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when the user gives album, tag, person, space, camera make, camera model, or lens names.',
    },
    resolverApprovedRetryMode,
  ],
  examples: [
    {
      name: 'resolve-named-filters',
      description: 'Resolve album and tag names before searching.',
      arguments: { tags: ['Travel'], albums: ['Berlin'] },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'resolver-missing-fields',
      match: { messageIncludes: 'Provide at least one resolver field' },
      hint: 'Provide at least one name field such as tags, albums, people, spaces, cameraMakes, cameraModels, or lensModels.',
      exampleName: 'resolve-named-filters',
    },
    {
      id: 'resolver-combined-fields-and-tool-call-id',
      match: { messageIncludes: 'Provide either resolver fields or toolCallId, not both' },
      hint: 'Use resolver fields for a new request or only toolCallId for an approved retry, not both.',
      exampleName: 'approved-retry',
    },
    {
      id: 'resolver-scope-conflict',
      match: { issuePath: 'scope.withSharedSpaces', messageIncludes: 'Cannot use both scope.spaceId' },
      hint: 'Use either scope.spaceId for one shared space or scope.withSharedSpaces for all visible shared spaces.',
      exampleName: 'resolve-named-filters',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put the resolver arguments object at params.arguments in the MCP tools/call request.',
      exampleName: 'resolve-named-filters',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
      exampleName: 'resolve-named-filters',
    },
  ],
  approvalRetry,
  safety,
};

const listAlbumsContract: AgentMcpToolContract<AgentToolName.ListAlbums> = {
  name: AgentToolName.ListAlbums,
  title: 'List albums',
  description: 'List albums visible to the session user.',
  usage: 'Use an empty object for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'list-visible-albums',
      description: 'Start a new album list request.',
      requiredFields: [],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use before answering album count or album lookup questions.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'list-visible-albums',
      description: 'List visible albums.',
      arguments: {},
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'list-albums-unexpected-field',
      match: { unexpectedField: 'albumId' },
      hint: 'Use {} to list albums. Use readAlbum with albumId to inspect one album.',
      exampleName: 'list-visible-albums',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Use params.arguments: {} for a normal listAlbums tool call.',
      exampleName: 'list-visible-albums',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object. Use {} for a normal listAlbums call.',
      exampleName: 'list-visible-albums',
    },
  ],
  approvalRetry,
  safety,
};

const readAlbumContract: AgentMcpToolContract<AgentToolName.ReadAlbum> = {
  name: AgentToolName.ReadAlbum,
  title: 'Read album',
  description: 'Read one visible album and its asset ids.',
  usage: 'Use albumId for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'album-id',
      description: 'Start a new album read request.',
      requiredFields: ['albumId'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use after listAlbums returns the album id to inspect.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'read-visible-album',
      description: 'Read an album by id.',
      arguments: { albumId: exampleAlbumId },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'read-album-missing-album-id-or-tool-call-id',
      match: { messageIncludes: 'Provide albumId for a new tool request or toolCallId for an approved request' },
      hint: 'Use albumId for a new album read, or only toolCallId for an approved retry.',
      exampleName: 'read-visible-album',
    },
    {
      id: 'read-album-combined-album-id-and-tool-call-id',
      match: { messageIncludes: 'Provide either albumId or toolCallId, not both' },
      hint: 'Use either albumId for a new request or toolCallId for an approved retry, not both.',
      exampleName: 'approved-retry',
    },
    {
      id: 'read-album-invalid-album-id',
      match: { issuePath: 'albumId' },
      hint: 'Album ids must be UUID strings returned by listAlbums.',
      exampleName: 'read-visible-album',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put the album read arguments object at params.arguments in the MCP tools/call request.',
      exampleName: 'read-visible-album',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
      exampleName: 'read-visible-album',
    },
  ],
  approvalRetry,
  safety,
};

const listSpacesContract: AgentMcpToolContract<AgentToolName.ListSpaces> = {
  name: AgentToolName.ListSpaces,
  title: 'List spaces',
  description: 'List shared spaces visible to the session user.',
  usage: 'Use an empty object for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'list-visible-spaces',
      description: 'Start a new shared space list request.',
      requiredFields: [],
      forbiddenFields: ['toolCallId', 'spaceId'],
      whenToUse: 'Use before answering shared-space count or shared-space lookup questions.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'list-visible-spaces',
      description: 'List visible shared spaces.',
      arguments: {},
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'list-spaces-unexpected-space-id',
      match: { unexpectedField: 'spaceId' },
      hint: 'Use {} to list spaces. Use readSpace with spaceId to inspect one space.',
      exampleName: 'list-visible-spaces',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Use params.arguments: {} for a normal listSpaces tool call.',
      exampleName: 'list-visible-spaces',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object. Use {} for a normal listSpaces call.',
      exampleName: 'list-visible-spaces',
    },
  ],
  approvalRetry,
  safety,
};

const listDuplicateGroupsContract: AgentMcpToolContract<AgentToolName.ListDuplicateGroups> = {
  name: AgentToolName.ListDuplicateGroups,
  title: 'List duplicate groups',
  description:
    'List near-duplicate photo groups detected by CLIP-embedding similarity, returning only the fields needed to choose a keeper (id, originalFileName, fileCreatedAt, isFavorite, rating, width, height, sharpness). sharpness is null when the asset has not been scored.',
  usage:
    'Use an empty object for a new request or pass maxGroups to limit results. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'list-duplicate-groups',
      description: 'Start a new duplicate group list request.',
      requiredFields: [],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use before ranking duplicate groups and choosing which assets to keep.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'list-duplicate-groups',
      description: 'List duplicate groups (up to the default 50).',
      arguments: {},
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Use params.arguments: {} for a normal listDuplicateGroups tool call.',
      exampleName: 'list-duplicate-groups',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object. Use {} for a normal listDuplicateGroups call.',
      exampleName: 'list-duplicate-groups',
    },
  ],
  approvalRetry,
  safety,
};

const readSpaceContract: AgentMcpToolContract<AgentToolName.ReadSpace> = {
  name: AgentToolName.ReadSpace,
  title: 'Read space',
  description: 'Read one visible shared space, member summaries, and bounded asset ids.',
  usage: 'Use spaceId for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'space-id',
      description: 'Start a new shared space read request.',
      requiredFields: ['spaceId'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use after listSpaces returns the shared space id to inspect.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'read-space-details',
      description: 'Read a shared space by id.',
      arguments: { spaceId: exampleSpaceId },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'read-space-missing-space-id-or-tool-call-id',
      match: { messageIncludes: 'Provide spaceId, or retry an approved tool call with toolCallId' },
      hint: 'Use spaceId returned by listSpaces for a new space read, or only toolCallId for an approved retry.',
      exampleName: 'read-space-details',
    },
    {
      id: 'read-space-combined-space-id-and-tool-call-id',
      match: { messageIncludes: 'Use either spaceId or toolCallId, not both' },
      hint: 'Use either spaceId for a new request or toolCallId for an approved retry, not both.',
      exampleName: 'approved-retry',
    },
    {
      id: 'read-space-wrong-id-field',
      match: { unexpectedFields: ['id', 'name', 'spaceName'] },
      hint: 'Call listSpaces first, then call readSpace with the exact shape {"spaceId":"..."} using the returned id.',
      exampleName: 'read-space-details',
    },
    {
      id: 'read-space-invalid-space-id',
      match: { issuePath: 'spaceId' },
      hint: 'Space ids must be UUID strings returned by listSpaces.',
      exampleName: 'read-space-details',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put the space read arguments object at params.arguments in the MCP tools/call request.',
      exampleName: 'read-space-details',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
      exampleName: 'read-space-details',
    },
  ],
  approvalRetry,
  safety,
};

const searchUsersContract: AgentMcpToolContract<AgentToolName.SearchUsers> = {
  name: AgentToolName.SearchUsers,
  title: 'Search users',
  description: 'Find Gallery users visible to the session user before proposing shared-space member changes.',
  usage: 'Use query and limit for a new user lookup. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'user-query',
      description: 'Start a new visible user lookup.',
      requiredFields: [],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use before proposing add, remove, or role-change operations for shared-space members.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'find-user-by-name',
      description: 'Find a visible user by name or email text.',
      arguments: { query: 'sam', limit: 5 },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'search-users-combined-query-and-tool-call-id',
      match: { messageIncludes: 'Provide either user search fields or toolCallId, not both' },
      hint: 'Use query and limit for a new lookup, or only toolCallId for an approved retry.',
      exampleName: 'approved-retry',
    },
    {
      id: 'search-users-limit-out-of-range',
      match: { issuePath: 'limit' },
      hint: 'Use a positive integer limit no greater than 20.',
      exampleName: 'find-user-by-name',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put the user search arguments object at params.arguments in the MCP tools/call request.',
      exampleName: 'find-user-by-name',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
      exampleName: 'find-user-by-name',
    },
  ],
  approvalRetry,
  safety,
};

const readToolContracts: AgentMcpReadToolContract[] = [
  resolveLocationContract,
  searchPeopleContract,
  resolveAssetSearchFiltersContract,
  searchAssetsContract,
  findTripCandidatesContract,
  readSelectionMetadataContract,
  curateSelectionContract,
  readAssetMetadataContract,
  defineAssetReadContract(
    AgentToolName.ReadAssetPreviews,
    'Read asset previews',
    'Read preview media references for selected assets.',
  ),
  defineAssetReadContract(
    AgentToolName.ReadAssetOriginals,
    'Read asset originals',
    'Read original media references for selected assets.',
  ),
  listAlbumsContract,
  readAlbumContract,
  listSpacesContract,
  readSpaceContract,
  searchUsersContract,
  listDuplicateGroupsContract,
];

const planningUsage =
  'Create a reviewable Gallery operation plan. provider planning rejects raw assetIds; use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search so Gallery materializes IDs server-side. assetSource.explicitAssets is internal-only and rejected for provider-facing planning.';

const planningMode: AgentMcpArgumentMode = {
  name: 'operation-plan',
  description: 'Create or revise a reviewable plan without applying changes directly.',
  requiredFields: ['summary', 'operations'],
  forbiddenFields: [],
  whenToUse: 'Use for album, space, and asset-batch organization changes that Gallery should review before applying.',
};

const planIdMode: AgentMcpArgumentMode = {
  name: 'existing-plan',
  description: 'Reference an existing Gallery operation plan.',
  requiredFields: ['planId'],
  forbiddenFields: [],
  whenToUse: 'Use when revising or summarizing a plan Gallery already created.',
};

const createAlbumAndAddAssetsExample: AgentMcpToolExample = {
  name: 'create-album-and-add-assets',
  description: 'Create a new album and add selected assets to it.',
  arguments: {
    summary: 'Create today test and add selected photos.',
    operations: [
      {
        type: AgentOperationType.AlbumCreate,
        summary: 'Create today test album.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-today-test',
        payload: { albumName: "today's test", description: 'Selected recent uploads.' },
      },
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add selected photos to today test.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-today-test',
        assetSelectionHandleId: exampleSelectionHandleId,
      },
    ],
  },
};

const planningProposalExamples: AgentMcpToolExample[] = [
  createAlbumAndAddAssetsExample,
  {
    name: 'add-assets-to-existing-album',
    description: 'Add selected assets to an existing album.',
    arguments: {
      summary: 'Add selected photos to an existing album.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetSource: { kind: 'selectionHandle', selectionHandleId: exampleSelectionHandleId },
        },
      ],
    },
  },
];

const planningCommonMistakes: AgentMcpCommonMistake[] = [
  {
    id: 'planning-tool-arguments-missing',
    match: { missingField: 'arguments', requestShape: 'json-rpc' },
    hint: 'Put the planning tool arguments object at params.arguments in the MCP tools/call request.',
    exampleName: 'create-album-and-add-assets',
  },
  {
    id: 'planning-tool-arguments-not-object',
    match: { issuePath: 'arguments', requestShape: 'json-rpc' },
    hint: 'The params.arguments value must be a JSON object with summary and operations.',
    exampleName: 'create-album-and-add-assets',
  },
  {
    id: 'planning-missing-create-temporary-target-id',
    match: { issuePath: 'operations.0.temporaryTargetId', messageIncludes: 'Required' },
    hint: 'New album and space create operations need a temporaryTargetId so later operations can reference them.',
    exampleName: 'create-album-and-add-assets',
  },
  {
    id: 'planning-missing-temporary-target-dependency',
    match: { messageIncludes: 'No matching create operation for temporaryTargetId' },
    hint: 'Create the new album or space first, then reference the same temporaryTargetId from dependent add-assets or cover operations.',
    exampleName: 'create-album-and-add-assets',
  },
  {
    id: 'planning-mismatched-temporary-target-kind',
    match: {
      issuePath: 'operations.1.temporaryTargetId',
      messageIncludes: 'No matching create operation for temporaryTargetId',
    },
    hint: 'Album dependencies require an album create operation; space dependencies require a space create operation using the same temporaryTargetId.',
    exampleName: 'create-album-and-add-assets',
  },
  {
    id: 'planning-wrong-album-target-kind',
    match: { messageIncludes: 'album operations require an album target' },
    hint: 'Album operations must use targetKind existing_album with targetId, or new_album with temporaryTargetId when the operation allows new albums.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-wrong-space-target-kind',
    match: { messageIncludes: 'space operations require a space target' },
    hint: 'Space operations must use targetKind "existing_space" with targetId from listSpaces/readSpace, or targetKind "new_space" with temporaryTargetId from a prior space.create operation.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-existing-space-missing-target-id',
    match: {
      issuePath: 'operations.0.targetId',
      messageIncludes: 'targetId is required for existing space targets',
      requestShape: 'tool-arguments',
    },
    hint: 'Existing-space asset operations require targetKind "existing_space" and targetId from listSpaces/readSpace.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-existing-space-with-temporary-target',
    match: {
      issuePath: 'operations.0.temporaryTargetId',
      messageIncludes: 'Use targetId for existing spaces',
      requestShape: 'tool-arguments',
    },
    hint: 'Use targetId for existing spaces. Use temporaryTargetId only for new spaces created earlier in the same plan. Read readSpace.assetIdsTruncated before deciding membership: when false, exclude add candidates already in the space and only remove photos already in the space; when true, narrow or ask before claiming membership is complete.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-space-update-empty-payload',
    match: { issuePath: 'operations.0.payload', messageIncludes: 'Provide spaceName, description, or color' },
    hint: 'space.updateDetails payload must include at least one of spaceName, description, or color.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-asset-metadata-unsupported-placename',
    match: { issuePath: 'operations.0.payload', messageIncludes: 'placeName' },
    hint: 'asset.updateMetadata does not accept placeName. Use explicit latitude and longitude together, or omit location metadata.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-asset-metadata-unsupported-city',
    match: { issuePath: 'operations.0.payload', messageIncludes: 'city' },
    hint: 'asset.updateMetadata does not accept city. Use explicit latitude and longitude together, or omit location metadata.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-asset-metadata-unsupported-country',
    match: { issuePath: 'operations.0.payload', messageIncludes: 'country' },
    hint: 'asset.updateMetadata does not accept country. Use explicit latitude and longitude together, or omit location metadata.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-asset-metadata-unsupported-title',
    match: { issuePath: 'operations.0.payload', messageIncludes: 'title' },
    hint: 'asset.updateMetadata does not accept title. Use description for asset descriptive text.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-asset-metadata-missing-coordinate',
    match: { issuePath: 'operations.0.payload', messageIncludes: 'Provide both latitude and longitude' },
    hint: 'Location metadata must include both latitude and longitude as explicit coordinates.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-space-update-unsupported-fields',
    match: { issuePath: 'operations.0.payload', messageIncludes: 'Unrecognized key' },
    hint: 'space.updateDetails only supports spaceName, description, and color. Do not include thumbnail, pets, face recognition, linked libraries, or deletion fields.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-space-update-missing-target-id',
    match: {
      issuePath: 'operations.0.targetId',
      messageIncludes: 'targetId is required for existing space targets',
      requestShape: 'tool-arguments',
    },
    hint: 'Existing-space detail updates require targetKind "existing_space" and targetId from listSpaces/readSpace.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-direct-space-mutation',
    match: { messageIncludes: 'Unknown tool', requestShape: 'json-rpc' },
    hint: 'Do not call direct space mutation tools. Propose a reviewable space.updateDetails plan instead.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-wrong-asset-batch-target-kind',
    match: { messageIncludes: 'requires an asset_batch target' },
    hint: 'Favorite, archive, metadata update, add-tag, and remove-tag operations must use targetKind asset_batch without targetId or temporaryTargetId.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-wrong-image-edit-target-kind',
    match: { messageIncludes: 'requires an image_edit_batch target' },
    hint: 'Rotate operations must use targetKind image_edit_batch without targetId or temporaryTargetId.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-duplicate-asset-ids',
    match: { messageIncludes: 'assetIds must be unique' },
    hint: 'Provider planning rejects raw assetIds. Use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search so Gallery materializes IDs server-side.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-pasted-large-asset-ids',
    match: { issuePath: 'operations.0.assetIds', messageIncludes: 'expected array to have <=' },
    hint: 'Provider planning rejects raw assetIds. Use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search so Gallery materializes IDs server-side.',
    exampleName: 'create-album-and-add-assets',
  },
  {
    id: 'planning-invalid-rotate-angle',
    match: { messageIncludes: 'angle must be 90, 180, or 270' },
    hint: 'Rotate payload angle must be exactly 90, 180, or 270.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-invalid-tag-payload',
    match: { messageIncludes: 'Provide exactly one of tagId or tagName' },
    hint: 'Asset add-tag payload must provide exactly one of tagId or tagName.',
    exampleName: 'add-assets-to-existing-album',
  },
];

const revisePlanningExamples: AgentMcpToolExample[] = planningProposalExamples.map((example) => ({
  ...example,
  name: `revise-${example.name}`,
  description: `Revise a plan to ${example.description.charAt(0).toLowerCase()}${example.description.slice(1)}`,
  arguments: {
    planId: examplePlanId,
    feedback: 'Use this revised operation plan.',
    ...example.arguments,
  },
}));

const revisePlanningCommonMistakes: AgentMcpCommonMistake[] = planningCommonMistakes.map((mistake) => ({
  ...mistake,
  exampleName: mistake.exampleName ? `revise-${mistake.exampleName}` : undefined,
}));

const proposeAlbumFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'create-south-africa-pierre-aurelia-album',
    description:
      'Regression: create an album for South Africa in January 2026 with Pierre OR Aurelia using declarative people names.',
    arguments: {
      summary: 'Create South Africa January 2026 album for Pierre or Aurelia.',
      albumName: 'South Africa with Pierre & Aurelia',
      description: 'January 2026 South Africa photos featuring Pierre or Aurelia.',
      assetSource: {
        kind: 'search',
        filters: {
          country: 'South Africa',
          takenAfter: '2026-01-01T00:00:00.000Z',
          takenBefore: '2026-02-01T00:00:00.000Z',
          people: { match: 'any', names: ['Pierre', 'Aurelia'] },
        },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'create-album-from-previous-search',
    description: 'Create a new album from a previous search source reference.',
    arguments: {
      summary: 'Create album from the previous search.',
      albumName: 'Recent favorites',
      assetSource: {
        kind: 'previousSearch',
        sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000333',
      },
    },
  },
];

const proposeAddAssetsToAlbumFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'add-search-results-to-album-by-id',
    description: 'Add matching photos to an existing album id.',
    arguments: {
      summary: 'Add matching South Africa photos to the trip album.',
      albumId: exampleAlbumId,
      assetSource: {
        kind: 'search',
        filters: { country: 'South Africa' },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'add-search-results-to-album-by-name',
    description: 'Add matching photos to a uniquely named visible album.',
    arguments: {
      summary: 'Add unalbumed Berlin photos.',
      albumName: 'Berlin',
      assetSource: {
        kind: 'search',
        filters: {
          city: 'Berlin',
          country: 'Germany',
          isNotInAlbum: true,
        },
        materialization: 'all-matches-with-limit',
      },
    },
  },
];

const proposeAlbumFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAlbumFromSearch,
  title: 'Propose album from search',
  description: 'preferred tool for creating a new album from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to create an album from matching photos. Gallery resolves names, materializes the source, and creates a reviewable plan; nothing is applied until the user approves.',
  argumentModes: [
    {
      name: 'new-album-from-search',
      description: 'Create a new album and add matching search results.',
      requiredFields: ['albumName', 'assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId'],
      whenToUse:
        'Use for requests like create an album from photos matching date, place, people, tags, or a previous search.',
    },
  ],
  examples: proposeAlbumFromSearchExamples,
  commonMistakes: [
    {
      id: 'album-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use assetSource.selectionHandle, assetSource.search, or assetSource.previousSearch with this workflow tool; provider planning rejects raw assetIds.',
      exampleName: 'create-south-africa-pierre-aurelia-album',
    },
  ],
  safety,
};

const proposeAddAssetsToAlbumFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
  title: 'Propose add assets to album from search',
  description:
    'preferred tool for adding matching photos to an existing album from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to add matching photos to an existing album. Provide albumId when known, or a uniquely visible albumName. Gallery creates a reviewable plan only.',
  argumentModes: [
    {
      name: 'existing-album-from-search',
      description: 'Add matching search results to one existing album.',
      requiredFields: ['assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId'],
      whenToUse: 'Use for requests like add my matching trip photos to this existing album.',
    },
  ],
  examples: proposeAddAssetsToAlbumFromSearchExamples,
  commonMistakes: [
    {
      id: 'album-add-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use assetSource.selectionHandle, assetSource.search, or assetSource.previousSearch with this workflow tool; provider planning rejects raw assetIds.',
      exampleName: 'add-search-results-to-album-by-name',
    },
    {
      id: 'album-workflow-missing-target',
      match: { messageIncludes: 'Provide exactly one of albumId or albumName' },
      hint: 'Provide albumId from listAlbums/readAlbum, or provide one exact visible albumName.',
      exampleName: 'add-search-results-to-album-by-id',
    },
  ],
  safety,
};

const proposeSpaceFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'create-space-from-declarative-search',
    description: 'Create a new shared space directly from user-facing search filters.',
    arguments: {
      summary: 'Create family South Africa space.',
      spaceName: 'Family South Africa',
      description: 'Shared January 2026 South Africa photos.',
      color: UserAvatarColor.Blue,
      assetSource: {
        kind: 'search',
        filters: {
          country: 'South Africa',
          takenAfter: '2026-01-01T00:00:00.000Z',
          takenBefore: '2026-02-01T00:00:00.000Z',
        },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'create-space-from-previous-search',
    description: 'Create a new shared space from a previous search source reference.',
    arguments: {
      summary: 'Create shared space from previous search.',
      spaceName: 'Recent family favorites',
      assetSource: {
        kind: 'previousSearch',
        sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000333',
      },
    },
  },
];

const proposeAddAssetsToSpaceFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'add-search-results-to-space-by-id',
    description: 'Add matching photos to an existing shared space id.',
    arguments: {
      summary: 'Add matching South Africa photos to the family space.',
      spaceId: exampleSpaceId,
      assetSource: {
        kind: 'search',
        filters: { country: 'South Africa' },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'add-search-results-to-space-by-name',
    description: 'Add matching photos to a uniquely named visible shared space.',
    arguments: {
      summary: 'Add unalbumed Berlin photos to Family.',
      spaceName: 'Family',
      assetSource: {
        kind: 'search',
        filters: {
          city: 'Berlin',
          country: 'Germany',
          isNotInAlbum: true,
        },
        materialization: 'all-matches-with-limit',
      },
    },
  },
];

const proposeSpaceFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeSpaceFromSearch,
  title: 'Propose space from search',
  description: 'preferred tool for creating a new shared space from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to create a shared space from matching photos. Gallery resolves names, materializes the source, and creates a reviewable plan; nothing is applied until the user approves.',
  argumentModes: [
    {
      name: 'new-space-from-search',
      description: 'Create a new shared space and add matching search results.',
      requiredFields: ['spaceName', 'assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId'],
      whenToUse:
        'Use for requests like create a shared space from photos matching date, place, people, tags, or a previous search.',
    },
  ],
  examples: proposeSpaceFromSearchExamples,
  commonMistakes: [
    {
      id: 'space-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use assetSource.selectionHandle, assetSource.search, or assetSource.previousSearch with this workflow tool; provider planning rejects raw assetIds.',
      exampleName: 'create-space-from-declarative-search',
    },
  ],
  safety,
};

const proposeAddAssetsToSpaceFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
  title: 'Propose add assets to space from search',
  description:
    'preferred tool for adding matching photos to an existing shared space from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to add matching photos to an existing shared space. Provide spaceId when known, or a uniquely visible spaceName. Gallery creates a reviewable plan only.',
  argumentModes: [
    {
      name: 'existing-space-from-search',
      description: 'Add matching search results to one existing shared space.',
      requiredFields: ['assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId'],
      whenToUse: 'Use for requests like add my matching trip photos to this existing shared space.',
    },
  ],
  examples: proposeAddAssetsToSpaceFromSearchExamples,
  commonMistakes: [
    {
      id: 'space-add-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use assetSource.selectionHandle, assetSource.search, or assetSource.previousSearch with this workflow tool; provider planning rejects raw assetIds.',
      exampleName: 'add-search-results-to-space-by-name',
    },
    {
      id: 'space-workflow-missing-target',
      match: { messageIncludes: 'Provide exactly one of spaceId or spaceName' },
      hint: 'Provide spaceId from listSpaces/readSpace, or provide one exact visible spaceName.',
      exampleName: 'add-search-results-to-space-by-id',
    },
  ],
  safety,
};

const proposeAssetBatchFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'favorite-search-results',
    description: 'Favorite all photos matching a declarative search.',
    arguments: {
      summary: 'Favorite matching Berlin receipt photos.',
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      assetSource: {
        kind: 'search',
        mode: 'ocr',
        query: 'receipt',
        filters: { city: 'Berlin' },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'rotate-previous-search-results',
    description: 'Rotate photos from a previous search source reference after review.',
    arguments: {
      summary: 'Rotate previous search results.',
      action: { type: AgentOperationType.AssetRotate, angle: 90 },
      assetSource: {
        kind: 'previousSearch',
        sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000333',
      },
    },
  },
];

const proposeAssetBatchFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAssetBatchFromSearch,
  title: 'Propose asset batch from search',
  description:
    'preferred tool for proposing favorite, archive, tag, metadata, rotate, adjust, or flip actions from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to favorite, archive, unarchive, tag, update metadata, rotate, adjust (brightness/contrast/saturation/auto-enhance), or flip matching photos. Gallery materializes the source and creates a reviewable plan only. Examples: asset.adjust { brightness: "moderate_increase", contrast: "slight_increase" }, asset.adjust { autoEnhance: true }, asset.flip { axis: "horizontal" }, asset.flip { axis: "vertical" }.',
  argumentModes: [
    {
      name: 'asset-batch-from-search',
      description: 'Propose one supported asset batch action for matching search results.',
      requiredFields: ['action', 'assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId', 'targetKind'],
      whenToUse:
        'Use for favorite, archive, unarchive, add tag, metadata update, rotate, adjust, or flip requests over search results.',
    },
  ],
  examples: proposeAssetBatchFromSearchExamples,
  commonMistakes: [
    {
      id: 'asset-batch-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use assetSource.selectionHandle, assetSource.search, or assetSource.previousSearch with this workflow tool; provider planning rejects raw assetIds.',
      exampleName: 'favorite-search-results',
    },
    {
      id: 'asset-batch-workflow-unsupported-action',
      match: { issuePath: 'action.type', requestShape: 'tool-arguments' },
      hint: 'Use only asset.setFavorite, asset.setArchive, asset.addTag, asset.updateMetadata, asset.rotate, asset.adjust, or asset.flip with this workflow tool.',
      exampleName: 'favorite-search-results',
    },
  ],
  safety,
};

const proposeAlbumFromSelectionExamples: AgentMcpToolExample[] = [
  {
    name: 'create-album-from-selection',
    description: 'Create a new album from an existing curated selection handle.',
    arguments: {
      summary: 'Create USA highlights from curated selection.',
      albumName: 'USA Highlights',
      description: 'Curated trip highlights.',
      selectionHandleId: exampleSelectionHandleId,
    },
  },
];

const proposeAssetBatchFromSelectionExamples: AgentMcpToolExample[] = [
  {
    name: 'favorite-selection',
    description: 'Favorite all assets represented by an existing curated selection handle.',
    arguments: {
      summary: 'Favorite curated highlights.',
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      selectionHandleId: exampleSelectionHandleId,
    },
  },
];

const proposeAlbumFromSelectionContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAlbumFromSelection,
  title: 'Propose album from selection',
  description: 'preferred tool for creating a new album from an existing search or curated selection handle.',
  usage:
    'Use this after searchAssets or curateSelection when the selected asset set is represented by selectionHandle.id. Gallery materializes IDs server-side and creates a reviewable plan only.',
  argumentModes: [
    {
      name: 'new-album-from-selection',
      description: 'Create a new album and add assets from an existing selection handle.',
      requiredFields: ['albumName', 'selectionHandleId'],
      forbiddenFields: ['operations', 'assetIds', 'assetSource', 'assetSelectionHandleId'],
      whenToUse:
        'Use when searchAssets or curateSelection returned the exact selectionHandle.id for the album contents.',
    },
  ],
  examples: proposeAlbumFromSelectionExamples,
  commonMistakes: [
    {
      id: 'album-selection-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Pass selectionHandleId from searchAssets or curateSelection selectionHandle.id; provider planning rejects raw assetIds.',
      exampleName: 'create-album-from-selection',
    },
  ],
  safety,
};

const proposeAssetBatchFromSelectionContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAssetBatchFromSelection,
  title: 'Propose asset batch from selection',
  description:
    'preferred tool for proposing favorite, archive, tag, metadata, rotate, adjust, or flip actions from an existing selection handle.',
  usage:
    'Use this after searchAssets or curateSelection when the selected asset set is represented by selectionHandle.id. Gallery materializes IDs server-side and creates a reviewable plan only. Examples: asset.adjust { brightness: "moderate_increase" }, asset.adjust { autoEnhance: true }, asset.flip { axis: "horizontal" }, asset.flip { axis: "vertical" }.',
  argumentModes: [
    {
      name: 'asset-batch-from-selection',
      description: 'Propose one supported asset batch action for an existing selection handle.',
      requiredFields: ['action', 'selectionHandleId'],
      forbiddenFields: ['operations', 'assetIds', 'assetSource', 'assetSelectionHandleId', 'targetKind'],
      whenToUse:
        'Use for favorite, archive, unarchive, add tag, metadata update, rotate, adjust, or flip requests after searchAssets or curateSelection returned the exact selectionHandle.id.',
    },
  ],
  examples: proposeAssetBatchFromSelectionExamples,
  commonMistakes: [
    {
      id: 'asset-batch-selection-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Pass selectionHandleId from searchAssets or curateSelection selectionHandle.id; provider planning rejects raw assetIds.',
      exampleName: 'favorite-selection',
    },
    {
      id: 'asset-batch-selection-workflow-unsupported-action',
      match: { issuePath: 'action.type', requestShape: 'tool-arguments' },
      hint: 'Use only asset.setFavorite, asset.setArchive, asset.addTag, asset.updateMetadata, asset.rotate, asset.adjust, or asset.flip with this workflow tool.',
      exampleName: 'favorite-selection',
    },
  ],
  safety,
};

const proposeAlbumOperationsContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAlbumOperations,
  title: 'Propose album operations',
  description: 'Create a reviewable Gallery operation plan for albums, spaces, and asset batches.',
  usage: planningUsage,
  argumentModes: [planningMode],
  examples: planningProposalExamples,
  commonMistakes: planningCommonMistakes,
  safety,
};

const reviseProposedOperationsContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ReviseProposedOperations,
  title: 'Revise proposed operations',
  description: 'Revise an existing reviewable Gallery operation plan from user feedback.',
  usage:
    'Revise an existing reviewable Gallery operation plan by providing planId, summary, and replacement operations.',
  argumentModes: [planIdMode, planningMode],
  examples: revisePlanningExamples,
  commonMistakes: [
    {
      id: 'planning-revision-missing-plan-id',
      match: { missingField: 'planId', requestShape: 'tool-arguments' },
      hint: 'Revisions must include the planId returned by the previous proposed plan.',
      exampleName: 'revise-add-assets-to-existing-album',
    },
    ...revisePlanningCommonMistakes,
  ],
  safety,
};

const summarizePlanContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.SummarizePlan,
  title: 'Summarize plan',
  description: 'Summarize an existing Gallery operation plan for user review.',
  usage: 'Summarize an existing reviewable Gallery operation plan by providing planId and optional focus.',
  argumentModes: [planIdMode],
  examples: [
    {
      name: 'summarize-plan',
      description: 'Summarize the whole plan.',
      arguments: { planId: examplePlanId },
    },
    {
      name: 'summarize-plan-risks',
      description: 'Summarize plan risks and selected changes.',
      arguments: { planId: examplePlanId, focus: 'risks and selected changes' },
    },
  ],
  commonMistakes: [
    {
      id: 'planning-tool-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put the planning tool arguments object at params.arguments in the MCP tools/call request.',
      exampleName: 'summarize-plan',
    },
    {
      id: 'planning-tool-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object with planId and optional focus.',
      exampleName: 'summarize-plan',
    },
    {
      id: 'planning-summary-missing-plan-id',
      match: { missingField: 'planId', requestShape: 'tool-arguments' },
      hint: 'Summaries must include the planId returned by the proposed plan.',
      exampleName: 'summarize-plan',
    },
  ],
  safety,
};

const planningToolContracts: AgentMcpPlanningToolContract[] = [
  proposeAlbumFromSearchContract,
  proposeAddAssetsToAlbumFromSearchContract,
  proposeSpaceFromSearchContract,
  proposeAddAssetsToSpaceFromSearchContract,
  proposeAssetBatchFromSearchContract,
  proposeAlbumFromSelectionContract,
  proposeAssetBatchFromSelectionContract,
  proposeAlbumOperationsContract,
  reviseProposedOperationsContract,
  summarizePlanContract,
];

const toolCallRequest = (id: string, name: string, args: unknown): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: {
    name,
    arguments: args,
  },
});

const toolCallRequestWithParams = (id: string, params: Record<string, unknown>): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params,
});

const oversizedAssetIds = Array.from(
  { length: 10_001 },
  (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
);

const slice1RuntimeFailureMatrixCases: AgentMcpFailureMatrixCase[] = [
  {
    id: 'read-input-instead-of-arguments',
    category: 'request-wrapper',
    description: 'Model sends params.input instead of params.arguments.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequestWithParams('read-input-instead-of-arguments', {
      name: AgentToolName.ReadAssetMetadata,
      input: { assetIds: [exampleAssetId] },
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-missing',
  },
  {
    id: 'read-top-level-arguments',
    category: 'request-wrapper',
    description: 'Model sends arguments outside params.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: {
      ...toolCallRequestWithParams('read-top-level-arguments', { name: AgentToolName.ReadAssetMetadata }),
      arguments: { assetIds: [exampleAssetId] },
    },
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-missing',
  },
  {
    id: 'read-arguments-array',
    category: 'request-wrapper',
    description: 'Model sends params.arguments as an array instead of an object.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('read-arguments-array', AgentToolName.ReadAssetMetadata, [exampleAssetId]),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-not-object',
  },
  {
    id: 'read-arguments-primitive',
    category: 'request-wrapper',
    description: 'Model sends params.arguments as a primitive string instead of an object.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('read-arguments-primitive', AgentToolName.ReadAssetMetadata, 'not-an-object'),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-not-object',
  },
  {
    id: 'read-arguments-null',
    category: 'request-wrapper',
    description: 'Model sends params.arguments as null instead of an object.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('read-arguments-null', AgentToolName.ReadAssetMetadata, null),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-not-object',
  },
  {
    id: 'asset-read-combined-asset-ids-and-tool-call-id',
    category: 'read-retry',
    description: 'Model combines new request ids with approved retry id.',
    toolName: AgentToolName.ReadAssetPreviews,
    request: toolCallRequest('asset-read-combined-asset-ids-and-tool-call-id', AgentToolName.ReadAssetPreviews, {
      assetIds: [exampleAssetId],
      toolCallId: exampleToolCallId,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'asset-read-combined-asset-ids-and-tool-call-id',
  },
  {
    id: 'asset-read-missing-asset-ids-or-tool-call-id',
    category: 'read-request',
    description: 'Model sends an empty asset read argument object.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-missing-asset-ids-or-tool-call-id', AgentToolName.ReadAssetMetadata, {}),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'asset-read-missing-asset-ids-or-tool-call-id',
  },
  {
    id: 'asset-read-empty-asset-ids',
    category: 'read-request',
    description: 'Model sends an empty asset id array.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-empty-asset-ids', AgentToolName.ReadAssetMetadata, { assetIds: [] }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'assetIds' },
    expectedContractMistakeId: 'asset-read-empty-asset-ids',
  },
  {
    id: 'asset-read-invalid-asset-id',
    category: 'read-request',
    description: 'Model sends a non-UUID asset id.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-invalid-asset-id', AgentToolName.ReadAssetMetadata, {
      assetIds: ['not-a-uuid'],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'assetIds.0' },
    expectedContractMistakeId: 'asset-read-invalid-asset-id',
  },
  {
    id: 'asset-read-duplicate-asset-ids',
    category: 'read-request',
    description: 'Model sends duplicate asset ids.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-duplicate-asset-ids', AgentToolName.ReadAssetMetadata, {
      assetIds: [exampleAssetId, exampleAssetId],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'assetIds' },
    expectedContractMistakeId: 'asset-read-duplicate-asset-ids',
  },
  {
    id: 'asset-read-too-many-asset-ids',
    category: 'read-request',
    description: 'Model sends more asset ids than the read-tool maximum.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-too-many-asset-ids', AgentToolName.ReadAssetMetadata, {
      assetIds: oversizedAssetIds,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'assetIds' },
    expectedContractMistakeId: 'asset-read-too-many-asset-ids',
  },
  {
    id: 'read-album-missing-album-id-or-tool-call-id',
    category: 'album-read',
    description: 'Model sends an empty readAlbum argument object.',
    toolName: AgentToolName.ReadAlbum,
    request: toolCallRequest('read-album-missing-album-id-or-tool-call-id', AgentToolName.ReadAlbum, {}),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'read-album-missing-album-id-or-tool-call-id',
  },
  {
    id: 'read-album-combined-album-id-and-tool-call-id',
    category: 'album-read',
    description: 'Model combines albumId and toolCallId.',
    toolName: AgentToolName.ReadAlbum,
    request: toolCallRequest('read-album-combined-album-id-and-tool-call-id', AgentToolName.ReadAlbum, {
      albumId: exampleAlbumId,
      toolCallId: exampleToolCallId,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'read-album-combined-album-id-and-tool-call-id',
  },
  {
    id: 'read-album-invalid-album-id',
    category: 'album-read',
    description: 'Model sends a non-UUID album id.',
    toolName: AgentToolName.ReadAlbum,
    request: toolCallRequest('read-album-invalid-album-id', AgentToolName.ReadAlbum, { albumId: 'not-a-uuid' }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'albumId' },
    expectedContractMistakeId: 'read-album-invalid-album-id',
  },
  {
    id: 'list-spaces-unexpected-space-id',
    category: 'space-read',
    description: 'Model sends a space id to listSpaces instead of using readSpace for detail.',
    toolName: AgentToolName.ListSpaces,
    request: toolCallRequest('list-spaces-unexpected-space-id', AgentToolName.ListSpaces, {
      spaceId: exampleSpaceId,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'list-spaces-unexpected-space-id',
  },
  {
    id: 'read-space-missing-space-id-or-tool-call-id',
    category: 'space-read',
    description: 'Model sends an empty readSpace argument object.',
    toolName: AgentToolName.ReadSpace,
    request: toolCallRequest('read-space-missing-space-id-or-tool-call-id', AgentToolName.ReadSpace, {}),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'read-space-missing-space-id-or-tool-call-id',
  },
  {
    id: 'read-space-combined-space-id-and-tool-call-id',
    category: 'space-read',
    description: 'Model combines spaceId and approved retry toolCallId.',
    toolName: AgentToolName.ReadSpace,
    request: toolCallRequest('read-space-combined-space-id-and-tool-call-id', AgentToolName.ReadSpace, {
      spaceId: exampleSpaceId,
      toolCallId: exampleToolCallId,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'read-space-combined-space-id-and-tool-call-id',
  },
  {
    id: 'read-space-wrong-id-field',
    category: 'space-read',
    description: 'Model uses a name-like field instead of the spaceId returned by listSpaces.',
    toolName: AgentToolName.ReadSpace,
    request: toolCallRequest('read-space-wrong-id-field', AgentToolName.ReadSpace, { spaceName: 'Family' }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'read-space-wrong-id-field',
  },
  {
    id: 'read-space-invalid-space-id',
    category: 'space-read',
    description: 'Model sends a non-UUID shared space id.',
    toolName: AgentToolName.ReadSpace,
    request: toolCallRequest('read-space-invalid-space-id', AgentToolName.ReadSpace, { spaceId: 'not-a-uuid' }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'spaceId' },
    expectedContractMistakeId: 'read-space-invalid-space-id',
  },
  {
    id: 'search-filters-outside-filters',
    category: 'search',
    description: 'Model puts date or location filters at the argument root.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-filters-outside-filters', AgentToolName.SearchAssets, {
      city: 'Berlin',
      country: 'Germany',
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'search-filters-outside-filters',
  },
  {
    id: 'search-combined-filters-and-tool-call-id',
    category: 'search',
    description: 'Model combines search filters and approved retry id.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-combined-filters-and-tool-call-id', AgentToolName.SearchAssets, {
      filters: { isFavorite: true },
      toolCallId: exampleToolCallId,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'search-combined-filters-and-tool-call-id',
  },
  {
    id: 'search-limit-out-of-range',
    category: 'search',
    description: 'Model requests more than the maximum search limit.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-limit-out-of-range', AgentToolName.SearchAssets, { limit: 10_001 }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'limit' },
    expectedContractMistakeId: 'search-limit-out-of-range',
  },
  {
    id: 'invented-apply-tool',
    category: 'safety',
    description: 'Model invents a direct apply tool.',
    request: toolCallRequest('invented-apply-tool', 'applyAlbumOperations', {
      planId: '00000000-0000-4000-8000-000000000222',
      operationIds: ['00000000-0000-4000-8000-000000000333'],
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
];

const slice4PlanningFailureMatrixCases: AgentMcpFailureMatrixCase[] = [
  {
    id: 'planning-missing-arguments',
    category: 'planning-wrapper',
    description: 'Model omits params.arguments for a planning tool.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequestWithParams('planning-missing-arguments', { name: AgentToolName.ProposeAlbumOperations }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'planning-tool-arguments-missing',
  },
  {
    id: 'planning-missing-new-album-dependency',
    category: 'planning-dependency',
    description: 'Model references a new album temporary target without a matching create operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-missing-new-album-dependency', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add to a missing new album.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add photos to missing album.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-missing-album',
          assetIds: [exampleAssetId],
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.temporaryTargetId' },
    expectedContractMistakeId: 'planning-missing-temporary-target-dependency',
  },
  {
    id: 'planning-missing-new-space-dependency',
    category: 'planning-dependency',
    description: 'Model references a new space temporary target without a matching create operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-missing-new-space-dependency', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add to a missing new space.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add photos to missing space.',
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId: 'tmp-missing-space',
          assetIds: [exampleAssetId],
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.temporaryTargetId' },
    expectedContractMistakeId: 'planning-missing-temporary-target-dependency',
  },
  {
    id: 'planning-wrong-album-target-kind',
    category: 'planning-target',
    description: 'Model uses a space target for an album operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-wrong-album-target-kind', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add album assets with wrong target.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: exampleSpaceId,
          assetIds: [exampleAssetId],
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetKind' },
    expectedContractMistakeId: 'planning-wrong-album-target-kind',
  },
  {
    id: 'planning-wrong-space-target-kind',
    category: 'planning-target',
    description: 'Model uses an album target for a space operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-wrong-space-target-kind', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add space assets with wrong target.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId],
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetKind' },
    expectedContractMistakeId: 'planning-wrong-space-target-kind',
  },
  {
    id: 'planning-existing-space-missing-target-id',
    category: 'planning-target',
    description: 'Model proposes an existing-space asset operation without targetId.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-existing-space-missing-target-id', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add photos to Family space.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add photos to Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          assetIds: [exampleAssetId],
          payload: {},
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetId' },
    expectedContractMistakeId: 'planning-existing-space-missing-target-id',
  },
  {
    id: 'planning-existing-space-with-temporary-target',
    category: 'planning-target',
    description: 'Model uses temporaryTargetId on an existing-space asset operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-existing-space-with-temporary-target', AgentToolName.ProposeAlbumOperations, {
      summary: 'Remove photos from Family space.',
      operations: [
        {
          type: AgentOperationType.SpaceRemoveAssets,
          summary: 'Remove photos from Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: exampleSpaceId,
          temporaryTargetId: 'tmp-family-space',
          assetIds: [exampleAssetId],
          payload: {},
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.temporaryTargetId' },
    expectedContractMistakeId: 'planning-existing-space-with-temporary-target',
  },
  {
    id: 'planning-space-update-empty-payload',
    category: 'planning-payload',
    description: 'Model proposes a space detail update without any supported update fields.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-space-update-empty-payload', AgentToolName.ProposeAlbumOperations, {
      summary: 'Update Family space.',
      operations: [
        {
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Update Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: exampleSpaceId,
          payload: {},
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.payload' },
    expectedContractMistakeId: 'planning-space-update-empty-payload',
  },
  {
    id: 'planning-space-update-unsupported-fields',
    category: 'planning-payload',
    description: 'Model proposes unsupported fields for a space detail update.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-space-update-unsupported-fields', AgentToolName.ProposeAlbumOperations, {
      summary: 'Update Family space thumbnail.',
      operations: [
        {
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Update Family space thumbnail.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: exampleSpaceId,
          payload: { thumbnailAssetId: exampleAssetId },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.payload' },
    expectedContractMistakeId: 'planning-space-update-unsupported-fields',
  },
  {
    id: 'planning-space-update-missing-target-id',
    category: 'planning-target',
    description: 'Model proposes an existing-space detail update without targetId.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-space-update-missing-target-id', AgentToolName.ProposeAlbumOperations, {
      summary: 'Rename Family space.',
      operations: [
        {
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Rename Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          payload: { spaceName: 'Family 2026' },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetId' },
    expectedContractMistakeId: 'planning-space-update-missing-target-id',
  },
  {
    id: 'planning-wrong-asset-batch-target-kind',
    category: 'planning-target',
    description: 'Model uses an album target for an asset batch operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-wrong-asset-batch-target-kind', AgentToolName.ProposeAlbumOperations, {
      summary: 'Favorite with wrong target.',
      operations: [
        {
          type: AgentOperationType.AssetSetFavorite,
          summary: 'Favorite selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId],
          payload: { favorite: true },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetKind' },
    expectedContractMistakeId: 'planning-wrong-asset-batch-target-kind',
  },
  {
    id: 'planning-wrong-image-edit-target-kind',
    category: 'planning-target',
    description: 'Model uses an album target for an image edit operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-wrong-image-edit-target-kind', AgentToolName.ProposeAlbumOperations, {
      summary: 'Rotate with wrong target.',
      operations: [
        {
          type: AgentOperationType.AssetRotate,
          summary: 'Rotate selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId],
          payload: { angle: 90 },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetKind' },
    expectedContractMistakeId: 'planning-wrong-image-edit-target-kind',
  },
  {
    id: 'planning-duplicate-asset-ids',
    category: 'planning-payload',
    description: 'Model repeats the same asset id inside one planning operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-duplicate-asset-ids', AgentToolName.ProposeAlbumOperations, {
      summary: 'Favorite duplicate photos.',
      operations: [
        {
          type: AgentOperationType.AssetSetFavorite,
          summary: 'Favorite selected photos.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [exampleAssetId, exampleAssetId],
          payload: { favorite: true },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.assetIds' },
    expectedContractMistakeId: 'planning-duplicate-asset-ids',
  },
  {
    id: 'planning-invalid-rotate-angle',
    category: 'planning-payload',
    description: 'Model uses an unsupported rotate angle.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-invalid-rotate-angle', AgentToolName.ProposeAlbumOperations, {
      summary: 'Rotate badly.',
      operations: [
        {
          type: AgentOperationType.AssetRotate,
          summary: 'Rotate selected photos.',
          targetKind: AgentOperationTargetKind.ImageEditBatch,
          assetIds: [exampleAssetId],
          payload: { angle: 45 },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.payload.angle' },
    expectedContractMistakeId: 'planning-invalid-rotate-angle',
  },
  {
    id: 'planning-invalid-tag-payload',
    category: 'planning-payload',
    description: 'Model provides both tagId and tagName for an add-tag operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-invalid-tag-payload', AgentToolName.ProposeAlbumOperations, {
      summary: 'Tag ambiguously.',
      operations: [
        {
          type: AgentOperationType.AssetAddTag,
          summary: 'Add ambiguous tag.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [exampleAssetId],
          payload: { tagId: exampleTagId, tagName: 'Travel' },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.payload' },
    expectedContractMistakeId: 'planning-invalid-tag-payload',
  },
  {
    id: 'planning-invented-create-album-tool',
    category: 'planning-safety',
    description: 'Model invents a direct create album tool instead of proposing a plan.',
    request: toolCallRequest('planning-invented-create-album-tool', 'createAlbum', {
      albumName: "today's test",
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
  {
    id: 'planning-invented-add-assets-tool',
    category: 'planning-safety',
    description: 'Model invents a direct add assets tool instead of proposing a plan.',
    request: toolCallRequest('planning-invented-add-assets-tool', 'addAssetsToAlbum', {
      albumId: exampleAlbumId,
      assetIds: [exampleAssetId],
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
];

const slice7RuntimeFailureMatrixCases: AgentMcpFailureMatrixCase[] = [
  {
    id: 'search-root-taken-after-filter',
    category: 'search',
    description: 'Model puts a date filter at the search argument root instead of filters.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-root-taken-after-filter', AgentToolName.SearchAssets, {
      takenAfter: '2026-05-01T00:00:00.000Z',
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'search-filters-outside-filters',
  },
  {
    id: 'search-root-favorite-rating-filters',
    category: 'search',
    description: 'Model puts favorite and rating filters at the search argument root instead of filters.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-root-favorite-rating-filters', AgentToolName.SearchAssets, {
      isFavorite: true,
      rating: 5,
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'search-filters-outside-filters',
  },
  {
    id: 'search-tag-name-in-id-filter',
    category: 'search',
    description: 'Model passes a user-facing tag name where searchAssets requires tagIds.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-tag-name-in-id-filter', AgentToolName.SearchAssets, {
      filters: { tagIds: ['Travel'] },
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.tagIds.0' },
    expectedContractMistakeId: 'search-filter-name-in-tag-ids',
  },
  {
    id: 'search-album-name-in-id-filter',
    category: 'search',
    description: 'Model passes a user-facing album name where searchAssets requires albumIds.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-album-name-in-id-filter', AgentToolName.SearchAssets, {
      filters: { albumIds: ['Family'] },
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.albumIds.0' },
    expectedContractMistakeId: 'search-filter-name-in-album-ids',
  },
  {
    id: 'search-person-name-in-id-filter',
    category: 'search',
    description: 'Model passes a user-facing person name where searchAssets requires personIds.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-person-name-in-id-filter', AgentToolName.SearchAssets, {
      filters: { personIds: ['Alex'] },
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.personIds.0' },
    expectedContractMistakeId: 'search-filter-name-in-person-ids',
  },
  {
    id: 'search-space-name-in-id-filter',
    category: 'search',
    description: 'Model passes a user-facing space name where searchAssets requires spaceId.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-space-name-in-id-filter', AgentToolName.SearchAssets, {
      filters: { spaceId: 'Family' },
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.spaceId' },
    expectedContractMistakeId: 'search-filter-name-in-space-id',
  },
  {
    id: 'search-query-with-metadata-mode',
    category: 'search',
    description: 'Model sends a text query while leaving searchAssets in metadata mode.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-query-with-metadata-mode', AgentToolName.SearchAssets, {
      mode: 'metadata',
      query: 'invoice',
      filters: {},
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'query' },
    expectedContractMistakeId: 'search-query-with-metadata-mode',
  },
  {
    id: 'search-space-person-without-space',
    category: 'search',
    description: 'Model uses shared-space person ids without choosing the shared space.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-space-person-without-space', AgentToolName.SearchAssets, {
      filters: { spacePersonIds: [exampleSpacePersonId] },
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.spacePersonIds' },
    expectedContractMistakeId: 'search-space-person-without-space',
  },
  {
    id: 'search-fields-with-tool-call-id',
    category: 'read-retry',
    description: 'Model retries an approved search while also sending fresh search fields.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-fields-with-tool-call-id', AgentToolName.SearchAssets, {
      toolCallId: exampleToolCallId,
      filters: { isFavorite: true },
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'search-combined-filters-and-tool-call-id',
  },
  {
    id: 'pi-prefixed-search-tool-name',
    category: 'safety',
    description: 'Model sends the Pi-visible prefixed search name as the MCP tool name.',
    request: toolCallRequest('pi-prefixed-search-tool-name', 'mcp_gallery_searchAssets', {
      filters: { isFavorite: true },
      limit: 25,
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
  {
    id: 'pi-prefixed-planning-tool-name',
    category: 'planning-safety',
    description: 'Model sends the Pi-visible prefixed planning name as the MCP tool name.',
    request: toolCallRequest('pi-prefixed-planning-tool-name', 'mcp_gallery_proposeAlbumOperations', {
      summary: 'Create today test album.',
      operations: createAlbumAndAddAssetsExample.arguments.operations,
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
  {
    id: 'invented-prefixed-apply-tool',
    category: 'planning-safety',
    description: 'Model invents a prefixed direct apply tool instead of proposing a reviewable plan.',
    request: toolCallRequest('invented-prefixed-apply-tool', 'mcp_gallery_applyAlbumOperations', {
      planId: examplePlanId,
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
  {
    id: 'planning-direct-add-assets-tool',
    category: 'planning-safety',
    description: 'Model invents a direct add-assets mutation tool instead of proposing a reviewable plan.',
    request: toolCallRequest('planning-direct-add-assets-tool', 'addAssetsToAlbum', {
      albumId: exampleAlbumId,
      assetIds: [exampleAssetId],
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
  {
    id: 'planning-dependent-add-assets-wrong-temporary-target-kind',
    category: 'planning-dependency',
    description: 'Model creates a space then references its temporary target from an album add-assets operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest(
      'planning-dependent-add-assets-wrong-temporary-target-kind',
      AgentToolName.ProposeAlbumOperations,
      {
        summary: 'Create space and incorrectly add album assets to it.',
        operations: [
          {
            type: AgentOperationType.SpaceCreate,
            summary: 'Create Family space.',
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-family-space',
            payload: { spaceName: 'Family', description: 'Shared family photos.', color: 'blue' },
          },
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos to the wrong temporary target kind.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-family-space',
            assetIds: [exampleAssetId],
          },
        ],
      },
    ),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.1.temporaryTargetId' },
    expectedContractMistakeId: 'planning-mismatched-temporary-target-kind',
  },
  {
    id: 'planning-dependent-set-cover-missing-new-album',
    category: 'planning-dependency',
    description: 'Model sets the cover for a new album without first creating that temporary album.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-dependent-set-cover-missing-new-album', AgentToolName.ProposeAlbumOperations, {
      summary: 'Set a cover for a missing new album.',
      operations: [
        {
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover photo.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-missing-album',
          assetIds: [exampleAssetId],
          payload: {},
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.temporaryTargetId' },
    expectedContractMistakeId: 'planning-missing-temporary-target-dependency',
  },
];

const cloneArguments = (args: Record<string, unknown> | undefined): Record<string, unknown> | undefined =>
  args === undefined ? undefined : structuredClone(args);

const mistakeSpecificity = (mistake: AgentMcpCommonMistake): number =>
  Number(Boolean(mistake.match.issuePath)) +
  Number(Boolean(mistake.match.messageIncludes)) +
  Number(Boolean(mistake.match.missingField)) +
  Number(Boolean(mistake.match.unexpectedField || mistake.match.unexpectedFields)) +
  Number(Boolean(mistake.match.requestShape));

const issueMatchesMessage = (issue: AgentMcpValidationIssue, messageIncludes: string | undefined): boolean =>
  !messageIncludes || issue.message.includes(messageIncludes);

const issueMatchesPath = (issue: AgentMcpValidationIssue, issuePath: string | undefined): boolean =>
  issuePath === undefined || issue.path === issuePath;

const mistakeMatchingIssue = (
  mistake: AgentMcpCommonMistake,
  request: AgentMcpValidationCorrectionRequest,
): AgentMcpValidationIssue | undefined => {
  const { match } = mistake;

  if (match.requestShape && match.requestShape !== request.requestShape) {
    return;
  }

  if (match.missingField) {
    return request.issues.find(
      (issue) =>
        issue.path === match.missingField &&
        (issue.message.includes('required') || issue.message.includes('Invalid input')),
    );
  }

  const unexpectedFields = match.unexpectedFields ?? (match.unexpectedField ? [match.unexpectedField] : undefined);

  if (unexpectedFields) {
    return request.issues.find(
      (issue) =>
        issueMatchesPath(issue, match.issuePath) &&
        issueMatchesMessage(issue, match.messageIncludes) &&
        unexpectedFields.some((field) => issue.message.includes(field)),
    );
  }

  return request.issues.find(
    (issue) => issueMatchesPath(issue, match.issuePath) && issueMatchesMessage(issue, match.messageIncludes),
  );
};

@Injectable()
export class AgentMcpToolContractService {
  listReadToolContracts(): AgentMcpReadToolContract[] {
    return structuredClone(readToolContracts);
  }

  listPlanningToolContracts(): AgentMcpPlanningToolContract[] {
    return structuredClone(planningToolContracts);
  }

  listToolContracts(): AgentMcpToolContract[] {
    return [...this.listReadToolContracts(), ...this.listPlanningToolContracts()];
  }

  getReadToolContract(name: AgentMcpReadToolName): AgentMcpReadToolContract | undefined {
    return this.listReadToolContracts().find((contract) => contract.name === name);
  }

  getPlanningToolContract(name: AgentMcpPlanningToolName): AgentMcpPlanningToolContract | undefined {
    return this.listPlanningToolContracts().find((contract) => contract.name === name);
  }

  listSlice1RuntimeFailureMatrixCases(): AgentMcpFailureMatrixCase[] {
    return structuredClone(slice1RuntimeFailureMatrixCases);
  }

  listSlice4PlanningFailureMatrixCases(): AgentMcpFailureMatrixCase[] {
    return structuredClone(slice4PlanningFailureMatrixCases);
  }

  listRuntimeFailureMatrixCases(): AgentMcpFailureMatrixCase[] {
    return structuredClone([
      ...slice1RuntimeFailureMatrixCases,
      ...slice4PlanningFailureMatrixCases,
      ...slice7RuntimeFailureMatrixCases,
    ]);
  }

  getReadToolValidationCorrection(
    name: AgentMcpReadToolName,
    request: AgentMcpValidationCorrectionRequest,
  ): AgentMcpValidationCorrection | undefined {
    const contract = this.getReadToolContract(name);
    if (!contract) {
      return;
    }

    return this.getValidationCorrection(contract, request);
  }

  getPlanningToolValidationCorrection(
    name: AgentMcpPlanningToolName,
    request: AgentMcpValidationCorrectionRequest,
  ): AgentMcpValidationCorrection | undefined {
    const contract = this.getPlanningToolContract(name);
    if (!contract) {
      return;
    }

    return this.getValidationCorrection(contract, request);
  }

  private getValidationCorrection(
    contract: AgentMcpToolContract,
    request: AgentMcpValidationCorrectionRequest,
  ): AgentMcpValidationCorrection {
    const matchingCorrection = contract.commonMistakes
      .map((mistake) => ({ mistake, issue: mistakeMatchingIssue(mistake, request) }))
      .filter((correction): correction is { mistake: AgentMcpCommonMistake; issue: AgentMcpValidationIssue } =>
        Boolean(correction.issue),
      )
      .toSorted((left, right) => mistakeSpecificity(right.mistake) - mistakeSpecificity(left.mistake))[0];

    if (!matchingCorrection) {
      const expected = this.compactValidationCorrectionText(contract.usage);
      return {
        expected,
        hint: expected,
        exampleArguments: cloneArguments(contract.examples[0]?.arguments),
      };
    }

    const { mistake: matchingMistake, issue: matchingIssue } = matchingCorrection;
    const example = matchingMistake.exampleName
      ? contract.examples.find((candidate) => candidate.name === matchingMistake.exampleName)
      : undefined;

    return {
      mistakeId: matchingMistake.id,
      issuePath: matchingIssue.path,
      expected: this.compactValidationCorrectionText(contract.usage),
      hint: matchingMistake.hint,
      exampleArguments: cloneArguments(example?.arguments),
    };
  }

  private compactValidationCorrectionText(text: string) {
    if (text.length <= validationCorrectionTextMaxLength) {
      return text;
    }

    return `${text.slice(0, validationCorrectionTextMaxLength - 3)}...`;
  }
}

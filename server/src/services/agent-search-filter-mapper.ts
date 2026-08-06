import { type AgentSearchAssetsToolRequestDto } from 'src/dtos/agent-tool.dto';
import { AssetOrder } from 'src/enum';
import {
  type AssetSearchOptions,
  type SearchPaginationOptions,
  type SmartSearchOptions,
} from 'src/repositories/search.repository';

type AgentSearchExecutionScope = {
  owned: boolean;
  sharedSpaces: boolean;
  locked: boolean;
  timelineSpaceIds: string[];
};

export type AgentMetadataSearchBuildInput = {
  userId: string;
  request: AgentSearchAssetsToolRequestDto;
  scope: AgentSearchExecutionScope;
};

export type AgentSearchBuildInput = AgentMetadataSearchBuildInput & {
  smartEmbedding?: string;
  smartMaxDistance?: number;
};

export type AgentMetadataSearchBuildResult = {
  pagination: SearchPaginationOptions;
  options: AssetSearchOptions;
};

export type AgentSearchBuildResult =
  | {
      kind: 'metadata';
      pagination: SearchPaginationOptions;
      options: AssetSearchOptions;
    }
  | {
      kind: 'smart';
      pagination: SearchPaginationOptions;
      options: SmartSearchOptions & { query: string };
    };

const nonEmpty = <T>(values: T[] | undefined): T[] | undefined => (values && values.length > 0 ? values : undefined);

const omitUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, property]) => property !== undefined)) as T;

const buildBaseSearch = ({ userId, request, scope }: AgentMetadataSearchBuildInput): AgentMetadataSearchBuildResult => {
  const filters = request.filters ?? {};
  const limit = request.limit ?? 10_000;
  const page = request.page ?? 1;
  const hasAlbumFilter = (filters.albumIds?.length ?? 0) > 0;
  const wantsBroadSharedScope = filters.spaceId
    ? false
    : filters.withSharedSpaces === true ||
      (!scope.owned && scope.sharedSpaces) ||
      (hasAlbumFilter && scope.sharedSpaces);
  const timelineSpaceIds = wantsBroadSharedScope ? scope.timelineSpaceIds : undefined;
  const hasTimelineSpaces = !!timelineSpaceIds && timelineSpaceIds.length > 0;

  const mappedFilters = omitUndefined({
    type: filters.type,
    isFavorite: filters.isFavorite,
    withDeleted: filters.isTrashed === true ? true : undefined,
    isNotInAlbum: filters.isNotInAlbum,
    takenAfter: filters.takenAfter,
    takenBefore: filters.takenBefore,
    createdAfter: filters.createdAfter,
    createdBefore: filters.createdBefore,
    updatedAfter: filters.updatedAfter,
    updatedBefore: filters.updatedBefore,
    city: filters.city,
    state: filters.state,
    country: filters.country,
    make: filters.make,
    model: filters.model,
    lensModel: filters.lensModel,
    rating: filters.rating,
    maxSharpness: filters.maxSharpness,
    maxBrightness: filters.maxBrightness,
    maxQuality: filters.maxQuality,
    tagIds: nonEmpty(filters.tagIds),
    tagMatchAny: filters.tagMatchAny,
    albumIds: nonEmpty(filters.albumIds),
    albumMatchAny: filters.albumMatchAny,
    personIds: nonEmpty(filters.personIds),
    personMatchAny: filters.personMatchAny,
    spaceId: filters.spaceId,
    spacePersonIds: nonEmpty(filters.spacePersonIds),
    visibility: filters.visibility,
  } satisfies Partial<AssetSearchOptions>);

  const options = omitUndefined({
    ...mappedFilters,
    orderDirection: request.order === 'asc' ? AssetOrder.Asc : AssetOrder.Desc,
    userIds: filters.spaceId ? undefined : scope.owned ? [userId] : wantsBroadSharedScope ? [] : [userId],
    timelineSpaceIds: hasTimelineSpaces ? timelineSpaceIds : undefined,
    forceEmptyResult: !scope.owned && wantsBroadSharedScope && !hasTimelineSpaces ? true : undefined,
  } satisfies Partial<AssetSearchOptions>) as AssetSearchOptions;

  return {
    pagination: { page, size: limit },
    options,
  };
};

export const buildAgentMetadataSearch = (input: AgentMetadataSearchBuildInput): AgentMetadataSearchBuildResult =>
  buildBaseSearch(input);

export const buildAgentSearch = (input: AgentSearchBuildInput): AgentSearchBuildResult => {
  const mode = input.request.mode ?? 'metadata';
  const baseSearch = buildBaseSearch(input);

  if (mode === 'smart') {
    if (input.request.query === undefined) {
      throw new Error('smart search requires query');
    }

    if (input.smartEmbedding === undefined) {
      throw new Error('smart search requires smartEmbedding');
    }

    const structuredFilters = omitUndefined({
      ...baseSearch.options,
      description: undefined,
      ocr: undefined,
      originalFileName: undefined,
      orderDirection: undefined,
    });
    const smartOrderDirection =
      input.request.order === 'asc' || input.request.order === 'desc' ? input.request.order : undefined;

    return {
      kind: 'smart',
      pagination: baseSearch.pagination,
      options: omitUndefined({
        ...structuredFilters,
        query: input.request.query,
        embedding: input.smartEmbedding,
        maxDistance: input.smartMaxDistance,
        orderDirection: smartOrderDirection,
      }) as SmartSearchOptions & { query: string },
    };
  }

  const textSearchOptions =
    mode === 'description'
      ? { description: input.request.query }
      : mode === 'ocr'
        ? { ocr: input.request.query }
        : mode === 'filename'
          ? { originalFileName: input.request.query }
          : {};

  return {
    kind: 'metadata',
    pagination: baseSearch.pagination,
    options: omitUndefined({
      ...baseSearch.options,
      ...textSearchOptions,
    }) as AssetSearchOptions,
  };
};

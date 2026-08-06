import { createZodDto, type ZodDto } from 'nestjs-zod';
import {
  AgentChoiceRefSchema,
  AgentSearchSourceRefSchema,
  getAgentChoiceRefKind,
} from 'src/dtos/agent-asset-source.dto';
import {
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AssetTypeSchema,
  AssetVisibilitySchema,
} from 'src/enum';
import { isoDateToDate, isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const MAX_ASSET_IDS_PER_TOOL_CALL = 10_000;
const MAX_TOOL_LIMIT = 10_000;
const DEFAULT_SEARCH_LIMIT = 100;
const MAX_SEARCH_SAMPLE_SIZE = 25;
const MAX_SELECTION_METADATA_SAMPLE_SIZE = 25;
const DEFAULT_SELECTION_METADATA_SAMPLE_SIZE = 10;
const MAX_CURATE_SELECTION_TARGET_COUNT = 1000;
const DEFAULT_CURATE_SELECTION_SAMPLE_SIZE = 10;
const MAX_USER_LOOKUP_LIMIT = 20;
const MAX_RESOLVE_FILTER_NAMES_PER_KIND = 20;
const MAX_RESOLVE_FILTER_NAME_LENGTH = 120;
const DEFAULT_SEARCH_MODE = 'metadata';
const DEFAULT_SEARCH_ORDER = 'desc';
const DEFAULT_SEARCH_PAGE = 1;
const DEFAULT_TRIP_LOOKBACK_DAYS = 180;
const MIN_TRIP_LOOKBACK_DAYS = 1;
const MAX_TRIP_LOOKBACK_DAYS = 365;
const DEFAULT_TRIP_MAX_CANDIDATES = 3;
const MIN_TRIP_MAX_CANDIDATES = 1;
const MAX_TRIP_MAX_CANDIDATES = 10;
const MAX_TRIP_PLACE_HINT_LENGTH = 80;
const MAX_TRIP_TARGET_DATE_FUTURE_MS = 24 * 60 * 60 * 1000;
const searchTextModes = new Set(['smart', 'description', 'ocr', 'filename']);
const uuid = z.uuidv4();
const summary = z.string().trim().min(1).max(1000);
const AgentToolApprovalDecisionSchema = z.enum(AgentToolApprovalDecision).meta({ id: 'AgentToolApprovalDecision' });
const AgentToolCallStatusSchema = z.enum(AgentToolCallStatus).meta({ id: 'AgentToolCallStatus' });
const AgentToolDataClassSchema = z.enum(AgentToolDataClass).meta({ id: 'AgentToolDataClass' });
const AgentToolNameSchema = z.enum(AgentToolName).meta({ id: 'AgentToolName' });
const AgentSearchAssetsModeSchema = z
  .enum(['metadata', 'smart', 'description', 'ocr', 'filename'])
  .meta({ id: 'AgentSearchAssetsMode' });
const AgentSearchAssetsOrderSchema = z.enum(['asc', 'desc', 'relevance']).meta({ id: 'AgentSearchAssetsOrder' });
const AgentSearchAssetsRequestDetailSchema = z
  .enum(['ids', 'handle', 'summary', 'metadata'])
  .meta({ id: 'AgentSearchAssetsRequestDetail' });
const AgentSearchAssetsResponseDetailSchema = z
  .enum(['handle', 'summary', 'metadata'])
  .meta({ id: 'AgentSearchAssetsDetail' });
const AgentAssetMetadataFieldValues = [
  'type',
  'dates',
  'location',
  'camera',
  'tags',
  'rating',
  'filename',
  'favorite',
  'visibility',
] as const;
const AgentReadAssetMetadataFieldValues = [...AgentAssetMetadataFieldValues, 'quality'] as const;
const AgentSearchAssetsFieldSchema = z.enum(AgentAssetMetadataFieldValues).meta({ id: 'AgentSearchAssetsField' });
const AgentAssetMetadataDetailSchema = z
  .enum(['basic', 'descriptive', 'technical', 'allSafe'])
  .meta({ id: 'AgentAssetMetadataDetail' });
const AgentAssetMetadataFieldSchema = z.enum(AgentReadAssetMetadataFieldValues).meta({ id: 'AgentAssetMetadataField' });
const AgentAssetMetadataQualitySchema = z
  .object({
    sharpness: z.number().int().nullable(),
    exposure: z.number().int().nullable(),
    brightness: z.number().int().nullable(),
    quality: z.number().int().nullable(),
  })
  .meta({ id: 'AgentAssetMetadataQuality' });
const AgentCurateSelectionStrategySchema = z
  .enum(['metadata-highlights', 'date-spread', 'favorites-first', 'cover-candidate'])
  .meta({ id: 'AgentCurateSelectionStrategy' });
const AgentCurateSelectionDiversifyBySchema = z
  .enum(['date', 'location', 'people', 'tags'])
  .meta({ id: 'AgentCurateSelectionDiversifyBy' });
const AgentCurateSelectionAssetTypeSchema = z.enum(['IMAGE', 'VIDEO']).meta({ id: 'AgentCurateSelectionAssetType' });
const AgentCurateSelectionConstraintsSchema = z
  .strictObject({
    types: z.array(AgentCurateSelectionAssetTypeSchema).min(1).max(2).optional(),
    includeFavorites: z.boolean().optional(),
    minRating: z.number().int().min(1).max(5).optional(),
    excludeVideos: z.boolean().optional(),
    diversifyBy: z.array(AgentCurateSelectionDiversifyBySchema).min(1).max(4).optional(),
    maxSharpness: z.number().int().min(0).max(100).optional(),
    maxBrightness: z.number().int().min(0).max(100).optional(),
    maxQuality: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.types && new Set(value.types).size !== value.types.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['types'], message: 'types must be unique' });
    }
    if (value.diversifyBy && new Set(value.diversifyBy).size !== value.diversifyBy.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diversifyBy'],
        message: 'diversifyBy values must be unique',
      });
    }
  })
  .meta({ id: 'AgentCurateSelectionConstraints' });
const DEFAULT_SELECTION_METADATA_FIELDS = [
  'type',
  'dates',
  'location',
  'camera',
  'tags',
  'rating',
  'filename',
  'favorite',
  'visibility',
] as const satisfies readonly z.output<typeof AgentAssetMetadataFieldSchema>[];
const resolverNameList = z
  .array(z.string().trim().min(1).max(MAX_RESOLVE_FILTER_NAME_LENGTH))
  .min(1)
  .max(MAX_RESOLVE_FILTER_NAMES_PER_KIND);

const assetIdRequest = (schemaId: string, missingMessage: string) =>
  z
    .object({
      assetIds: z.array(uuid).min(1).max(MAX_ASSET_IDS_PER_TOOL_CALL).optional(),
      toolCallId: uuid.optional(),
    })
    .superRefine((value, ctx) => {
      if (value.assetIds && value.toolCallId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide either assetIds or toolCallId, not both',
        });
      }

      if (!value.assetIds && !value.toolCallId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: missingMessage,
        });
      }

      if (value.assetIds && new Set(value.assetIds).size !== value.assetIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assetIds'],
          message: 'assetIds must be unique',
        });
      }
    })
    .meta({ id: schemaId });

const AgentReadAssetMetadataToolRequestSchema = z
  .strictObject({
    assetIds: z.array(uuid).min(1).max(MAX_ASSET_IDS_PER_TOOL_CALL).optional(),
    detail: AgentAssetMetadataDetailSchema.optional(),
    fields: z.array(AgentAssetMetadataFieldSchema).min(1).max(20).optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.assetIds && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either assetIds or toolCallId, not both',
      });
    }

    if ((value.detail || value.fields) && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either assetIds or toolCallId, not both',
      });
    }

    if (!value.assetIds && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide assetIds for a new tool request or toolCallId for an approved request',
      });
    }

    if (value.detail && value.fields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either detail or fields, not both',
      });
    }

    if (value.assetIds && new Set(value.assetIds).size !== value.assetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assetIds'],
        message: 'assetIds must be unique',
      });
    }

    if (value.fields && new Set(value.fields).size !== value.fields.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fields'],
        message: 'fields must be unique',
      });
    }
  })
  .transform((value) => {
    if (value.toolCallId) {
      return value;
    }

    return value.fields ? value : { ...value, detail: value.detail ?? 'basic' };
  })
  .meta({ id: 'AgentReadAssetMetadataToolRequestDto' });

const AgentReadSelectionMetadataToolRequestSchema = z
  .strictObject({
    selectionHandleId: uuid.optional(),
    fields: z.array(AgentAssetMetadataFieldSchema).min(1).max(20).optional(),
    sampleSize: z.number().int().min(0).max(MAX_SELECTION_METADATA_SAMPLE_SIZE).optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.selectionHandleId && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either selectionHandleId or toolCallId, not both',
      });
    }

    if ((value.fields || value.sampleSize !== undefined) && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either selectionHandleId or toolCallId, not both',
      });
    }

    if (!value.selectionHandleId && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide selectionHandleId for a new tool request or toolCallId for an approved request',
      });
    }

    if (value.fields && new Set(value.fields).size !== value.fields.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields must be unique' });
    }
  })
  .transform((value) => {
    if (value.toolCallId) {
      return value;
    }

    return {
      ...value,
      fields: value.fields ?? [...DEFAULT_SELECTION_METADATA_FIELDS],
      sampleSize: value.sampleSize ?? DEFAULT_SELECTION_METADATA_SAMPLE_SIZE,
    };
  })
  .meta({ id: 'AgentReadSelectionMetadataToolRequestDto' });

const AgentCurateSelectionToolRequestSchema = z
  .strictObject({
    selectionHandleId: uuid.optional(),
    targetCount: z.number().int().min(1).max(MAX_CURATE_SELECTION_TARGET_COUNT).optional(),
    strategy: AgentCurateSelectionStrategySchema.optional(),
    criteria: z.string().trim().min(1).max(500).optional(),
    constraints: AgentCurateSelectionConstraintsSchema.optional(),
    sampleSize: z.number().int().min(0).max(MAX_SELECTION_METADATA_SAMPLE_SIZE).optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.selectionHandleId && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either selectionHandleId or toolCallId, not both',
      });
    }
    if (
      (value.targetCount !== undefined ||
        value.strategy !== undefined ||
        value.criteria !== undefined ||
        value.constraints !== undefined ||
        value.sampleSize !== undefined) &&
      value.toolCallId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either selectionHandleId or toolCallId, not both',
      });
    }
    if (!value.selectionHandleId && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide selectionHandleId and targetCount for a new curation request or toolCallId for an approved request',
      });
    }
    if (value.selectionHandleId && value.targetCount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetCount'], message: 'targetCount is required' });
    }
  })
  .transform((value) =>
    value.toolCallId
      ? value
      : {
          ...value,
          strategy: value.strategy ?? 'metadata-highlights',
          constraints: value.constraints ?? {},
          sampleSize: value.sampleSize ?? DEFAULT_CURATE_SELECTION_SAMPLE_SIZE,
        },
  )
  .meta({ id: 'AgentCurateSelectionToolRequestDto' });

const AgentReadAssetPreviewsToolRequestSchema = assetIdRequest(
  'AgentReadAssetPreviewsToolRequestDto',
  'Provide assetIds for a new tool request or toolCallId for an approved request',
);

const AgentReadAssetOriginalsToolRequestSchema = assetIdRequest(
  'AgentReadAssetOriginalsToolRequestDto',
  'Provide assetIds for a new tool request or toolCallId for an approved request',
);

const AgentSearchAssetsFilterFields = {
  takenAfter: isoDatetimeToDate.optional(),
  takenBefore: isoDatetimeToDate.optional(),
  createdAfter: isoDatetimeToDate.optional(),
  createdBefore: isoDatetimeToDate.optional(),
  updatedAfter: isoDatetimeToDate.optional(),
  updatedBefore: isoDatetimeToDate.optional(),
  city: z.string().trim().nullable().optional(),
  state: z.string().trim().nullable().optional(),
  country: z.string().trim().nullable().optional(),
  make: z.string().trim().nullable().optional(),
  model: z.string().trim().nullable().optional(),
  lensModel: z.string().trim().nullable().optional(),
  isFavorite: z.boolean().optional(),
  isTrashed: z.boolean().optional(),
  isNotInAlbum: z.boolean().optional(),
  type: AssetTypeSchema.optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  maxSharpness: z.number().int().min(0).max(100).optional(),
  maxBrightness: z.number().int().min(0).max(100).optional(),
  maxQuality: z.number().int().min(0).max(100).optional(),
  tagIds: z.array(uuid).optional(),
  tagMatchAny: z.boolean().optional(),
  albumIds: z.array(uuid).optional(),
  albumMatchAny: z.boolean().optional(),
  personIds: z.array(uuid).optional(),
  personMatchAny: z.boolean().optional(),
  spaceId: uuid.optional(),
  spacePersonIds: z.array(uuid).optional(),
  withSharedSpaces: z.boolean().optional(),
  visibility: AssetVisibilitySchema.optional(),
};

const validateSearchAssetsFilterCrossFields = (
  value: Pick<
    z.output<z.ZodObject<typeof AgentSearchAssetsFilterFields>>,
    'spaceId' | 'spacePersonIds' | 'withSharedSpaces'
  >,
  ctx: z.RefinementCtx,
) => {
  if (value.spacePersonIds?.length && !value.spaceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['spacePersonIds'],
      message: 'spacePersonIds requires spaceId',
    });
  }

  if (value.spaceId && value.withSharedSpaces) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['withSharedSpaces'],
      message: 'Cannot use both spaceId and withSharedSpaces',
    });
  }
};

const AgentSearchAssetsFiltersSchema = z
  .strictObject(AgentSearchAssetsFilterFields)
  .superRefine(validateSearchAssetsFilterCrossFields)
  .meta({ id: 'AgentSearchAssetsFilters' });

const AgentPartialSearchAssetsFiltersSchema = z
  .strictObject(AgentSearchAssetsFilterFields)
  .partial()
  .superRefine(validateSearchAssetsFilterCrossFields)
  .meta({ id: 'AgentPartialSearchAssetsFilters' });

type AgentSearchAssetsToolRequestOutput = {
  mode?: z.output<typeof AgentSearchAssetsModeSchema>;
  query?: string;
  filters?: z.output<typeof AgentSearchAssetsFiltersSchema>;
  limit?: number;
  page?: number;
  order?: z.output<typeof AgentSearchAssetsOrderSchema>;
  detail?: z.output<typeof AgentSearchAssetsRequestDetailSchema>;
  fields?: z.output<typeof AgentSearchAssetsFieldSchema>[];
  sampleSize?: number;
  createSelectionHandle?: boolean;
  toolCallId?: string;
};

const AgentSearchAssetsToolRequestSchema = z
  .strictObject({
    mode: AgentSearchAssetsModeSchema.optional(),
    query: z.string().trim().min(1).max(500).optional(),
    filters: AgentSearchAssetsFiltersSchema.optional(),
    limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
    page: z.number().int().min(1).optional(),
    order: AgentSearchAssetsOrderSchema.optional(),
    detail: AgentSearchAssetsRequestDetailSchema.optional(),
    fields: z.array(AgentSearchAssetsFieldSchema).optional(),
    sampleSize: z.number().int().min(0).max(MAX_SEARCH_SAMPLE_SIZE).optional(),
    createSelectionHandle: z.boolean().optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    const mode = value.mode ?? DEFAULT_SEARCH_MODE;
    const hasNewSearchFields =
      value.filters !== undefined ||
      value.limit !== undefined ||
      value.query !== undefined ||
      value.page !== undefined ||
      value.order !== undefined ||
      value.mode !== undefined ||
      value.detail !== undefined ||
      value.fields !== undefined ||
      value.sampleSize !== undefined ||
      value.createSelectionHandle !== undefined;

    if (value.toolCallId && hasNewSearchFields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either search fields or toolCallId, not both',
      });
    }

    if (mode === 'metadata' && value.query !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query'],
        message: 'query is only supported for smart, description, ocr, and filename search modes',
      });
    }

    if (searchTextModes.has(mode) && value.query === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query'],
        message: `${mode} search requires a non-empty query`,
      });
    }
  })
  .transform((value): AgentSearchAssetsToolRequestOutput => {
    if (value.toolCallId) {
      return value;
    }

    const mode = value.mode ?? DEFAULT_SEARCH_MODE;
    const order = value.order ?? (mode === 'smart' ? undefined : DEFAULT_SEARCH_ORDER);
    const request = {
      mode,
      filters: value.filters ?? {},
      limit: value.limit ?? DEFAULT_SEARCH_LIMIT,
      page: value.page ?? DEFAULT_SEARCH_PAGE,
      detail: value.detail ?? 'handle',
      fields: value.fields ?? [],
      ...(value.createSelectionHandle === undefined ? {} : { createSelectionHandle: value.createSelectionHandle }),
      ...(value.sampleSize === undefined ? {} : { sampleSize: value.sampleSize }),
      ...(order === undefined ? {} : { order }),
    };

    return value.query === undefined ? request : { ...request, query: value.query };
  })
  .meta({ id: 'AgentSearchAssetsToolRequestDto' });

type AgentFindTripCandidatesToolRequestOutput = {
  placeHint?: string;
  targetDate?: Date;
  lookbackDays?: number;
  maxCandidates?: number;
  toolCallId?: string;
};

const AgentTripTargetDateSchema = z
  .string()
  .refine((value) => isoDatetimeToDate.safeParse(value).success || isoDateToDate.safeParse(value).success, {
    message: 'Invalid input: expected ISO date (YYYY-MM-DD) or ISO datetime string',
  })
  .transform((value) => {
    const datetime = isoDatetimeToDate.safeParse(value);
    return datetime.success ? datetime.data : isoDateToDate.parse(value);
  })
  .refine((targetDate) => targetDate.getTime() <= Date.now() + MAX_TRIP_TARGET_DATE_FUTURE_MS, {
    message: 'targetDate must not be more than one day in the future',
  })
  .meta({ example: '2024-01-01' });

const AgentFindTripCandidatesToolRequestSchema = z
  .strictObject({
    placeHint: z.string().trim().min(1).max(MAX_TRIP_PLACE_HINT_LENGTH).optional(),
    targetDate: AgentTripTargetDateSchema.optional(),
    lookbackDays: z.number().int().min(MIN_TRIP_LOOKBACK_DAYS).max(MAX_TRIP_LOOKBACK_DAYS).optional(),
    maxCandidates: z.number().int().min(MIN_TRIP_MAX_CANDIDATES).max(MAX_TRIP_MAX_CANDIDATES).optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    const hasTripSearchFields =
      value.placeHint !== undefined ||
      value.targetDate !== undefined ||
      value.lookbackDays !== undefined ||
      value.maxCandidates !== undefined;

    if (value.toolCallId && hasTripSearchFields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either trip search fields or toolCallId, not both',
      });
    }
  })
  .transform((value): AgentFindTripCandidatesToolRequestOutput => {
    if (value.toolCallId) {
      return value;
    }

    return {
      ...(value.placeHint === undefined ? {} : { placeHint: value.placeHint }),
      ...(value.targetDate === undefined ? {} : { targetDate: value.targetDate }),
      lookbackDays: value.lookbackDays ?? DEFAULT_TRIP_LOOKBACK_DAYS,
      maxCandidates: value.maxCandidates ?? DEFAULT_TRIP_MAX_CANDIDATES,
    };
  })
  .meta({ id: 'AgentFindTripCandidatesToolRequestDto' });

const AgentResolveAssetSearchFiltersScopeSchema = z
  .strictObject({
    spaceId: uuid.optional(),
    withSharedSpaces: z.boolean().optional(),
    takenAfter: isoDatetimeToDate.optional(),
    takenBefore: isoDatetimeToDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.spaceId && value.withSharedSpaces) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['withSharedSpaces'],
        message: 'Cannot use both scope.spaceId and scope.withSharedSpaces',
      });
    }
  })
  .meta({ id: 'AgentResolveAssetSearchFiltersScope' });

const AgentResolveAssetSearchFiltersToolRequestSchema = z
  .strictObject({
    people: resolverNameList.optional(),
    tags: resolverNameList.optional(),
    albums: resolverNameList.optional(),
    spaces: resolverNameList.optional(),
    cameraMakes: resolverNameList.optional(),
    cameraModels: resolverNameList.optional(),
    lensModels: resolverNameList.optional(),
    scope: AgentResolveAssetSearchFiltersScopeSchema.optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    const resolverNameFields = [
      value.people,
      value.tags,
      value.albums,
      value.spaces,
      value.cameraMakes,
      value.cameraModels,
      value.lensModels,
    ];
    const hasResolverNameField = resolverNameFields.some((field) => field !== undefined);
    const hasResolverField = hasResolverNameField || value.scope !== undefined;

    if (value.toolCallId && hasResolverField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either resolver fields or toolCallId, not both',
      });
    }

    if (!value.toolCallId && !hasResolverNameField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one resolver field',
      });
    }
  })
  .meta({ id: 'AgentResolveAssetSearchFiltersToolRequestDto' });

const AgentListAlbumsToolRequestSchema = z
  .strictObject({
    toolCallId: uuid.optional(),
  })
  .meta({ id: 'AgentListAlbumsToolRequestDto' });

const AgentReadAlbumToolRequestSchema = z
  .strictObject({
    albumId: uuid.optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.albumId && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either albumId or toolCallId, not both',
      });
    }

    if (!value.albumId && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide albumId for a new tool request or toolCallId for an approved request',
      });
    }
  })
  .meta({ id: 'AgentReadAlbumToolRequestDto' });

const AgentListSpacesToolRequestSchema = z
  .strictObject({
    toolCallId: uuid.optional().describe('Approved tool call id when retrying after user approval'),
  })
  .meta({ id: 'AgentListSpacesToolRequestDto' });

const DEFAULT_DUPLICATE_GROUPS_LIMIT = 50;
const MAX_DUPLICATE_GROUPS_LIMIT = 500;

const AgentListDuplicateGroupsToolRequestSchema = z
  .strictObject({
    maxGroups: z
      .number()
      .int()
      .min(1)
      .max(MAX_DUPLICATE_GROUPS_LIMIT)
      .optional()
      .describe(`Maximum number of duplicate groups to return (default ${DEFAULT_DUPLICATE_GROUPS_LIMIT})`),
    toolCallId: uuid.optional().describe('Approved tool call id when retrying after user approval'),
  })
  .meta({ id: 'AgentListDuplicateGroupsToolRequestDto' });

const AgentReadSpaceToolRequestSchema = z
  .strictObject({
    spaceId: uuid.optional().describe('Shared space id to inspect'),
    toolCallId: uuid.optional().describe('Approved tool call id when retrying after user approval'),
  })
  .superRefine((value, ctx) => {
    if (value.spaceId && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either spaceId or toolCallId, not both',
      });
    }

    if (!value.spaceId && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide spaceId, or retry an approved tool call with toolCallId',
      });
    }
  })
  .meta({ id: 'AgentReadSpaceToolRequestDto' });

const AgentSearchUsersToolRequestSchema = z
  .strictObject({
    query: z.string().trim().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(MAX_USER_LOOKUP_LIMIT).optional(),
    toolCallId: uuid.optional().describe('Approved tool call id when retrying after user approval'),
  })
  .superRefine((value, ctx) => {
    if (value.toolCallId && (value.query !== undefined || value.limit !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either user search fields or toolCallId, not both',
      });
    }
  })
  .transform((value) => (value.toolCallId ? value : { query: value.query ?? '', limit: value.limit ?? 20 }))
  .meta({ id: 'AgentSearchUsersToolRequestDto' });

const AgentResolveLocationToolRequestSchema = z
  .strictObject({
    query: z.string().trim().min(1).max(200).optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.toolCallId && value.query !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either query or toolCallId, not both',
      });
    }
    if (!value.toolCallId && !value.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide a query string to forward-geocode',
      });
    }
  })
  .meta({ id: 'AgentResolveLocationToolRequestDto' });

const AgentSearchPeopleToolRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    toolCallId: uuid.optional(),
    includeHidden: z
      .boolean()
      .optional()
      .describe('Set to true to include hidden people in results (for unhide flows)'),
  })
  .superRefine((value, ctx) => {
    if (value.toolCallId && value.name !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either name or toolCallId, not both',
      });
    }
    if (!value.toolCallId && !value.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide a name string to search for a person',
      });
    }
  })
  .meta({ id: 'AgentSearchPeopleToolRequestDto' });

export const AgentReadToolRequestSchemas = {
  [AgentToolName.SearchAssets]: AgentSearchAssetsToolRequestSchema,
  [AgentToolName.FindTripCandidates]: AgentFindTripCandidatesToolRequestSchema,
  [AgentToolName.ReadSelectionMetadata]: AgentReadSelectionMetadataToolRequestSchema,
  [AgentToolName.CurateSelection]: AgentCurateSelectionToolRequestSchema,
  [AgentToolName.ResolveAssetSearchFilters]: AgentResolveAssetSearchFiltersToolRequestSchema,
  [AgentToolName.ReadAssetMetadata]: AgentReadAssetMetadataToolRequestSchema,
  [AgentToolName.ReadAssetPreviews]: AgentReadAssetPreviewsToolRequestSchema,
  [AgentToolName.ReadAssetOriginals]: AgentReadAssetOriginalsToolRequestSchema,
  [AgentToolName.ListAlbums]: AgentListAlbumsToolRequestSchema,
  [AgentToolName.ReadAlbum]: AgentReadAlbumToolRequestSchema,
  [AgentToolName.ListSpaces]: AgentListSpacesToolRequestSchema,
  [AgentToolName.ReadSpace]: AgentReadSpaceToolRequestSchema,
  [AgentToolName.SearchUsers]: AgentSearchUsersToolRequestSchema,
  [AgentToolName.ListDuplicateGroups]: AgentListDuplicateGroupsToolRequestSchema,
  [AgentToolName.ResolveLocation]: AgentResolveLocationToolRequestSchema,
  [AgentToolName.SearchPeople]: AgentSearchPeopleToolRequestSchema,
} as const;

const AgentToolApprovalSchema = z
  .object({
    decision: AgentToolApprovalDecisionSchema,
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .meta({ id: 'AgentToolApprovalDto' });

const AgentAssetMetadataExifSchema = z
  .object({
    dateTimeOriginal: isoDatetimeToDate.nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    lensModel: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    rating: z.number().int().nullable(),
  })
  .meta({ id: 'AgentAssetMetadataExif' });

const AgentAssetMetadataTagSchema = z
  .object({
    id: uuid,
    value: z.string(),
    color: z.string().nullable(),
  })
  .meta({ id: 'AgentAssetMetadataTag' });

const AgentToolResultSizeSchema = z
  .object({
    returnedItems: z.number().int().min(0),
    hasMore: z.boolean(),
    nextPage: z.string().nullable(),
    estimatedBytes: z.number().int().min(0).nullable(),
    truncated: z.boolean(),
    omittedFields: z.array(z.string().trim().min(1)).max(50),
  })
  .meta({ id: 'AgentToolResultSize' });

const AgentToolCallResponseSchema = z
  .object({
    id: uuid,
    sessionId: uuid,
    toolName: AgentToolNameSchema,
    status: AgentToolCallStatusSchema,
    approvalDecision: AgentToolApprovalDecisionSchema.nullable(),
    requestSummary: summary,
    responseSummary: summary.nullable(),
    dataClass: AgentToolDataClassSchema,
    assetCount: z.number().int().min(0),
    albumCount: z.number().int().min(0),
    startedAt: isoDatetimeToDate,
    completedAt: isoDatetimeToDate.nullable(),
    error: z.string().nullable(),
    resultSize: AgentToolResultSizeSchema.optional(),
  })
  .meta({ id: 'AgentToolCallResponseDto' });

export const AgentAssetMetadataSchema = z
  .object({
    id: uuid,
    ownerId: uuid,
    type: AssetTypeSchema,
    originalFileName: z.string(),
    localDateTime: isoDatetimeToDate,
    fileCreatedAt: isoDatetimeToDate,
    fileModifiedAt: isoDatetimeToDate,
    isFavorite: z.boolean(),
    visibility: AssetVisibilitySchema,
    exifInfo: AgentAssetMetadataExifSchema.nullable(),
    tags: z.array(AgentAssetMetadataTagSchema),
  })
  .meta({ id: 'AgentAssetMetadata' });

const AgentAssetMetadataResultFields = {
  id: uuid,
  type: AssetTypeSchema.optional(),
  originalFileName: z.string().optional(),
  localDateTime: isoDatetimeToDate.optional(),
  fileCreatedAt: isoDatetimeToDate.optional(),
  fileModifiedAt: isoDatetimeToDate.optional(),
  isFavorite: z.boolean().optional(),
  visibility: AssetVisibilitySchema.optional(),
  exifInfo: AgentAssetMetadataExifSchema.partial().nullable().optional(),
  tags: z.array(AgentAssetMetadataTagSchema).optional(),
  qualityInfo: AgentAssetMetadataQualitySchema.nullable().optional(),
};

const AgentAssetMetadataResultSchema = z
  .object(AgentAssetMetadataResultFields)
  .meta({ id: 'AgentAssetMetadataResult' });

const AgentAssetMediaReferenceSchema = z
  .object({
    assetId: uuid,
    mediaUrl: z.string(),
    mimeType: z.string(),
    fileName: z.string(),
    width: z.number().int().min(0).nullable(),
    height: z.number().int().min(0).nullable(),
  })
  .meta({ id: 'AgentAssetMediaReference' });

const AgentAlbumSummarySchema = z
  .object({
    id: uuid,
    albumName: z.string(),
    description: z.string(),
    ownerId: uuid,
    assetCount: z.number().int().min(0),
    startDate: isoDatetimeToDate.nullable(),
    endDate: isoDatetimeToDate.nullable(),
    albumThumbnailAssetId: uuid.nullable(),
  })
  .meta({ id: 'AgentAlbumSummary' });

const AgentAlbumUserSummarySchema = z
  .object({
    userId: uuid,
    role: z.string(),
  })
  .meta({ id: 'AgentAlbumUserSummary' });

const AgentAlbumDetailSchema = AgentAlbumSummarySchema.extend({
  assetIds: z.array(uuid),
  albumUsers: z.array(AgentAlbumUserSummarySchema),
}).meta({ id: 'AgentAlbumDetail' });

const AgentSpaceMemberSummarySchema = z
  .object({
    userId: uuid,
    name: z.string(),
    role: z.string(),
    avatarColor: z.string().nullable(),
    profileImagePath: z.string().nullable(),
  })
  .meta({ id: 'AgentSpaceMemberSummary' });

const AgentSpaceSummarySchema = z
  .object({
    id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    color: z.string(),
    createdById: uuid,
    assetCount: z.number().int().min(0),
    memberCount: z.number().int().min(0),
    thumbnailAssetId: uuid.nullable(),
    recentAssetIds: z.array(uuid),
  })
  .meta({ id: 'AgentSpaceSummary' });

const AgentSpaceDetailSchema = AgentSpaceSummarySchema.extend({
  members: z.array(AgentSpaceMemberSummarySchema),
  assetIds: z.array(uuid),
  assetIdsReturned: z.number().int().min(0),
  assetIdsTruncated: z.boolean(),
}).meta({ id: 'AgentSpaceDetail' });

const AgentUserLookupResultSchema = z
  .object({
    userId: uuid,
    name: z.string(),
    email: z.string().nullable(),
    avatarColor: z.string().nullable(),
    profileImagePath: z.string().nullable(),
  })
  .meta({ id: 'AgentUserLookupResult' });

const approvalRequiredResponse = (schemaId: string) =>
  z
    .object({
      status: z.literal('approval-required'),
      toolCall: AgentToolCallResponseSchema,
    })
    .meta({ id: schemaId });

const deniedResponse = (schemaId: string) =>
  z
    .object({
      status: z.literal('denied'),
      reason: z.string(),
      toolCall: AgentToolCallResponseSchema,
    })
    .meta({ id: schemaId });

const AgentReadAssetMetadataToolApprovalRequiredResponseSchema = z
  .object({
    status: z.literal('approval-required'),
    toolCall: AgentToolCallResponseSchema,
  })
  .meta({ id: 'AgentReadAssetMetadataToolApprovalRequiredResponse' });

const AgentReadAssetMetadataToolDeniedResponseSchema = z
  .object({
    status: z.literal('denied'),
    reason: z.string(),
    toolCall: AgentToolCallResponseSchema,
  })
  .meta({ id: 'AgentReadAssetMetadataToolDeniedResponse' });

const AgentReadAssetMetadataToolSuccessResponseSchema = z
  .object({
    status: z.literal('success'),
    toolCall: AgentToolCallResponseSchema,
    summary,
    detail: AgentAssetMetadataDetailSchema.optional(),
    fields: z.array(AgentAssetMetadataFieldSchema),
    resultSize: AgentToolResultSizeSchema,
    assets: z.array(AgentAssetMetadataResultSchema),
  })
  .meta({ id: 'AgentReadAssetMetadataToolSuccessResponse' });

const AgentReadAssetMetadataToolResponseSchema = z
  .discriminatedUnion('status', [
    AgentReadAssetMetadataToolApprovalRequiredResponseSchema,
    AgentReadAssetMetadataToolDeniedResponseSchema,
    AgentReadAssetMetadataToolSuccessResponseSchema,
  ])
  .meta({ id: 'AgentReadAssetMetadataToolResponseDto' });

const AgentSearchAssetsSelectionHandleSchema = z
  .object({
    id: uuid,
    sourceRef: AgentSearchSourceRefSchema,
    assetCount: z.number().int().min(0),
    sourceToolCallId: uuid.nullable(),
    expiresAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentSearchAssetsSelectionHandle' });

const AgentSearchAssetsSampleItemSchema = z
  .object({
    itemRef: z.string().regex(/^item:\d{3,}$/),
    type: AssetTypeSchema.optional(),
    originalFileName: z.string().optional(),
    localDateTime: isoDatetimeToDate.optional(),
    fileCreatedAt: isoDatetimeToDate.optional(),
    fileModifiedAt: isoDatetimeToDate.optional(),
    isFavorite: z.boolean().optional(),
    visibility: AssetVisibilitySchema.optional(),
    exifInfo: AgentAssetMetadataExifSchema.partial().nullable().optional(),
    tags: z.array(AgentAssetMetadataTagSchema.omit({ id: true })).optional(),
  })
  .meta({ id: 'AgentSearchAssetsSampleItem' });

const AgentSearchAssetsSampleSchema = z
  .object({
    sampleSize: z.number().int().min(0).max(MAX_SEARCH_SAMPLE_SIZE),
    items: z.array(AgentSearchAssetsSampleItemSchema).max(MAX_SEARCH_SAMPLE_SIZE),
  })
  .meta({ id: 'AgentSearchAssetsSample' });

const AgentReadSelectionMetadataCountsSchema = z
  .object({
    assets: z.number().int().min(0),
    sampled: z.number().int().min(0).max(MAX_SELECTION_METADATA_SAMPLE_SIZE),
  })
  .meta({ id: 'AgentReadSelectionMetadataCounts' });

const AgentReadSelectionMetadataToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentReadSelectionMetadataToolApprovalRequiredResponse'),
    deniedResponse('AgentReadSelectionMetadataToolDeniedResponse'),
    z
      .strictObject({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        summary,
        selectionHandle: AgentSearchAssetsSelectionHandleSchema,
        fields: z.array(AgentAssetMetadataFieldSchema),
        counts: AgentReadSelectionMetadataCountsSchema,
        sample: AgentSearchAssetsSampleSchema.optional(),
        resultSize: AgentToolResultSizeSchema,
      })
      .meta({ id: 'AgentReadSelectionMetadataToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentReadSelectionMetadataToolResponseDto' });

const AgentCurateSelectionToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentCurateSelectionToolApprovalRequiredResponse'),
    deniedResponse('AgentCurateSelectionToolDeniedResponse'),
    z
      .strictObject({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        summary,
        strategy: AgentCurateSelectionStrategySchema,
        selectionHandle: AgentSearchAssetsSelectionHandleSchema,
        sourceAssetCount: z.number().int().min(0),
        selectedAssetCount: z.number().int().min(0),
        criteriaSummary: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
        warnings: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
        sample: AgentSearchAssetsSampleSchema.optional(),
        resultSize: AgentToolResultSizeSchema,
      })
      .meta({ id: 'AgentCurateSelectionToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentCurateSelectionToolResponseDto' });

const AgentTripCandidateSummarySchema = z
  .strictObject({
    dedupeKey: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(300),
    subtitle: z.string().trim().min(1).max(300),
    countries: z.array(z.string().trim().min(1)).max(20),
    states: z.array(z.string().trim().min(1)).max(50),
    cities: z.array(z.string().trim().min(1)).max(50),
    takenAfter: isoDatetimeToDate,
    takenBefore: isoDatetimeToDate,
    assetCount: z.number().int().min(0),
    albumAssetCount: z.number().int().min(0),
    excludedDuplicateCount: z.number().int().min(0),
    excludedStackChildCount: z.number().int().min(0),
    dayCount: z.number().int().min(0),
    score: z.number().int().min(0),
    confidence: z.enum(['high', 'medium', 'low']).meta({ id: 'AgentTripCandidateConfidence' }),
    placeLabels: z.array(z.string().trim().min(1).max(300)).max(50),
    selectionHandle: AgentSearchAssetsSelectionHandleSchema,
  })
  .meta({ id: 'AgentTripCandidateSummary' });

const AgentTripCandidateUseTopRecommendationActionSchema = z
  .literal('use_top_candidate')
  .meta({ id: 'AgentTripCandidateUseTopRecommendationAction' });
const AgentTripCandidateNonAutoRecommendationActionSchema = z
  .enum(['ask_user', 'none'])
  .meta({ id: 'AgentTripCandidateNonAutoRecommendationAction' });

const AgentTripCandidateRecommendationSchema = z
  .discriminatedUnion('action', [
    z
      .strictObject({
        action: AgentTripCandidateUseTopRecommendationActionSchema,
        candidateDedupeKey: z.string().trim().min(1).max(300),
        reason: z.string().trim().min(1).max(300),
      })
      .meta({ id: 'AgentTripCandidateUseTopRecommendation' }),
    z
      .strictObject({
        action: AgentTripCandidateNonAutoRecommendationActionSchema,
        reason: z.string().trim().min(1).max(300),
      })
      .meta({ id: 'AgentTripCandidateNonAutoRecommendation' }),
  ])
  .meta({ id: 'AgentTripCandidateRecommendation' });

const AgentFindTripCandidatesToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentFindTripCandidatesToolApprovalRequiredResponse'),
    deniedResponse('AgentFindTripCandidatesToolDeniedResponse'),
    z
      .strictObject({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        summary,
        recommendation: AgentTripCandidateRecommendationSchema,
        candidates: z.array(AgentTripCandidateSummarySchema).max(MAX_TRIP_MAX_CANDIDATES),
        resultSize: AgentToolResultSizeSchema,
      })
      .meta({ id: 'AgentFindTripCandidatesToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentFindTripCandidatesToolResponseDto' });

const AgentSearchAssetsToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentSearchAssetsToolApprovalRequiredResponse'),
    deniedResponse('AgentSearchAssetsToolDeniedResponse'),
    z
      .strictObject({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        summary,
        detail: AgentSearchAssetsResponseDetailSchema,
        selectionHandle: AgentSearchAssetsSelectionHandleSchema,
        sample: AgentSearchAssetsSampleSchema.optional(),
        returnedCount: z.number().int().min(0),
        hasMore: z.boolean(),
        nextPage: z.string().nullable(),
        resultSize: AgentToolResultSizeSchema,
        totalCount: z.number().int().min(0).optional(),
        approximateTotal: z.number().int().min(0).optional(),
      })
      .meta({ id: 'AgentSearchAssetsToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentSearchAssetsToolResponseDto' });

export const AgentResolvedAssetSearchFilterChoiceSchema = z
  .object({
    id: uuid.optional(),
    choiceRef: AgentChoiceRefSchema.optional(),
    value: z.string(),
    label: z.string(),
    searchFilter: AgentPartialSearchAssetsFiltersSchema.optional(),
  })
  .meta({ id: 'AgentResolvedAssetSearchFilterChoice' });

export const AgentResolvedAssetSearchFilterResultSchema = z
  .object({
    kind: z.enum(['person', 'tag', 'album', 'space', 'cameraMake', 'cameraModel', 'lensModel']),
    query: z.string(),
    status: z.enum(['matched', 'ambiguous', 'not_found']),
    value: z.string().optional(),
    id: uuid.optional(),
    searchFilter: AgentPartialSearchAssetsFiltersSchema.optional(),
    choices: z.array(AgentResolvedAssetSearchFilterChoiceSchema),
    message: z.string(),
  })
  .superRefine((result, ctx) => {
    for (const [index, choice] of result.choices.entries()) {
      if (choice.choiceRef && getAgentChoiceRefKind(choice.choiceRef) !== result.kind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['choices', index, 'choiceRef'],
          message: 'choiceRef kind must match result kind',
        });
      }
    }
  })
  .meta({ id: 'AgentResolvedAssetSearchFilterResult' });

const AgentResolveAssetSearchFiltersToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentResolveAssetSearchFiltersToolApprovalRequiredResponse'),
    deniedResponse('AgentResolveAssetSearchFiltersToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resolvedFilters: AgentSearchAssetsFiltersSchema,
        resultSize: AgentToolResultSizeSchema,
        results: z.array(AgentResolvedAssetSearchFilterResultSchema),
      })
      .meta({ id: 'AgentResolveAssetSearchFiltersToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentResolveAssetSearchFiltersToolResponseDto' });

const AgentReadAssetPreviewsToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentReadAssetPreviewsToolApprovalRequiredResponse'),
    deniedResponse('AgentReadAssetPreviewsToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        previews: z.array(AgentAssetMediaReferenceSchema),
      })
      .meta({ id: 'AgentReadAssetPreviewsToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentReadAssetPreviewsToolResponseDto' });

const AgentReadAssetOriginalsToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentReadAssetOriginalsToolApprovalRequiredResponse'),
    deniedResponse('AgentReadAssetOriginalsToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        originals: z.array(AgentAssetMediaReferenceSchema),
      })
      .meta({ id: 'AgentReadAssetOriginalsToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentReadAssetOriginalsToolResponseDto' });

const AgentListAlbumsToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentListAlbumsToolApprovalRequiredResponse'),
    deniedResponse('AgentListAlbumsToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        albums: z.array(AgentAlbumSummarySchema),
      })
      .meta({ id: 'AgentListAlbumsToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentListAlbumsToolResponseDto' });

const AgentReadAlbumToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentReadAlbumToolApprovalRequiredResponse'),
    deniedResponse('AgentReadAlbumToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        album: AgentAlbumDetailSchema,
      })
      .meta({ id: 'AgentReadAlbumToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentReadAlbumToolResponseDto' });

const AgentListSpacesToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentListSpacesToolApprovalRequiredResponse'),
    deniedResponse('AgentListSpacesToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        spaces: z.array(AgentSpaceSummarySchema),
      })
      .meta({ id: 'AgentListSpacesToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentListSpacesToolResponseDto' });

const AgentDuplicateAssetSchema = z
  .object({
    id: uuid,
    originalFileName: z.string(),
    fileCreatedAt: isoDatetimeToDate,
    isFavorite: z.boolean(),
    rating: z.number().int().nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    sharpness: z.number().int().nullable(),
  })
  .meta({ id: 'AgentDuplicateAsset' });

const AgentDuplicateGroupSchema = z
  .object({
    duplicateId: uuid,
    assets: z.array(AgentDuplicateAssetSchema),
  })
  .meta({ id: 'AgentDuplicateGroup' });

const AgentListDuplicateGroupsToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentListDuplicateGroupsToolApprovalRequiredResponse'),
    deniedResponse('AgentListDuplicateGroupsToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        groups: z.array(AgentDuplicateGroupSchema),
      })
      .meta({ id: 'AgentListDuplicateGroupsToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentListDuplicateGroupsToolResponseDto' });

const AgentReadSpaceToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentReadSpaceToolApprovalRequiredResponse'),
    deniedResponse('AgentReadSpaceToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        space: AgentSpaceDetailSchema,
      })
      .meta({ id: 'AgentReadSpaceToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentReadSpaceToolResponseDto' });

const AgentSearchUsersToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentSearchUsersToolApprovalRequiredResponse'),
    deniedResponse('AgentSearchUsersToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        users: z.array(AgentUserLookupResultSchema),
      })
      .meta({ id: 'AgentSearchUsersToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentSearchUsersToolResponseDto' });

const AgentResolveLocationChoiceSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    label: z.string(),
    countryCode: z.string(),
  })
  .meta({ id: 'AgentResolveLocationChoice' });

const AgentResolveLocationResultSchema = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('not_found') }).meta({ id: 'AgentResolveLocationNotFoundResult' }),
    z
      .object({
        status: z.literal('matched'),
        latitude: z.number(),
        longitude: z.number(),
        label: z.string(),
      })
      .meta({ id: 'AgentResolveLocationMatchedResult' }),
    z
      .object({
        status: z.literal('ambiguous'),
        choices: z.array(AgentResolveLocationChoiceSchema).max(5),
      })
      .meta({ id: 'AgentResolveLocationAmbiguousResult' }),
  ])
  .meta({ id: 'AgentResolveLocationResult' });

const AgentResolveLocationToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentResolveLocationToolApprovalRequiredResponse'),
    deniedResponse('AgentResolveLocationToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        location: AgentResolveLocationResultSchema,
      })
      .meta({ id: 'AgentResolveLocationToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentResolveLocationToolResponseDto' });

const AgentSearchPeopleChoiceSchema = z
  .object({
    personId: z.string().uuid(),
    name: z.string(),
    thumbnailAssetId: z.string().uuid().nullable(),
  })
  .meta({ id: 'AgentSearchPeopleChoice' });

const AgentSearchPeopleResultSchema = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('not_found') }).meta({ id: 'AgentSearchPeopleNotFoundResult' }),
    z
      .object({
        status: z.literal('matched'),
        personId: z.string().uuid(),
        name: z.string(),
        thumbnailAssetId: z.string().uuid().nullable(),
      })
      .meta({ id: 'AgentSearchPeopleMatchedResult' }),
    z
      .object({
        status: z.literal('ambiguous'),
        choices: z.array(AgentSearchPeopleChoiceSchema).max(5),
      })
      .meta({ id: 'AgentSearchPeopleAmbiguousResult' }),
  ])
  .meta({ id: 'AgentSearchPeopleResult' });

const AgentSearchPeopleToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentSearchPeopleToolApprovalRequiredResponse'),
    deniedResponse('AgentSearchPeopleToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resultSize: AgentToolResultSizeSchema,
        people: AgentSearchPeopleResultSchema,
      })
      .meta({ id: 'AgentSearchPeopleToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentSearchPeopleToolResponseDto' });

const AgentToolCallParamsSchema = z
  .object({
    id: uuid,
    toolCallId: uuid,
  })
  .meta({ id: 'AgentToolCallParamsDto' });

const namedZodDto = <TSchema extends z.ZodType>(schemaName: string, schema: TSchema): ZodDto<TSchema, false> => {
  const dto = createZodDto(schema);
  Object.defineProperty(dto, 'name', { value: schemaName });
  return dto;
};

export class AgentReadAssetMetadataToolRequestDto extends createZodDto(AgentReadAssetMetadataToolRequestSchema) {}
export class AgentReadSelectionMetadataToolRequestDto extends createZodDto(
  AgentReadSelectionMetadataToolRequestSchema,
) {}
export class AgentCurateSelectionToolRequestDto extends createZodDto(AgentCurateSelectionToolRequestSchema) {}
export class AgentSearchAssetsToolRequestDto extends createZodDto(AgentSearchAssetsToolRequestSchema) {}
export class AgentFindTripCandidatesToolRequestDto extends createZodDto(AgentFindTripCandidatesToolRequestSchema) {}
export class AgentResolveAssetSearchFiltersToolRequestDto extends createZodDto(
  AgentResolveAssetSearchFiltersToolRequestSchema,
) {}
export class AgentReadAssetPreviewsToolRequestDto extends createZodDto(AgentReadAssetPreviewsToolRequestSchema) {}
export class AgentReadAssetOriginalsToolRequestDto extends createZodDto(AgentReadAssetOriginalsToolRequestSchema) {}
export class AgentListAlbumsToolRequestDto extends createZodDto(AgentListAlbumsToolRequestSchema) {}
export class AgentReadAlbumToolRequestDto extends createZodDto(AgentReadAlbumToolRequestSchema) {}
export class AgentListSpacesToolRequestDto extends createZodDto(AgentListSpacesToolRequestSchema) {}
export class AgentReadSpaceToolRequestDto extends createZodDto(AgentReadSpaceToolRequestSchema) {}
export class AgentSearchUsersToolRequestDto extends createZodDto(AgentSearchUsersToolRequestSchema) {}
export class AgentListDuplicateGroupsToolRequestDto extends createZodDto(AgentListDuplicateGroupsToolRequestSchema) {}
export class AgentResolveLocationToolRequestDto extends createZodDto(AgentResolveLocationToolRequestSchema) {}
export class AgentSearchPeopleToolRequestDto extends createZodDto(AgentSearchPeopleToolRequestSchema) {}
export class AgentToolApprovalDto extends createZodDto(AgentToolApprovalSchema) {}
export class AgentToolCallResponseDto extends createZodDto(AgentToolCallResponseSchema) {}
export class AgentToolCallParamsDto extends createZodDto(AgentToolCallParamsSchema) {}
export const AgentReadAssetMetadataToolResponseDto = namedZodDto(
  'AgentReadAssetMetadataToolResponseDto',
  AgentReadAssetMetadataToolResponseSchema,
);
export type AgentReadAssetMetadataToolResponseDto = z.output<typeof AgentReadAssetMetadataToolResponseSchema>;
export const AgentReadSelectionMetadataToolResponseDto = namedZodDto(
  'AgentReadSelectionMetadataToolResponseDto',
  AgentReadSelectionMetadataToolResponseSchema,
);
export type AgentReadSelectionMetadataToolResponseDto = z.output<typeof AgentReadSelectionMetadataToolResponseSchema>;
export const AgentCurateSelectionToolResponseDto = namedZodDto(
  'AgentCurateSelectionToolResponseDto',
  AgentCurateSelectionToolResponseSchema,
);
export type AgentCurateSelectionToolResponseDto = z.output<typeof AgentCurateSelectionToolResponseSchema>;
export const AgentSearchAssetsToolResponseDto = namedZodDto(
  'AgentSearchAssetsToolResponseDto',
  AgentSearchAssetsToolResponseSchema,
);
export type AgentSearchAssetsToolResponseDto = z.output<typeof AgentSearchAssetsToolResponseSchema>;
export const AgentFindTripCandidatesToolResponseDto = namedZodDto(
  'AgentFindTripCandidatesToolResponseDto',
  AgentFindTripCandidatesToolResponseSchema,
);
export type AgentFindTripCandidatesToolResponseDto = z.output<typeof AgentFindTripCandidatesToolResponseSchema>;
export const AgentResolveAssetSearchFiltersToolResponseDto = namedZodDto(
  'AgentResolveAssetSearchFiltersToolResponseDto',
  AgentResolveAssetSearchFiltersToolResponseSchema,
);
export type AgentResolveAssetSearchFiltersToolResponseDto = z.output<
  typeof AgentResolveAssetSearchFiltersToolResponseSchema
>;
export const AgentReadAssetPreviewsToolResponseDto = namedZodDto(
  'AgentReadAssetPreviewsToolResponseDto',
  AgentReadAssetPreviewsToolResponseSchema,
);
export type AgentReadAssetPreviewsToolResponseDto = z.output<typeof AgentReadAssetPreviewsToolResponseSchema>;
export const AgentReadAssetOriginalsToolResponseDto = namedZodDto(
  'AgentReadAssetOriginalsToolResponseDto',
  AgentReadAssetOriginalsToolResponseSchema,
);
export type AgentReadAssetOriginalsToolResponseDto = z.output<typeof AgentReadAssetOriginalsToolResponseSchema>;
export const AgentListAlbumsToolResponseDto = namedZodDto(
  'AgentListAlbumsToolResponseDto',
  AgentListAlbumsToolResponseSchema,
);
export type AgentListAlbumsToolResponseDto = z.output<typeof AgentListAlbumsToolResponseSchema>;
export const AgentReadAlbumToolResponseDto = namedZodDto(
  'AgentReadAlbumToolResponseDto',
  AgentReadAlbumToolResponseSchema,
);
export type AgentReadAlbumToolResponseDto = z.output<typeof AgentReadAlbumToolResponseSchema>;
export const AgentListSpacesToolResponseDto = namedZodDto(
  'AgentListSpacesToolResponseDto',
  AgentListSpacesToolResponseSchema,
);
export type AgentListSpacesToolResponseDto = z.output<typeof AgentListSpacesToolResponseSchema>;
export const AgentReadSpaceToolResponseDto = namedZodDto(
  'AgentReadSpaceToolResponseDto',
  AgentReadSpaceToolResponseSchema,
);
export type AgentReadSpaceToolResponseDto = z.output<typeof AgentReadSpaceToolResponseSchema>;
export const AgentSearchUsersToolResponseDto = namedZodDto(
  'AgentSearchUsersToolResponseDto',
  AgentSearchUsersToolResponseSchema,
);
export type AgentSearchUsersToolResponseDto = z.output<typeof AgentSearchUsersToolResponseSchema>;
export const AgentListDuplicateGroupsToolResponseDto = namedZodDto(
  'AgentListDuplicateGroupsToolResponseDto',
  AgentListDuplicateGroupsToolResponseSchema,
);
export type AgentListDuplicateGroupsToolResponseDto = z.output<typeof AgentListDuplicateGroupsToolResponseSchema>;
export const AgentResolveLocationToolResponseDto = namedZodDto(
  'AgentResolveLocationToolResponseDto',
  AgentResolveLocationToolResponseSchema,
);
export type AgentResolveLocationToolResponseDto = z.output<typeof AgentResolveLocationToolResponseSchema>;
export const AgentSearchPeopleToolResponseDto = namedZodDto(
  'AgentSearchPeopleToolResponseDto',
  AgentSearchPeopleToolResponseSchema,
);
export type AgentSearchPeopleToolResponseDto = z.output<typeof AgentSearchPeopleToolResponseSchema>;

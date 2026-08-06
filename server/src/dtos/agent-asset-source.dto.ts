import { createZodDto } from 'nestjs-zod';
import { AssetTypeSchema, AssetVisibilitySchema } from 'src/enum';
import z from 'zod';

export const AGENT_SOURCE_REF_PREFIX = 'asset-source:';

const uuid = z.uuidv4();
const sourceRefToken = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);
const sourceRefKind = z.enum(['search', 'selection']);
const namedFilterName = z.string().trim().min(1).max(120);
const namedFilterNames = z.array(namedFilterName).min(1).max(20);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AgentSourceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^asset-source:(search|selection):[A-Za-z0-9_-]{8,120}$/, {
    message: 'sourceRef must use the asset-source:<kind>:<token> format',
  })
  .meta({ id: 'AgentSourceRef' });

export const AgentSearchSourceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^asset-source:search:[A-Za-z0-9_-]{8,120}$/, {
    message: 'sourceRef must use the asset-source:search:<token> format',
  })
  .meta({ id: 'AgentSearchSourceRef' });

export const AgentChoiceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^choice:(person|tag|album|space|cameraMake|cameraModel|lensModel):[A-Za-z0-9_-]{8,120}$/, {
    message: 'choiceRef must use the choice:<kind>:<token> format',
  })
  .refine((choiceRef) => !uuidPattern.test(choiceRef.split(':')[2] ?? ''), {
    message: 'choiceRef token must not be a UUID',
  })
  .meta({ id: 'AgentChoiceRef' });

export const getAgentChoiceRefKind = (choiceRef: string): string | null =>
  choiceRef.match(/^choice:([^:]+):/)?.[1] ?? null;

export const isAgentChoiceRef = (value: unknown): value is string =>
  typeof value === 'string' && AgentChoiceRefSchema.safeParse(value).success;

const uniqueChoiceRefs = z
  .array(AgentChoiceRefSchema)
  .max(20)
  .superRefine((choiceRefs, ctx) => {
    if (new Set(choiceRefs).size !== choiceRefs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'choiceRefs must be unique',
      });
    }
  });

export const AgentDeclarativeNameMatchSchema = z.enum(['any', 'all']).meta({ id: 'AgentDeclarativeNameMatch' });

export const AgentDeclarativeNamedFilterSchema = z
  .strictObject({
    match: AgentDeclarativeNameMatchSchema,
    names: namedFilterNames,
    choiceRefs: uniqueChoiceRefs.optional(),
  })
  .meta({ id: 'AgentDeclarativeNamedFilter' });

const AgentDeclarativeSpaceFilterSchema = z
  .strictObject({
    name: namedFilterName,
  })
  .meta({ id: 'AgentDeclarativeSpaceFilter' });

const AgentDeclarativeCameraFilterSchema = z
  .strictObject({
    make: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    lensModel: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => value.make !== undefined || value.model !== undefined || value.lensModel !== undefined, {
    message: 'Provide make, model, or lensModel',
  })
  .meta({ id: 'AgentDeclarativeCameraFilter' });

export const AgentDeclarativeAssetFiltersSchema = z
  .strictObject({
    takenAfter: z.iso.datetime().optional(),
    takenBefore: z.iso.datetime().optional(),
    country: z.string().trim().nullable().optional(),
    city: z.string().trim().nullable().optional(),
    state: z.string().trim().nullable().optional(),
    people: AgentDeclarativeNamedFilterSchema.optional(),
    tags: AgentDeclarativeNamedFilterSchema.optional(),
    albums: AgentDeclarativeNamedFilterSchema.optional(),
    space: AgentDeclarativeSpaceFilterSchema.optional(),
    camera: AgentDeclarativeCameraFilterSchema.optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    isFavorite: z.boolean().optional(),
    isNotInAlbum: z.boolean().optional(),
    type: AssetTypeSchema.optional(),
    visibility: AssetVisibilitySchema.optional(),
    withSharedSpaces: z.boolean().optional(),
  })
  .superRefine((filters, ctx) => {
    const fields = [
      ['people', 'person'],
      ['tags', 'tag'],
      ['albums', 'album'],
    ] as const;

    for (const [field, expectedKind] of fields) {
      const choiceRefs = filters[field]?.choiceRefs ?? [];
      for (const [index, choiceRef] of choiceRefs.entries()) {
        if (getAgentChoiceRefKind(choiceRef) !== expectedKind) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field, 'choiceRefs', index],
            message: `choiceRef kind must match ${field} filter`,
          });
        }
      }
    }
  })
  .meta({ id: 'AgentDeclarativeAssetFilters' });

const AgentSearchAssetSourceInputSchema = z
  .strictObject({
    kind: z.literal('search'),
    mode: z.enum(['metadata', 'smart', 'description', 'ocr', 'filename']).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    filters: AgentDeclarativeAssetFiltersSchema.optional(),
    order: z.enum(['asc', 'desc', 'relevance']).optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
    page: z.number().int().min(1).optional(),
    materialization: z.enum(['bounded-page', 'all-matches-with-limit']).optional(),
  })
  .meta({ id: 'AgentSearchAssetSourceInput' });

const AgentPreviousSearchAssetSourceInputSchema = z
  .strictObject({
    kind: z.literal('previousSearch'),
    sourceRef: AgentSearchSourceRefSchema,
  })
  .meta({ id: 'AgentPreviousSearchAssetSourceInput' });

const AgentSelectionHandleAssetSourceInputSchema = z
  .strictObject({
    kind: z.literal('selectionHandle'),
    selectionHandleId: uuid,
  })
  .meta({ id: 'AgentSelectionHandleAssetSourceInput' });

const uniqueAssetIds = z
  .array(uuid)
  .min(1)
  .max(10_000)
  .superRefine((assetIds, ctx) => {
    if (new Set(assetIds).size !== assetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'assetIds must be unique',
      });
    }
  });

const AgentExplicitAssetsAssetSourceInputSchema = z
  .strictObject({
    kind: z.literal('explicitAssets'),
    assetIds: uniqueAssetIds,
  })
  .meta({ id: 'AgentExplicitAssetsAssetSourceInput' });

export const AgentAssetSourceInputSchema = z
  .discriminatedUnion('kind', [
    AgentSearchAssetSourceInputSchema,
    AgentPreviousSearchAssetSourceInputSchema,
    AgentSelectionHandleAssetSourceInputSchema,
    AgentExplicitAssetsAssetSourceInputSchema,
  ])
  .meta({ id: 'AgentAssetSourceInput' });

export const AgentSourceResolutionStatusSchema = z
  .enum(['success', 'needs_clarification', 'recoverable_error', 'denied'])
  .meta({ id: 'AgentSourceResolutionStatus' });

export const buildAgentSourceRef = (kind: z.output<typeof sourceRefKind>, token: z.output<typeof sourceRefToken>) => {
  const sourceRef = `${AGENT_SOURCE_REF_PREFIX}${sourceRefKind.parse(kind)}:${sourceRefToken.parse(token)}`;

  return AgentSourceRefSchema.parse(sourceRef);
};

export const AgentAssetSourceInputDto = createZodDto(AgentAssetSourceInputSchema);

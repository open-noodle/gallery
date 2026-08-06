import { createZodDto } from 'nestjs-zod';
import { AgentAssetSourceInputSchema } from 'src/dtos/agent-asset-source.dto';
import { AgentToolCallResponseDto } from 'src/dtos/agent-tool.dto';
import {
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentToolName,
  AlbumUserRole,
  AssetVisibility,
  SharedSpaceRole,
  UserAvatarColorSchema,
} from 'src/enum';
import type { AgentAssetSourceInput } from 'src/types/agent-asset-source.types';
import { validateAgentAssetSourceMechanismCount } from 'src/types/agent-asset-source.types';
import { isoDatetimeToDate, latitudeSchema, longitudeSchema } from 'src/validation';
import z from 'zod';

const uuid = z.uuidv4();
const summary = z.string().trim().min(1).max(1000);
const temporaryTargetId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const emptyPayload = z.strictObject({}).optional();
const uniqueAssetIds = z
  .array(uuid)
  .min(1)
  .max(10_000)
  .superRefine((assetIds, ctx) => {
    if (new Set(assetIds).size !== assetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assetIds must be unique',
      });
    }
  });
const uniqueCoverAssetIds = z
  .array(uuid)
  .min(1)
  .max(500)
  .superRefine((assetIds, ctx) => {
    if (new Set(assetIds).size !== assetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assetIds must be unique',
      });
    }
  });
const assetSelectionHandleId = uuid;
const agentOperationPlanningAssetSourceInput = AgentAssetSourceInputSchema.superRefine((value, ctx) => {
  if (value.kind !== 'search' && value.kind !== 'previousSearch' && value.kind !== 'selectionHandle') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kind'],
      message: 'Invalid input: expected "search", "previousSearch", or "selectionHandle"',
    });
  }
}).meta({ id: 'AgentOperationPlanningAssetSourceInput' }) as z.ZodType<
  Extract<AgentAssetSourceInput, { kind: 'search' | 'previousSearch' | 'selectionHandle' }>
>;
const assetSelection = {
  assetSource: agentOperationPlanningAssetSourceInput.optional(),
  assetIds: uniqueAssetIds.optional(),
  assetSelectionHandleId: assetSelectionHandleId.optional(),
};
const coverAssetSelection = {
  assetSource: agentOperationPlanningAssetSourceInput.optional(),
  assetIds: uniqueCoverAssetIds.optional(),
  assetSelectionHandleId: assetSelectionHandleId.optional(),
};
const uniqueOperationIds = z
  .array(uuid)
  .min(1)
  .max(500)
  .superRefine((operationIds, ctx) => {
    if (new Set(operationIds).size !== operationIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'operationIds must be unique',
      });
    }
  });
const uniqueSelectionItemIds = (schema = z.array(uuid).max(10_000)) =>
  schema.superRefine((itemIds, ctx) => {
    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'itemIds must be unique',
      });
    }
  });
const requiredUniqueSelectionItemIds = uniqueSelectionItemIds(z.array(uuid).min(1).max(10_000));
const fieldOverrideValue = z.string();
const AgentOperationFieldOverrideSchema = z
  .record(z.string().trim().min(1).max(80), fieldOverrideValue)
  .superRefine((override, ctx) => {
    const keyCount = Object.keys(override).length;
    if (keyCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fieldOverrides must not be empty',
      });
    }

    if (keyCount > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fieldOverrides may contain at most 20 fields per operation',
      });
    }
  })
  .meta({ id: 'AgentOperationFieldOverride' });

const AgentOperationPlanStatusSchema = z.enum(AgentOperationPlanStatus).meta({ id: 'AgentOperationPlanStatus' });
const AgentOperationApplyStatusSchema = z.enum(AgentOperationApplyStatus).meta({ id: 'AgentOperationApplyStatus' });
const AgentOperationTypeSchema = z.enum(AgentOperationType).meta({ id: 'AgentOperationType' });
const AgentOperationTargetKindSchema = z.enum(AgentOperationTargetKind).meta({ id: 'AgentOperationTargetKind' });
const AgentOperationRiskLevelSchema = z.enum(AgentOperationRiskLevel).meta({ id: 'AgentOperationRiskLevel' });
const AgentOperationStatusSchema = z.enum(AgentOperationStatus).meta({ id: 'AgentOperationStatus' });
const AgentOperationItemKindSchema = z
  .enum(['asset', 'album', 'space', 'person', 'tag'])
  .meta({ id: 'AgentOperationItemKind' });

const AgentOperationItemSelectionSchema = z
  .discriminatedUnion('mode', [
    z.strictObject({
      itemKind: AgentOperationItemKindSchema,
      mode: z.literal('all'),
      itemIds: z.array(uuid).length(0).optional(),
    }),
    z.strictObject({
      itemKind: AgentOperationItemKindSchema,
      mode: z.literal('allExcept'),
      itemIds: requiredUniqueSelectionItemIds,
    }),
    z.strictObject({
      itemKind: AgentOperationItemKindSchema,
      mode: z.literal('only'),
      itemIds: requiredUniqueSelectionItemIds,
    }),
    z.strictObject({
      itemKind: AgentOperationItemKindSchema,
      mode: z.literal('none'),
      itemIds: z.array(uuid).length(0).optional(),
    }),
  ])
  .meta({ id: 'AgentOperationItemSelection' });

const operationDefaults = {
  riskLevel: AgentOperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.Low),
  enabled: z.boolean().optional().default(true),
};
const NewAlbumTargetKindSchema = z
  .literal(AgentOperationTargetKind.NewAlbum)
  .meta({ id: 'AgentOperationNewAlbumTargetKind' });
const ExistingAlbumTargetKindSchema = z
  .literal(AgentOperationTargetKind.ExistingAlbum)
  .meta({ id: 'AgentOperationExistingAlbumTargetKind' });
const NewSpaceTargetKindSchema = z
  .literal(AgentOperationTargetKind.NewSpace)
  .meta({ id: 'AgentOperationNewSpaceTargetKind' });
const ExistingSpaceTargetKindSchema = z
  .literal(AgentOperationTargetKind.ExistingSpace)
  .meta({ id: 'AgentOperationExistingSpaceTargetKind' });
const spaceDetailsPayload = z.strictObject({
  spaceName: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  color: UserAvatarColorSchema.optional(),
});

const createAlbumOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumCreate).meta({ id: 'AgentAlbumCreateOperationType' }),
    summary,
    targetKind: NewAlbumTargetKindSchema,
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({
      albumName: z.string().trim().min(1).max(200),
      description: z.string().trim().max(1000).optional().default(''),
    }),
  })
  .superRefine((operation, ctx) => {
    if (!operation.temporaryTargetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['temporaryTargetId'],
        message: 'Required',
      });
    }
  });

const addAssetsOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumAddAssets).meta({ id: 'AgentAlbumAddAssetsOperationType' }),
    summary,
    targetKind: AgentOperationTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    ...assetSelection,
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: emptyPayload,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateAlbumTarget(operation, ctx, [AgentOperationTargetKind.NewAlbum]);
  });

const removeAssetsOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumRemoveAssets).meta({ id: 'AgentAlbumRemoveAssetsOperationType' }),
    summary,
    targetKind: AgentOperationTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    ...assetSelection,
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: emptyPayload,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateAlbumTarget(operation, ctx);
  });

const updateDetailsOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumUpdateDetails).meta({ id: 'AgentAlbumUpdateDetailsOperationType' }),
    summary,
    targetKind: ExistingAlbumTargetKindSchema,
    targetId: uuid.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z
      .strictObject({
        albumName: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(1000).optional(),
      })
      .refine((payload) => payload.albumName !== undefined || payload.description !== undefined, {
        message: 'Provide albumName or description',
      }),
  })
  .superRefine((operation, ctx) => validateAlbumTarget(operation, ctx));

const setCoverOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumSetCover).meta({ id: 'AgentAlbumSetCoverOperationType' }),
    summary,
    targetKind: AgentOperationTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    ...coverAssetSelection,
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: emptyPayload,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateAlbumTarget(operation, ctx, [AgentOperationTargetKind.NewAlbum]);
  });

const createSpaceOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceCreate).meta({ id: 'AgentSpaceCreateOperationType' }),
    summary,
    targetKind: NewSpaceTargetKindSchema,
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: spaceDetailsPayload.extend({
      spaceName: z.string().trim().min(1).max(100),
    }),
  })
  .superRefine((operation, ctx) => {
    if (!operation.temporaryTargetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['temporaryTargetId'],
        message: 'Required',
      });
    }
  });

const spaceAssetsOperationSchema = (type: AgentOperationType.SpaceAddAssets | AgentOperationType.SpaceRemoveAssets) =>
  z
    .strictObject({
      type: z.literal(type),
      summary,
      targetKind: AgentOperationTargetKindSchema,
      targetId: uuid.optional(),
      temporaryTargetId: temporaryTargetId.optional(),
      ...assetSelection,
      riskLevel: operationDefaults.riskLevel,
      enabled: operationDefaults.enabled,
      payload: emptyPayload,
    })
    .superRefine((operation, ctx) => {
      validateAssetSelection(operation, ctx);
      validateSpaceTarget(operation, ctx, [AgentOperationTargetKind.NewSpace]);
    });

const updateSpaceDetailsOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceUpdateDetails).meta({ id: 'AgentSpaceUpdateDetailsOperationType' }),
    summary,
    targetKind: ExistingSpaceTargetKindSchema,
    targetId: uuid.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: spaceDetailsPayload.refine(
      (payload) => payload.spaceName !== undefined || payload.description !== undefined || payload.color !== undefined,
      { message: 'Provide spaceName, description, or color' },
    ),
  })
  .superRefine((operation, ctx) => validateSpaceTarget(operation, ctx));

const AgentAssignableSharedSpaceRoleSchema = z
  .enum([SharedSpaceRole.Editor, SharedSpaceRole.Viewer])
  .meta({ id: 'AgentAssignableSharedSpaceMemberRole' });
const uniqueUserIds = z
  .array(uuid)
  .min(1)
  .max(100)
  .superRefine((userIds, ctx) => {
    if (new Set(userIds).size !== userIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'userIds must be unique' });
    }
  });
const memberPayloads = z
  .array(
    z.strictObject({
      userId: uuid,
      role: AgentAssignableSharedSpaceRoleSchema,
    }),
  )
  .min(1)
  .max(100)
  .superRefine((members, ctx) => {
    const userIds = members.map((member) => member.userId);
    if (new Set(userIds).size !== userIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'members must contain unique userIds' });
    }
  });

const spaceAddMembersOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceAddMembers).meta({ id: 'AgentSpaceAddMembersOperationType' }),
    summary,
    targetKind: ExistingSpaceTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({ members: memberPayloads }),
  })
  .superRefine((operation, ctx) => validateSpaceTarget(operation, ctx));

const spaceRemoveMembersOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceRemoveMembers).meta({ id: 'AgentSpaceRemoveMembersOperationType' }),
    summary,
    targetKind: ExistingSpaceTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({ userIds: uniqueUserIds }),
  })
  .superRefine((operation, ctx) => validateSpaceTarget(operation, ctx));

const spaceUpdateMemberRoleOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceUpdateMemberRole).meta({ id: 'AgentSpaceUpdateMemberRoleOperationType' }),
    summary,
    targetKind: ExistingSpaceTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({
      userIds: uniqueUserIds,
      role: AgentAssignableSharedSpaceRoleSchema,
    }),
  })
  .superRefine((operation, ctx) => validateSpaceTarget(operation, ctx));

const AgentAssignableAlbumRoleSchema = z
  .enum([AlbumUserRole.Editor, AlbumUserRole.Viewer])
  .meta({ id: 'AgentAssignableAlbumUserRole' });

const albumUserPayloads = z
  .array(
    z.strictObject({
      userId: uuid,
      role: AgentAssignableAlbumRoleSchema,
    }),
  )
  .min(1)
  .max(100)
  .superRefine((albumUsers, ctx) => {
    const userIds = albumUsers.map((u) => u.userId);
    if (new Set(userIds).size !== userIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'albumUsers must contain unique userIds' });
    }
  });

const albumAddUsersOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumAddUsers).meta({ id: 'AgentAlbumAddUsersOperationType' }),
    summary,
    targetKind: ExistingAlbumTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({ albumUsers: albumUserPayloads }),
  })
  .superRefine((operation, ctx) => validateAlbumTarget(operation, ctx));

const albumRemoveUsersOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumRemoveUsers).meta({ id: 'AgentAlbumRemoveUsersOperationType' }),
    summary,
    targetKind: ExistingAlbumTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({ userIds: uniqueUserIds }),
  })
  .superRefine((operation, ctx) => validateAlbumTarget(operation, ctx));

const albumUpdateUserRoleOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumUpdateUserRole).meta({ id: 'AgentAlbumUpdateUserRoleOperationType' }),
    summary,
    targetKind: ExistingAlbumTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({
      userId: uuid,
      role: AgentAssignableAlbumRoleSchema,
    }),
  })
  .superRefine((operation, ctx) => validateAlbumTarget(operation, ctx));

const albumDeleteOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AlbumDelete).meta({ id: 'AgentAlbumDeleteOperationType' }),
    summary,
    targetKind: ExistingAlbumTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: emptyPayload,
  })
  .superRefine((operation, ctx) => validateAlbumTarget(operation, ctx));

const spaceDeleteOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceDelete).meta({ id: 'AgentSpaceDeleteOperationType' }),
    summary,
    targetKind: ExistingSpaceTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: emptyPayload,
  })
  .superRefine((operation, ctx) => validateSpaceTarget(operation, ctx));

const assetBatchBase = {
  summary,
  targetKind: AgentOperationTargetKindSchema,
  targetId: uuid.optional(),
  temporaryTargetId: temporaryTargetId.optional(),
  ...assetSelection,
  riskLevel: operationDefaults.riskLevel,
  enabled: operationDefaults.enabled,
};

const assetRotatePayloadSchema = z.strictObject({
  angle: z
    .number()
    .int()
    .refine((angle): angle is 90 | 180 | 270 => angle === 90 || angle === 180 || angle === 270, {
      message: 'angle must be 90, 180, or 270',
    }),
});

const assetCropPayloadSchema = z.strictObject({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().min(1),
  height: z.number().min(1),
});

const tonalLevelValues = [
  'strong_decrease',
  'moderate_decrease',
  'slight_decrease',
  'slight_increase',
  'moderate_increase',
  'strong_increase',
] as const;

const assetAdjustPayloadShape = {
  brightness: z.enum(tonalLevelValues).optional(),
  contrast: z.enum(tonalLevelValues).optional(),
  saturation: z.enum(tonalLevelValues).optional(),
  autoEnhance: z.boolean().optional(),
};

const validateAdjustPayload = (
  payload: { brightness?: string; contrast?: string; saturation?: string; autoEnhance?: boolean },
  ctx: z.RefinementCtx,
) => {
  const manual = [payload.brightness, payload.contrast, payload.saturation].filter((v) => v !== undefined);
  if (payload.autoEnhance === undefined && manual.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'At least one adjustment is required' });
  }
  if (payload.autoEnhance && manual.length > 0) {
    ctx.addIssue({ code: 'custom', message: 'autoEnhance cannot be combined with manual adjustments' });
  }
};

const assetAdjustPayloadSchema = z.strictObject(assetAdjustPayloadShape).superRefine(validateAdjustPayload);

const assetFlipPayloadSchema = z.strictObject({ axis: z.enum(['horizontal', 'vertical']) });

const shareLinkCreatePayloadSchema = z.strictObject({
  password: z.string().optional(),
  expiresAt: z
    .string()
    .optional()
    .refine((value) => value === undefined || new Date(value) > new Date(), {
      message: 'expiresAt must be in the future',
    }),
  showMetadata: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
});

const assetSetFavoritePayloadSchema = z.strictObject({ favorite: z.boolean() });

const assetSetArchivePayloadSchema = z.strictObject({ archived: z.boolean() });

const assetSetVisibilityPayloadSchema = z.strictObject({ visibility: z.literal(AssetVisibility.Locked) });

const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (timeZone) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid IANA time zone' },
  );

const assetUpdateMetadataPayloadFieldNames = [
  'description',
  'rating',
  'dateTimeOriginal',
  'dateTimeRelative',
  'timeZone',
  'latitude',
  'longitude',
] as const;

const assetUpdateMetadataPayloadShape = {
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe('Asset description. Use an empty string to clear the description.'),
  rating: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .optional()
    .describe('Asset star rating from 1 to 5. Use null to clear the rating.'),
  dateTimeOriginal: z.iso.datetime().optional().describe('Absolute original capture date/time as an ISO datetime.'),
  dateTimeRelative: z
    .number()
    .int()
    .optional()
    .describe('Relative capture time shift as an integer minute offset. Cannot be combined with dateTimeOriginal.'),
  timeZone: ianaTimeZoneSchema.optional().describe('IANA time zone such as Europe/Berlin.'),
  latitude: latitudeSchema
    .optional()
    .describe('Explicit latitude coordinate. Provide both latitude and longitude; place names are not accepted.'),
  longitude: longitudeSchema
    .optional()
    .describe('Explicit longitude coordinate. Provide both latitude and longitude; place names are not accepted.'),
};

type AssetUpdateMetadataPayloadLike = Partial<Record<(typeof assetUpdateMetadataPayloadFieldNames)[number], unknown>>;

const validateAssetUpdateMetadataPayload = (payload: AssetUpdateMetadataPayloadLike, ctx: z.RefinementCtx) => {
  const suppliedFieldCount = assetUpdateMetadataPayloadFieldNames.filter(
    (field) => payload[field] !== undefined,
  ).length;
  if (suppliedFieldCount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least one metadata field to update',
    });
  }

  if (payload.dateTimeOriginal !== undefined && payload.dateTimeRelative !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose dateTimeOriginal or dateTimeRelative, not both',
    });
  }

  if (payload.dateTimeRelative === 0 && suppliedFieldCount === 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dateTimeRelative'],
      message: 'dateTimeRelative: 0 is a no-op unless another metadata field changes',
    });
  }

  if (Number(payload.latitude !== undefined) + Number(payload.longitude !== undefined) === 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide both latitude and longitude',
    });
  }
};

const assetUpdateMetadataPayloadSchema = z
  .strictObject(assetUpdateMetadataPayloadShape)
  .superRefine(validateAssetUpdateMetadataPayload);

const assetAddTagPayloadSchema = z
  .strictObject({
    tagId: uuid.optional(),
    tagName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((payload) => Number(payload.tagId !== undefined) + Number(payload.tagName !== undefined) === 1, {
    message: 'Provide exactly one of tagId or tagName',
  });

const rotateOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetRotate).meta({ id: 'AgentAssetRotateOperationType' }),
    ...assetBatchBase,
    payload: assetRotatePayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.ImageEditBatch, AgentOperationType.AssetRotate);
  });

const cropOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetCrop).meta({ id: 'AgentAssetCropOperationType' }),
    ...assetBatchBase,
    payload: assetCropPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.ImageEditBatch, AgentOperationType.AssetCrop);
  });

const adjustOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetAdjust).meta({ id: 'AgentAssetAdjustOperationType' }),
    ...assetBatchBase,
    payload: assetAdjustPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.ImageEditBatch, AgentOperationType.AssetAdjust);
  });

const flipOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetFlip).meta({ id: 'AgentAssetFlipOperationType' }),
    ...assetBatchBase,
    payload: assetFlipPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.ImageEditBatch, AgentOperationType.AssetFlip);
  });

const setFavoriteOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetSetFavorite).meta({ id: 'AgentAssetSetFavoriteOperationType' }),
    ...assetBatchBase,
    payload: assetSetFavoritePayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetSetFavorite);
  });

const setArchiveOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetSetArchive).meta({ id: 'AgentAssetSetArchiveOperationType' }),
    ...assetBatchBase,
    payload: assetSetArchivePayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetSetArchive);
  });

const setVisibilityOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetSetVisibility).meta({ id: 'AgentAssetSetVisibilityOperationType' }),
    ...assetBatchBase,
    payload: assetSetVisibilityPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(
      operation,
      ctx,
      AgentOperationTargetKind.AssetBatch,
      AgentOperationType.AssetSetVisibility,
    );
  });

const updateMetadataOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetUpdateMetadata).meta({ id: 'AgentAssetUpdateMetadataOperationType' }),
    ...assetBatchBase,
    targetKind: z
      .literal(AgentOperationTargetKind.AssetBatch, {
        error: 'asset.updateMetadata requires an asset_batch target',
      })
      .meta({ id: 'AgentAssetUpdateMetadataTargetKind' }),
    payload: assetUpdateMetadataPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(
      operation,
      ctx,
      AgentOperationTargetKind.AssetBatch,
      AgentOperationType.AssetUpdateMetadata,
    );
  });

const addTagOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetAddTag).meta({ id: 'AgentAssetAddTagOperationType' }),
    ...assetBatchBase,
    payload: assetAddTagPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetAddTag);
  });

const removeTagOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetRemoveTag).meta({ id: 'AgentAssetRemoveTagOperationType' }),
    ...assetBatchBase,
    payload: z.strictObject({ tagId: uuid }),
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetRemoveTag);
  });

const trashOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetTrash).meta({ id: 'AgentAssetTrashOperationType' }),
    ...assetBatchBase,
    // Override assetBatchBase's Low default — trash is always High risk
    riskLevel: AgentOperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.High),
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetTrash);
  });

const restoreOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetRestore).meta({ id: 'AgentAssetRestoreOperationType' }),
    ...assetBatchBase,
    // Restore is non-destructive — Low risk (uses the same trashAssets write-scope)
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetRestore);
  });

const stackOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetStack).meta({ id: 'AgentAssetStackOperationType' }),
    ...assetBatchBase,
    // Stack is Low risk — reversible by unstacking
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetStack);
  });

const unstackOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetUnstack).meta({ id: 'AgentAssetUnstackOperationType' }),
    ...assetBatchBase,
    // Unstack is Low risk — dissolves stack but does not delete assets
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetUnstack);
  });

const shareLinkCreateOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.ShareLinkCreate).meta({ id: 'AgentShareLinkCreateOperationType' }),
    ...assetBatchBase,
    // Always High risk — outward-facing, privacy-sensitive
    riskLevel: AgentOperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.High),
    payload: shareLinkCreatePayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.ShareLinkCreate);
  });

const shareLinkCreateAlbumOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.ShareLinkCreateAlbum).meta({ id: 'AgentShareLinkCreateAlbumOperationType' }),
    summary,
    targetKind: ExistingAlbumTargetKindSchema,
    targetId: uuid.optional(),
    // Always High risk — outward-facing, privacy-sensitive
    riskLevel: AgentOperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.High),
    enabled: operationDefaults.enabled,
    payload: shareLinkCreatePayloadSchema,
  })
  .superRefine((operation, ctx) => validateAlbumTarget(operation, ctx));

const PersonTargetKindSchema = z
  .literal(AgentOperationTargetKind.Person)
  .meta({ id: 'AgentOperationPersonTargetKind' });

const personUpdatePayloadSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(852).optional(),
    birthDate: z.iso
      .date()
      .nullable()
      .optional()
      .refine((val) => (val ? new Date(val) <= new Date() : true), { message: 'birthDate cannot be in the future' }),
    isHidden: z.boolean().optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.name === undefined && payload.birthDate === undefined && payload.isHidden === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one of name, birthDate, or isHidden',
      });
    }
  });

const personUpdateOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.PersonUpdate).meta({ id: 'AgentPersonUpdateOperationType' }),
    summary,
    targetKind: PersonTargetKindSchema,
    targetId: uuid.optional(),
    riskLevel: AgentOperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.Low),
    enabled: operationDefaults.enabled,
    payload: personUpdatePayloadSchema,
  })
  .superRefine((operation, ctx) => validatePersonTarget(operation, ctx));

const personMergePayloadSchema = z.strictObject({
  sourcePersonIds: z.array(uuid).min(1).max(50),
});

const personMergeOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.PersonMerge).meta({ id: 'AgentPersonMergeOperationType' }),
    summary,
    targetKind: PersonTargetKindSchema,
    targetId: uuid.optional(),
    // Always High risk — irreversible: faces reassigned, source person deleted
    riskLevel: AgentOperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.High),
    enabled: operationDefaults.enabled,
    payload: personMergePayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validatePersonTarget(operation, ctx);
    if (operation.targetId && operation.payload?.sourcePersonIds?.includes(operation.targetId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload', 'sourcePersonIds'],
        message: 'cannot merge a person into itself',
      });
    }
  });

const validateAssetSelection = (
  operation: { assetSource?: AgentAssetSourceInput; assetIds?: string[]; assetSelectionHandleId?: string },
  ctx: z.RefinementCtx,
) => {
  const validation = validateAgentAssetSourceMechanismCount(operation);
  if (!validation.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: validation.message,
    });
  }
};

const AgentGalleryOperationInputSchema = z.discriminatedUnion('type', [
  createAlbumOperationSchema,
  addAssetsOperationSchema,
  removeAssetsOperationSchema,
  updateDetailsOperationSchema,
  setCoverOperationSchema,
  createSpaceOperationSchema,
  spaceAssetsOperationSchema(AgentOperationType.SpaceAddAssets),
  spaceAssetsOperationSchema(AgentOperationType.SpaceRemoveAssets),
  updateSpaceDetailsOperationSchema,
  spaceAddMembersOperationSchema,
  spaceRemoveMembersOperationSchema,
  spaceUpdateMemberRoleOperationSchema,
  albumAddUsersOperationSchema,
  albumRemoveUsersOperationSchema,
  albumUpdateUserRoleOperationSchema,
  albumDeleteOperationSchema,
  spaceDeleteOperationSchema,
  rotateOperationSchema,
  cropOperationSchema,
  adjustOperationSchema,
  flipOperationSchema,
  setFavoriteOperationSchema,
  setArchiveOperationSchema,
  setVisibilityOperationSchema,
  updateMetadataOperationSchema,
  addTagOperationSchema,
  removeTagOperationSchema,
  trashOperationSchema,
  restoreOperationSchema,
  stackOperationSchema,
  unstackOperationSchema,
  shareLinkCreateOperationSchema,
  shareLinkCreateAlbumOperationSchema,
  personUpdateOperationSchema,
  personMergeOperationSchema,
]);

const operationRequest = (schemaId: string) =>
  z
    .strictObject({
      summary,
      operations: z.array(AgentGalleryOperationInputSchema).min(1).max(500),
    })
    .superRefine(validateTemporaryTargetReferences)
    .meta({ id: schemaId });

const AgentProposeAlbumOperationsSchema = operationRequest('AgentProposeAlbumOperationsDto');

const AgentReviseAlbumOperationsSchema = operationRequest('AgentReviseAlbumOperationsDto').extend({
  feedback: z.string().trim().min(1).max(2000).optional(),
});

const albumName = z.string().trim().min(1).max(200);
const albumDescription = z.string().trim().max(1000).optional().default('');

const AgentAlbumWorkflowAssetSourceInputSchema = agentOperationPlanningAssetSourceInput.meta({
  id: 'AgentAlbumWorkflowAssetSourceInput',
});

const AgentProposeAlbumFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    albumName,
    description: albumDescription,
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .meta({ id: 'AgentProposeAlbumFromSearchToolRequestDto' });

const AgentProposeAlbumFromSelectionToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    albumName,
    description: albumDescription,
    selectionHandleId: uuid,
  })
  .meta({ id: 'AgentProposeAlbumFromSelectionToolRequestDto' });

const AgentProposeAddAssetsToAlbumFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    albumId: uuid.optional(),
    albumName: albumName.optional(),
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.albumId) === Boolean(value.albumName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of albumId or albumName',
      });
    }
  })
  .meta({ id: 'AgentProposeAddAssetsToAlbumFromSearchToolRequestDto' });

const spaceName = z.string().trim().min(1).max(100);
const spaceDescription = z.string().max(500).optional();

const AgentProposeSpaceFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    spaceName,
    description: spaceDescription,
    color: UserAvatarColorSchema.optional(),
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .meta({ id: 'AgentProposeSpaceFromSearchToolRequestDto' });

const AgentProposeAddAssetsToSpaceFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    spaceId: uuid.optional(),
    spaceName: spaceName.optional(),
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.spaceId) === Boolean(value.spaceName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of spaceId or spaceName',
      });
    }
  })
  .meta({ id: 'AgentProposeAddAssetsToSpaceFromSearchToolRequestDto' });

const AgentAssetBatchWorkflowActionSchema = z
  .discriminatedUnion('type', [
    assetSetFavoritePayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetSetFavorite),
    }),
    assetSetArchivePayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetSetArchive),
    }),
    assetSetVisibilityPayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetSetVisibility),
    }),
    assetAddTagPayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetAddTag),
    }),
    assetRotatePayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetRotate),
    }),
    assetCropPayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetCrop),
    }),
    z
      .strictObject({ type: z.literal(AgentOperationType.AssetAdjust), ...assetAdjustPayloadShape })
      .superRefine(validateAdjustPayload),
    assetFlipPayloadSchema.extend({ type: z.literal(AgentOperationType.AssetFlip) }),
    z.strictObject({ type: z.literal(AgentOperationType.AssetStack) }),
    z.strictObject({ type: z.literal(AgentOperationType.AssetUnstack) }),
    z
      .strictObject({
        type: z.literal(AgentOperationType.AssetUpdateMetadata),
        ...assetUpdateMetadataPayloadShape,
      })
      .superRefine(validateAssetUpdateMetadataPayload),
  ])
  .meta({ id: 'AgentAssetBatchWorkflowAction' });

const AgentProposeAssetBatchFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    action: AgentAssetBatchWorkflowActionSchema,
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .meta({ id: 'AgentProposeAssetBatchFromSearchToolRequestDto' });

const AgentProposeAssetBatchFromSelectionToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    action: AgentAssetBatchWorkflowActionSchema,
    selectionHandleId: uuid,
  })
  .meta({ id: 'AgentProposeAssetBatchFromSelectionToolRequestDto' });

const AgentOperationPlanParamsSchema = z
  .strictObject({
    id: uuid,
    planId: uuid,
  })
  .meta({ id: 'AgentOperationPlanParamsDto' });

const AgentOperationPlanSummaryRequestSchema = z
  .strictObject({
    focus: z.string().trim().min(1).max(1000).optional(),
  })
  .meta({ id: 'AgentOperationPlanSummaryRequestDto' });

const planId = uuid;

const AgentReviseProposedOperationsToolRequestSchema = operationRequest('AgentReviseProposedOperationsToolRequestDto')
  .extend({
    planId,
    feedback: z.string().trim().min(1).max(2000).optional(),
  })
  .meta({ id: 'AgentReviseProposedOperationsToolRequestDto' });

const AgentSummarizePlanToolRequestSchema = AgentOperationPlanSummaryRequestSchema.extend({
  planId,
}).meta({ id: 'AgentSummarizePlanToolRequestDto' });

export const AgentOperationPlanToolRequestSchemas = {
  [AgentToolName.ProposeAlbumOperations]: AgentProposeAlbumOperationsSchema,
  [AgentToolName.ProposeAlbumFromSearch]: AgentProposeAlbumFromSearchToolRequestSchema,
  [AgentToolName.ProposeAlbumFromSelection]: AgentProposeAlbumFromSelectionToolRequestSchema,
  [AgentToolName.ProposeAddAssetsToAlbumFromSearch]: AgentProposeAddAssetsToAlbumFromSearchToolRequestSchema,
  [AgentToolName.ProposeSpaceFromSearch]: AgentProposeSpaceFromSearchToolRequestSchema,
  [AgentToolName.ProposeAddAssetsToSpaceFromSearch]: AgentProposeAddAssetsToSpaceFromSearchToolRequestSchema,
  [AgentToolName.ProposeAssetBatchFromSearch]: AgentProposeAssetBatchFromSearchToolRequestSchema,
  [AgentToolName.ProposeAssetBatchFromSelection]: AgentProposeAssetBatchFromSelectionToolRequestSchema,
  [AgentToolName.ReviseProposedOperations]: AgentReviseProposedOperationsToolRequestSchema,
  [AgentToolName.SummarizePlan]: AgentSummarizePlanToolRequestSchema,
} as const;

const AgentOperationReviewMetadataValueKindSchema = z
  .enum(['known', 'empty', 'clear', 'relative', 'unknown'])
  .meta({ id: 'AgentOperationReviewMetadataValueKind' });
const AgentOperationReviewMetadataValueSchema = z.object({
  assetId: uuid,
  value: z.string().nullable(),
  valueKind: AgentOperationReviewMetadataValueKindSchema,
});
const AgentOperationReviewMetadataFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  previousValues: z.array(AgentOperationReviewMetadataValueSchema),
  proposedValue: z.string().nullable(),
  proposedValueKind: AgentOperationReviewMetadataValueKindSchema,
});
const AgentOperationReviewMetadataSchema = z.object({
  assetMetadata: z
    .object({
      fields: z.array(AgentOperationReviewMetadataFieldSchema),
      sampleAssetIds: z.array(uuid),
      warnings: z.array(z.string()),
    })
    .optional(),
});

const AgentOperationResponseSchema = z
  .object({
    id: uuid,
    planId: uuid,
    type: AgentOperationTypeSchema,
    summary,
    targetKind: AgentOperationTargetKindSchema,
    targetId: uuid.nullable(),
    temporaryTargetId: temporaryTargetId.nullable(),
    assetIds: z.array(uuid),
    payload: z.record(z.string(), z.unknown()),
    dependencyIds: z.array(uuid),
    riskLevel: AgentOperationRiskLevelSchema,
    enabled: z.boolean(),
    status: AgentOperationStatusSchema,
    result: z.record(z.string(), z.unknown()).nullable(),
    reviewMetadata: AgentOperationReviewMetadataSchema.optional(),
    error: z.string().nullable(),
    createdAt: isoDatetimeToDate,
    updatedAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentOperationResponseDto' });

const AgentOperationPlanResponseSchema = z
  .object({
    id: uuid,
    sessionId: uuid,
    revision: z.number().int().min(1),
    status: AgentOperationPlanStatusSchema,
    summary,
    operations: z.array(AgentOperationResponseSchema),
    createdAt: isoDatetimeToDate,
    updatedAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentOperationPlanResponseDto' });

const AgentOperationPlanToolResponseSchema = z
  .object({
    status: z.literal('success'),
    plan: AgentOperationPlanResponseSchema.nullable(),
    toolCall: AgentToolCallResponseDto.schema.nullable(),
    summary,
  })
  .meta({ id: 'AgentOperationPlanToolResponseDto' });

const AgentOperationPlanApplyRequestSchema = z
  .strictObject({
    operationIds: uniqueOperationIds,
    itemSelections: z.record(uuid, AgentOperationItemSelectionSchema).optional(),
    fieldOverrides: z.record(uuid, AgentOperationFieldOverrideSchema).optional(),
    planRevision: z.number().int().min(1).optional(),
  })
  .meta({ id: 'AgentOperationPlanApplyRequestDto' });

const AgentOperationPlanApplyResponseSchema = z
  .object({
    status: AgentOperationApplyStatusSchema,
    plan: AgentOperationPlanResponseSchema,
    appliedOperationIds: z.array(uuid),
    skippedOperationIds: z.array(uuid),
    failedOperationIds: z.array(uuid),
    summary,
  })
  .meta({ id: 'AgentOperationPlanApplyResponseDto' });

function validateAlbumTarget(
  operation: {
    targetKind: AgentOperationTargetKind;
    targetId?: string;
    temporaryTargetId?: string;
  },
  ctx: z.RefinementCtx,
  allowedNewTargets: AgentOperationTargetKind[] = [],
) {
  if (
    operation.targetKind !== AgentOperationTargetKind.ExistingAlbum &&
    operation.targetKind !== AgentOperationTargetKind.NewAlbum
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetKind'],
      message: 'album operations require an album target',
    });
    return;
  }

  if (operation.targetKind === AgentOperationTargetKind.NewAlbum && !allowedNewTargets.includes(operation.targetKind)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetKind'],
      message: 'new album targets are not valid for this operation',
    });
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingAlbum && !operation.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is required for existing album targets',
    });
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingAlbum && operation.temporaryTargetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['temporaryTargetId'],
      message: 'temporaryTargetId is only valid for new album targets',
    });
  }

  if (operation.targetKind === AgentOperationTargetKind.NewAlbum && !operation.temporaryTargetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['temporaryTargetId'],
      message: 'temporaryTargetId is required for new album targets',
    });
  }

  if (operation.targetKind === AgentOperationTargetKind.NewAlbum && operation.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is only valid for existing album targets',
    });
  }
}

function validateSpaceTarget(
  operation: {
    targetKind: AgentOperationTargetKind;
    targetId?: string;
    temporaryTargetId?: string;
  },
  ctx: z.RefinementCtx,
  allowedNewTargets: AgentOperationTargetKind[] = [],
) {
  if (
    operation.targetKind !== AgentOperationTargetKind.ExistingSpace &&
    operation.targetKind !== AgentOperationTargetKind.NewSpace
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetKind'],
      message: 'space operations require a space target',
    });
    return;
  }

  if (operation.targetKind === AgentOperationTargetKind.NewSpace && !allowedNewTargets.includes(operation.targetKind)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetKind'],
      message: 'new space targets are not valid for this operation',
    });
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingSpace && !operation.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is required for existing space targets',
    });
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingSpace && operation.temporaryTargetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['temporaryTargetId'],
      message: 'Use targetId for existing spaces; temporaryTargetId is only for new spaces',
    });
  }

  if (operation.targetKind === AgentOperationTargetKind.NewSpace && !operation.temporaryTargetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['temporaryTargetId'],
      message: 'temporaryTargetId is required for new space targets',
    });
  }

  if (operation.targetKind === AgentOperationTargetKind.NewSpace && operation.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is only valid for existing space targets',
    });
  }
}

function validatePersonTarget(
  operation: {
    targetKind: AgentOperationTargetKind;
    targetId?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (operation.targetKind !== AgentOperationTargetKind.Person) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetKind'],
      message: 'person.update requires a person target',
    });
    return;
  }

  if (!operation.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is required for person targets',
    });
  }
}

function validateStandaloneTarget(
  operation: {
    type: AgentOperationType;
    targetKind: AgentOperationTargetKind;
    targetId?: string;
    temporaryTargetId?: string;
  },
  ctx: z.RefinementCtx,
  expectedTargetKind: AgentOperationTargetKind,
  operationType: AgentOperationType,
) {
  if (operation.targetKind !== expectedTargetKind) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetKind'],
      message: `${operationType} requires an ${expectedTargetKind} target`,
    });
  }

  if (operation.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is not valid for asset batch targets',
    });
  }

  if (operation.temporaryTargetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['temporaryTargetId'],
      message: 'temporaryTargetId is not valid for asset batch targets',
    });
  }
}

function validateTemporaryTargetReferences(
  value: {
    operations: Array<{ type: AgentOperationType; targetKind: AgentOperationTargetKind; temporaryTargetId?: string }>;
  },
  ctx: z.RefinementCtx,
) {
  const createdAlbumTargetIds = new Set<string>();
  const createdSpaceTargetIds = new Set<string>();

  for (const [index, operation] of value.operations.entries()) {
    if (operation.type === AgentOperationType.AlbumCreate && operation.temporaryTargetId) {
      addUniqueTemporaryTargetId(createdAlbumTargetIds, operation.temporaryTargetId, index, ctx);
      continue;
    }

    if (operation.type === AgentOperationType.SpaceCreate && operation.temporaryTargetId) {
      addUniqueTemporaryTargetId(createdSpaceTargetIds, operation.temporaryTargetId, index, ctx);
      continue;
    }

    const requiresAlbumDependency =
      (operation.type === AgentOperationType.AlbumAddAssets || operation.type === AgentOperationType.AlbumSetCover) &&
      operation.targetKind === AgentOperationTargetKind.NewAlbum;
    const requiresSpaceDependency =
      (operation.type === AgentOperationType.SpaceAddAssets ||
        operation.type === AgentOperationType.SpaceRemoveAssets) &&
      operation.targetKind === AgentOperationTargetKind.NewSpace;

    if (
      requiresAlbumDependency &&
      (!operation.temporaryTargetId || !createdAlbumTargetIds.has(operation.temporaryTargetId))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['operations', index, 'temporaryTargetId'],
        message: 'No matching create operation for temporaryTargetId',
      });
    }

    if (
      requiresSpaceDependency &&
      (!operation.temporaryTargetId || !createdSpaceTargetIds.has(operation.temporaryTargetId))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['operations', index, 'temporaryTargetId'],
        message: 'No matching create operation for temporaryTargetId',
      });
    }
  }
}

function addUniqueTemporaryTargetId(
  temporaryTargetIds: Set<string>,
  targetId: string,
  operationIndex: number,
  ctx: z.RefinementCtx,
) {
  if (temporaryTargetIds.has(targetId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['operations', operationIndex, 'temporaryTargetId'],
      message: 'temporaryTargetId must be unique for create operations',
    });
  }

  temporaryTargetIds.add(targetId);
}

export class AgentProposeAlbumOperationsDto extends createZodDto(AgentProposeAlbumOperationsSchema) {}
export class AgentProposeAlbumFromSearchToolRequestDto extends createZodDto(
  AgentProposeAlbumFromSearchToolRequestSchema,
) {}
export class AgentProposeAlbumFromSelectionToolRequestDto extends createZodDto(
  AgentProposeAlbumFromSelectionToolRequestSchema,
) {}
export class AgentProposeAddAssetsToAlbumFromSearchToolRequestDto extends createZodDto(
  AgentProposeAddAssetsToAlbumFromSearchToolRequestSchema,
) {}
export class AgentProposeSpaceFromSearchToolRequestDto extends createZodDto(
  AgentProposeSpaceFromSearchToolRequestSchema,
) {}
export class AgentProposeAddAssetsToSpaceFromSearchToolRequestDto extends createZodDto(
  AgentProposeAddAssetsToSpaceFromSearchToolRequestSchema,
) {}
export class AgentProposeAssetBatchFromSearchToolRequestDto extends createZodDto(
  AgentProposeAssetBatchFromSearchToolRequestSchema,
) {}
export class AgentProposeAssetBatchFromSelectionToolRequestDto extends createZodDto(
  AgentProposeAssetBatchFromSelectionToolRequestSchema,
) {}
export class AgentReviseAlbumOperationsDto extends createZodDto(AgentReviseAlbumOperationsSchema) {}
export class AgentOperationPlanParamsDto extends createZodDto(AgentOperationPlanParamsSchema) {}
export class AgentOperationPlanSummaryRequestDto extends createZodDto(AgentOperationPlanSummaryRequestSchema) {}
export class AgentOperationResponseDto extends createZodDto(AgentOperationResponseSchema) {}
export class AgentOperationPlanResponseDto extends createZodDto(AgentOperationPlanResponseSchema) {}
export class AgentOperationPlanToolResponseDto extends createZodDto(AgentOperationPlanToolResponseSchema) {}
export class AgentOperationPlanApplyRequestDto extends createZodDto(AgentOperationPlanApplyRequestSchema) {}
export class AgentOperationPlanApplyResponseDto extends createZodDto(AgentOperationPlanApplyResponseSchema) {}

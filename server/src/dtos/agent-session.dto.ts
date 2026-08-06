import { createZodDto } from 'nestjs-zod';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const MAX_INITIAL_CONTEXT_BYTES = 16_384;
const model = z.string().trim().min(1).max(160);
const models = z.array(model);
const jsonByteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const AgentApprovalModeSchema = z.enum(AgentApprovalMode).meta({ id: 'AgentApprovalMode' });
const AgentPermissionPresetSchema = z.enum(AgentPermissionPreset).meta({ id: 'AgentPermissionPreset' });
const AgentProviderTypeSchema = z.enum(AgentProviderType).meta({ id: 'AgentProviderType' });
const AgentSessionStatusSchema = z.enum(AgentSessionStatus).meta({ id: 'AgentSessionStatus' });

const AgentCredentialSnapshotSchema = z
  .object({
    id: z.uuidv4(),
    providerType: AgentProviderTypeSchema,
    label: z.string().trim().min(1).max(120),
    baseUrl: z.url().nullable(),
    models,
    defaultModel: model.nullable(),
  })
  .meta({ id: 'AgentCredentialSnapshot' });

const AgentModelSnapshotSchema = z
  .object({
    providerCredentialId: z.uuidv4(),
    model,
  })
  .meta({ id: 'AgentModelSnapshot' });

const legacyWriteScopeDefaults = {
  removeAssets: false,
  createSpace: false,
  addAssetsToSpaces: false,
  removeAssetsFromSpaces: false,
  updateSpaceDetails: false,
  addMembersToSpaces: false,
  removeMembersFromSpaces: false,
  updateSpaceMemberRoles: false,
  editAssets: false,
  favoriteAssets: false,
  archiveAssets: false,
  tagAssets: false,
  updateAssetMetadata: false,
  trashAssets: false,
  createSharedLinks: false,
  shareAlbums: false,
  lockAssets: false,
  deleteContainers: false,
  manageStacks: false,
  managePeople: false,
};
const expandedWriteScopeShape = {
  createAlbum: z.boolean(),
  addAssets: z.boolean(),
  removeAssets: z.boolean(),
  updateDetails: z.boolean(),
  setCover: z.boolean(),
  createSpace: z.boolean(),
  addAssetsToSpaces: z.boolean(),
  removeAssetsFromSpaces: z.boolean(),
  updateSpaceDetails: z.boolean(),
  addMembersToSpaces: z.boolean(),
  removeMembersFromSpaces: z.boolean(),
  updateSpaceMemberRoles: z.boolean(),
  editAssets: z.boolean(),
  favoriteAssets: z.boolean(),
  archiveAssets: z.boolean(),
  tagAssets: z.boolean(),
  updateAssetMetadata: z.boolean(),
  trashAssets: z.boolean(),
  createSharedLinks: z.boolean(),
  shareAlbums: z.boolean(),
  lockAssets: z.boolean(),
  deleteContainers: z.boolean(),
  manageStacks: z.boolean(),
  managePeople: z.boolean(),
};

const AgentWriteScopeSchema = z.object(expandedWriteScopeShape);

const AgentPermissionPlanSchema = z
  .object({
    read: z.object({
      metadata: z.boolean(),
      previews: z.boolean(),
      originals: z.boolean(),
    }),
    providerExposure: z.object({
      metadata: z.boolean(),
      previews: z.boolean(),
      originals: z.boolean(),
      allowOriginalsForExternalProviders: z.boolean(),
    }),
    assetScope: z.object({
      owned: z.boolean(),
      sharedSpaces: z.boolean(),
      locked: z.boolean(),
    }),
    writeScope: AgentWriteScopeSchema,
    limits: z.object({
      maxAssetsPerToolCall: z.number().int().min(1).max(10_000),
      maxAssetsPerSession: z.number().int().min(1).max(100_000),
      maxPreviewsPerToolCall: z.number().int().min(0).max(10_000),
      maxPreviewsPerSession: z.number().int().min(0).max(100_000).optional(),
      maxOriginalsPerToolCall: z.number().int().min(0).max(1000),
      maxOriginalsPerSession: z.number().int().min(0).max(10_000).optional(),
      expiresInMinutes: z.number().int().min(1).max(10_080).nullable(),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.providerExposure.metadata && !value.read.metadata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerExposure', 'metadata'],
        message: 'metadata exposure requires metadata reads',
      });
    }

    if (value.providerExposure.previews && !value.read.previews) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerExposure', 'previews'],
        message: 'preview exposure requires preview reads',
      });
    }

    if (value.providerExposure.originals && !value.read.originals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerExposure', 'originals'],
        message: 'original exposure requires original reads',
      });
    }

    if (value.limits.maxPreviewsPerToolCall > 0 && !value.read.previews) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxPreviewsPerToolCall'],
        message: 'preview limits require preview reads',
      });
    }

    if (
      value.limits.maxPreviewsPerSession !== undefined &&
      value.limits.maxPreviewsPerSession > 0 &&
      !value.read.previews
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxPreviewsPerSession'],
        message: 'preview session limits require preview reads',
      });
    }

    if (value.limits.maxOriginalsPerToolCall > 0 && !value.read.originals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxOriginalsPerToolCall'],
        message: 'original limits require original reads',
      });
    }

    if (
      value.limits.maxOriginalsPerSession !== undefined &&
      value.limits.maxOriginalsPerSession > 0 &&
      !value.read.originals
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxOriginalsPerSession'],
        message: 'original session limits require original reads',
      });
    }

    if (value.limits.maxAssetsPerSession < value.limits.maxAssetsPerToolCall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxAssetsPerSession'],
        message: 'session asset limit must be at least the per-tool-call asset limit',
      });
    }

    if (value.limits.maxPreviewsPerToolCall > value.limits.maxAssetsPerToolCall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxPreviewsPerToolCall'],
        message: 'preview limit cannot exceed the per-tool-call asset limit',
      });
    }

    if (value.limits.maxOriginalsPerToolCall > value.limits.maxAssetsPerToolCall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxOriginalsPerToolCall'],
        message: 'original limit cannot exceed the per-tool-call asset limit',
      });
    }

    if (
      value.limits.maxPreviewsPerSession !== undefined &&
      value.limits.maxPreviewsPerSession < value.limits.maxPreviewsPerToolCall
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxPreviewsPerSession'],
        message: 'preview session limit must be at least the preview per-tool-call limit',
      });
    }

    if (
      value.limits.maxOriginalsPerSession !== undefined &&
      value.limits.maxOriginalsPerSession < value.limits.maxOriginalsPerToolCall
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxOriginalsPerSession'],
        message: 'original session limit must be at least the original per-tool-call limit',
      });
    }

    if (
      value.limits.maxPreviewsPerSession !== undefined &&
      value.limits.maxPreviewsPerSession > value.limits.maxAssetsPerSession
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxPreviewsPerSession'],
        message: 'preview session limit cannot exceed the asset session limit',
      });
    }

    if (
      value.limits.maxOriginalsPerSession !== undefined &&
      value.limits.maxOriginalsPerSession > value.limits.maxAssetsPerSession
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxOriginalsPerSession'],
        message: 'original session limit cannot exceed the asset session limit',
      });
    }
  })
  .meta({ id: 'AgentPermissionPlan' });

const AgentLegacyPermissionPlanSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const permissionPlan = value as { writeScope?: Record<string, unknown> };
  return {
    ...permissionPlan,
    writeScope: {
      ...legacyWriteScopeDefaults,
      ...permissionPlan.writeScope,
    },
  };
}, AgentPermissionPlanSchema);

const InitialContextSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => jsonByteLength(value) <= MAX_INITIAL_CONTEXT_BYTES, {
    message: 'initialContext must be 16 KiB or less',
  })
  .meta({ id: 'AgentInitialContext' });

const RunnerCapabilitiesSnapshotSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .meta({ id: 'AgentRunnerCapabilitiesSnapshot' });

const AgentSessionCreateSchema = z
  .object({
    providerCredentialId: z.uuidv4(),
    model,
    permissionPreset: AgentPermissionPresetSchema,
    approvalMode: AgentApprovalModeSchema,
    permissionPlan: AgentPermissionPlanSchema.optional(),
    runnerEndpoint: z.url().nullable().optional(),
    initialContext: InitialContextSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.permissionPreset === AgentPermissionPreset.Custom && !value.permissionPlan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permissionPlan'],
        message: 'permissionPlan is required when permissionPreset is custom',
      });
    }

    if (value.permissionPreset !== AgentPermissionPreset.Custom && value.permissionPlan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permissionPlan'],
        message: 'permissionPlan is only accepted when permissionPreset is custom',
      });
    }
  })
  .meta({ id: 'AgentSessionCreateDto' });

const AgentSessionUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).nullable(),
  })
  .meta({ id: 'AgentSessionUpdateDto' });

const AgentSessionResponseSchema = z
  .object({
    id: z.uuidv4(),
    status: AgentSessionStatusSchema,
    title: z.string().nullable().optional(),
    providerCredentialId: z.uuidv4().nullable(),
    credentialSnapshot: AgentCredentialSnapshotSchema,
    modelSnapshot: AgentModelSnapshotSchema,
    permissionPreset: AgentPermissionPresetSchema,
    permissionPlanSnapshot: AgentLegacyPermissionPlanSchema,
    approvalMode: AgentApprovalModeSchema,
    runnerEndpoint: z.url().nullable(),
    runnerSessionId: z.string().nullable(),
    runnerCapabilitiesSnapshot: RunnerCapabilitiesSnapshotSchema,
    initialContextSnapshot: InitialContextSchema,
    createdAt: isoDatetimeToDate,
    updatedAt: isoDatetimeToDate,
    endedAt: isoDatetimeToDate.nullable(),
  })
  .meta({ id: 'AgentSessionResponseDto' });

export class AgentSessionCreateDto extends createZodDto(AgentSessionCreateSchema) {}
export class AgentSessionUpdateDto extends createZodDto(AgentSessionUpdateSchema) {}
export class AgentSessionResponseDto extends createZodDto(AgentSessionResponseSchema) {}

export { AgentPermissionPlanSchema };

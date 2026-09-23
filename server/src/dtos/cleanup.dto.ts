import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { AssetTypeSchema, CleanupQueue } from 'src/enum.js';
import { CLEANUP_MAX_IDS, CLEANUP_PAGE_LIMIT, isValidMonthDay, isValidTimeZone } from 'src/utils/cleanup.js';
import { stringToBool } from 'src/validation.js';

export const CleanupQueueSchema = z.enum(CleanupQueue).describe('Cleanup queue').meta({ id: 'CleanupQueue' });
export const CleanupCountQueueSchema = z
  .enum(['space_hogs', 'bursts', 'screenshots', 'blurry', 'duplicates'])
  .describe('Queue to count')
  .meta({ id: 'CleanupCountQueue' });
const CleanupListQueueSchema = z
  .enum(['space_hogs', 'bursts', 'screenshots', 'blurry'])
  .describe('Queue to list')
  .meta({ id: 'CleanupListQueue' });
export const CleanupStrictnessSchema = z.enum(['lenient', 'balanced', 'strict']).meta({ id: 'CleanupStrictness' });
export const CleanupBlurReasonSchema = z.enum(['all', 'blurry', 'dark', 'bright']).meta({ id: 'CleanupBlurReason' });
export const CleanupBurstSourceSchema = z.enum(['burstId', 'timeWindow']).meta({ id: 'CleanupBurstSource' });
export const CleanupSkipReasonSchema = z
  .enum(['not_found', 'out_of_scope', 'already_trashed'])
  .meta({ id: 'CleanupSkipReason' });
export const CleanupAssetTypeFilterSchema = z.enum(['all', 'image', 'video']).meta({ id: 'CleanupAssetTypeFilter' });

const monthDay = z.coerce
  .number()
  .int()
  .refine(isValidMonthDay, 'Invalid month/day')
  .describe('Calendar date as month*100+day, e.g. 923');
const ids = z.array(z.uuid()).max(CLEANUP_MAX_IDS);

export class CleanupMonthDayParamDto extends createZodDto(
  z.object({ monthDay }).meta({ id: 'CleanupMonthDayParamDto' }),
) {}
export class CleanupRewindYearParamDto extends createZodDto(
  z.object({ monthDay, year: z.coerce.number().int().min(1800).max(9999) }).meta({ id: 'CleanupRewindYearParamDto' }),
) {}
export class CleanupQueueParamDto extends createZodDto(
  z.object({ queue: CleanupListQueueSchema }).meta({ id: 'CleanupQueueParamDto' }),
) {}
export class CleanupCountParamDto extends createZodDto(
  z.object({ queue: CleanupCountQueueSchema }).meta({ id: 'CleanupCountParamDto' }),
) {}
export class CleanupCalendarQueryDto extends createZodDto(
  z
    .object({ tz: z.string().refine(isValidTimeZone, 'Invalid IANA time zone').describe('Viewer time zone') })
    .meta({ id: 'CleanupCalendarQueryDto' }),
) {}
export class CleanupQueueQueryDto extends createZodDto(
  z
    .object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(CLEANUP_PAGE_LIMIT.max).optional(),
      strictness: CleanupStrictnessSchema.optional(),
      reason: CleanupBlurReasonSchema.optional(),
      hideFaces: stringToBool.optional(),
      type: CleanupAssetTypeFilterSchema.optional(),
      minSize: z.coerce.number().int().min(0).optional(),
    })
    .meta({ id: 'CleanupQueueQueryDto' }),
) {}
export class CleanupCommitDto extends createZodDto(
  z
    .object({
      queue: CleanupQueueSchema,
      trashIds: ids.default([]),
      favoriteIds: ids.default([]),
      keepIds: ids.default([]),
      completeMonthDay: monthDay.optional(),
    })
    .meta({ id: 'CleanupCommitDto' }),
) {}
export class CleanupDecisionDeleteDto extends createZodDto(
  z.object({ queue: CleanupQueueSchema, assetIds: ids.min(1) }).meta({ id: 'CleanupDecisionDeleteDto' }),
) {}
export class CleanupInSpacesDto extends createZodDto(z.object({ assetIds: ids }).meta({ id: 'CleanupInSpacesDto' })) {}

const CleanupCountResponseSchema = z
  .object({ count: z.int(), bytes: z.number(), analysedPercent: z.number().optional() })
  .meta({ id: 'CleanupCountResponseDto' });
const CleanupTrashResponseSchema = z
  .object({ count: z.int(), bytes: z.number() })
  .meta({ id: 'CleanupTrashResponseDto' });
const CleanupCalendarDaySchema = z
  .object({ monthDay: z.int(), assetCount: z.int(), reviewedAt: z.string().nullable() })
  .meta({ id: 'CleanupCalendarDayDto' });
const CleanupCalendarResponseSchema = z
  .object({ days: z.array(CleanupCalendarDaySchema), daysReviewed: z.int(), streak: z.int() })
  .meta({ id: 'CleanupCalendarResponseDto' });
const CleanupRewindYearsResponseSchema = z
  .object({ years: z.array(z.object({ year: z.int(), count: z.int() }).meta({ id: 'CleanupRewindYearDto' })) })
  .meta({ id: 'CleanupRewindYearsResponseDto' });
export const CleanupAssetSchema = z
  .object({
    id: z.uuid(),
    type: AssetTypeSchema,
    originalFileName: z.string(),
    localDateTime: z.string(),
    thumbhash: z.string().nullable(),
    width: z.int().nullable(),
    height: z.int().nullable(),
    duration: z.number().nullable(),
    fileSize: z.number(),
    isFavorite: z.boolean(),
    inAlbum: z.boolean(),
    city: z.string().nullable(),
    kept: z.boolean(),
    reason: CleanupBlurReasonSchema.optional(),
    sharpness: z.number().nullable().optional(),
  })
  .meta({ id: 'CleanupAssetDto' });
const CleanupRewindAssetsResponseSchema = z
  .object({ assets: z.array(CleanupAssetSchema) })
  .meta({ id: 'CleanupRewindAssetsResponseDto' });
const CleanupBurstGroupSchema = z
  .object({
    groupId: z.string(),
    source: CleanupBurstSourceSchema,
    assets: z.array(CleanupAssetSchema),
    suggestedKeepId: z.uuid(),
  })
  .meta({ id: 'CleanupBurstGroupDto' });
const CleanupQueuePageSchema = z
  .object({
    items: z.array(CleanupAssetSchema),
    groups: z.array(CleanupBurstGroupSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'CleanupQueuePageDto' });
const CleanupSkippedSchema = z
  .object({ id: z.uuid(), reason: CleanupSkipReasonSchema })
  .meta({ id: 'CleanupSkippedDto' });
const CleanupCommitResponseSchema = z
  .object({ trashed: z.array(z.uuid()), favorited: z.int(), kept: z.int(), skipped: z.array(CleanupSkippedSchema) })
  .meta({ id: 'CleanupCommitResponseDto' });
const CleanupInSpacesResponseSchema = z
  .object({ assetIds: z.array(z.uuid()) })
  .meta({ id: 'CleanupInSpacesResponseDto' });

export class CleanupCountResponseDto extends createZodDto(CleanupCountResponseSchema) {}
export class CleanupTrashResponseDto extends createZodDto(CleanupTrashResponseSchema) {}
export class CleanupCalendarResponseDto extends createZodDto(CleanupCalendarResponseSchema) {}
export class CleanupRewindYearsResponseDto extends createZodDto(CleanupRewindYearsResponseSchema) {}
export class CleanupRewindAssetsResponseDto extends createZodDto(CleanupRewindAssetsResponseSchema) {}
export class CleanupQueuePageDto extends createZodDto(CleanupQueuePageSchema) {}
export class CleanupCommitResponseDto extends createZodDto(CleanupCommitResponseSchema) {}
export class CleanupInSpacesResponseDto extends createZodDto(CleanupInSpacesResponseSchema) {}
export type CleanupAssetDto = z.infer<typeof CleanupAssetSchema>;

import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { AssetTypeSchema, TimeBucketSize, TimeBucketSizeSchema } from 'src/enum.js';
import { boundedTextFilter, stringToBool } from 'src/validation.js';

// Fork timeline query fields and the fork-only cover response, merged into src/dtos/time-bucket.dto.ts with one spread
// and one re-export. Leaf module: it imports nothing from src/dtos/time-bucket.dto.ts.

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ScopedPersonTokenSchema = z
  .string()
  .regex(new RegExp(`^(?:${UUID_PATTERN}|person:${UUID_PATTERN}|space-person:${UUID_PATTERN})$`))
  .describe('Legacy person ID or scoped identity filter token');

/** TimeBucketQueryBaseSchema */
export const GalleryTimeBucketQueryExtension = {
  bucketSize: TimeBucketSizeSchema.optional()
    .default(TimeBucketSize.Month)
    .describe('Timeline bucket granularity. Defaults to month for backwards compatibility'),
  isNotInAlbum: stringToBool.optional().describe('Filter assets not in any album'),
  isInAlbum: stringToBool.optional().describe('Filter assets in at least one album'),
  withSharedSpaces: stringToBool
    .optional()
    .describe('Include assets from shared spaces where the user has timeline enabled'),
  spaceId: z.uuidv4().optional().describe('Filter assets belonging to a specific shared space'),
  spacePersonId: z
    .uuidv4()
    .optional()
    .describe('Filter assets containing a specific shared space person (space face recognition)'),
  personIds: z
    .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(ScopedPersonTokenSchema))
    .optional()
    .describe('Filter assets containing any of these persons (multi-select)'),
  spacePersonIds: z
    .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.uuidv4()))
    .optional()
    .describe('Filter assets containing any of these shared space persons (multi-select)'),
  tagIds: z
    .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.uuidv4()))
    .optional()
    .describe('Filter assets with any of these tags (multi-select)'),
  city: z.string().optional().describe('Filter by city name'),
  country: z.string().optional().describe('Filter by country name'),
  make: z.string().optional().describe('Filter by camera make'),
  model: z.string().optional().describe('Filter by camera model'),
  lensModel: z.string().optional().describe('Filter by camera lens model'),
  state: z.string().optional().describe('Filter by state/province name'),
  ownerId: z
    .uuidv4()
    .optional()
    .describe(
      'Filter by asset owner (contributor). Narrows within the current scope and never widens it. This is NOT the same as userId, which selects whose timeline is being composed.',
    ),
  originalFileName: boundedTextFilter()
    .optional()
    .describe('Filter by original filename (substring, case/accent-insensitive)'),
  description: boundedTextFilter()
    .optional()
    .describe('Filter by asset description (substring, case/accent-insensitive)'),
  ocr: boundedTextFilter().optional().describe('Filter by OCR text content (substring, case/accent-insensitive)'),
  rating: z.coerce.number().int().min(1).max(5).optional().describe('Minimum star rating (>=)'),
  type: AssetTypeSchema.optional().describe('Filter by asset type (IMAGE or VIDEO)'),
  takenAfter: z
    .string()
    .optional()
    .describe('Only include assets taken on or after this local date and time (ISO 8601, inclusive)'),
  takenBefore: z
    .string()
    .optional()
    .describe('Only include assets taken before this local date and time (ISO 8601, exclusive)'),
};

export const TimeBucketCoverResponseSchema = z
  .object({
    timeBucket: z.string().meta({ example: '2024-01-01' }),
    representativeAssetId: z.string().nullable().describe('Representative asset ID for this bucket'),
    representativeThumbhash: z.string().nullable().describe('Representative asset thumbhash, base64 encoded'),
    representativeRatio: z
      .number()
      .meta({ format: 'double' })
      .nullable()
      .describe('Representative asset width/height ratio'),
  })
  .meta({ id: 'TimeBucketCoverResponseDto' });

export class TimeBucketCoverResponseDto extends createZodDto(TimeBucketCoverResponseSchema) {}

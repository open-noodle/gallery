import { QueueName } from 'src/enum';
import z from 'zod';

// Deliberate copy of the module-private `configBool` in src/dtos/config.dto.ts. This module must
// stay a leaf — importing from config.dto.ts would be circular and leave this undefined at
// module-init time. Keep the two in sync; the coercion is what makes IMMICH_CONFIG_FILE string
// booleans parse.
export const galleryConfigBool = z
  .preprocess((val) => {
    if (val === 'true') {
      return true;
    }
    if (val === 'false') {
      return false;
    }
    return val;
  }, z.boolean())
  .meta({ type: 'boolean' });

const GalleryClassificationFaceExclusionSchema = z
  .enum(['off', 'any_assigned_face', 'named_people', 'named_visible_people'])
  .default('off')
  .describe('Face exclusion rule for this classification category')
  .meta({ id: 'ClassificationFaceExclusion' });

export type ClassificationFaceExclusion = z.infer<typeof GalleryClassificationFaceExclusionSchema>;

const GalleryClassificationCategorySchema = z
  .object({
    name: z.string().describe('Category name'),
    prompts: z.array(z.string()).min(1).describe('CLIP text prompts for this category'),
    similarity: z
      .number()
      .meta({ format: 'double' })
      .min(0)
      .max(1)
      .describe('Cosine similarity threshold for matching this category'),
    action: z.enum(['tag', 'tag_and_archive']).describe('Action to take when an asset matches'),
    enabled: z.boolean().describe('Whether this category is enabled'),
    faceExclusion: GalleryClassificationFaceExclusionSchema,
  })
  .meta({ id: 'AdminConfigClassificationCategoryDto' });

export const GalleryClassificationSchema = z
  .object({
    enabled: galleryConfigBool.describe('Enable classification globally'),
    categories: z
      .array(GalleryClassificationCategorySchema)
      .refine((cats) => new Set(cats.map((c) => c.name)).size === cats.length, {
        message: 'Category names must be unique',
      })
      .describe('Classification categories'),
  })
  .meta({ id: 'AdminConfigClassificationDto' });

export const GalleryMemoriesSchema = z
  .object({
    retentionDays: z.coerce.number().int().min(0).describe('Retention days'),
    /** @deprecated superseded by `types['birthday']`; kept for back-compat */
    birthday: galleryConfigBool.describe('Birthday memories'),
    /** @deprecated superseded by `types['recent_trip']`; kept for back-compat */
    recentTrips: galleryConfigBool.describe('Recent trip memories'),
    types: z.record(z.string(), z.boolean()).default({}).describe('Per-type memory availability overrides'),
  })
  .meta({ id: 'AdminConfigMemoriesDto' });

// Gallery-fork: opt-in accounting for server-generated files (thumbnails, transcodes).
export const GalleryStorageUsageSchema = z
  .object({
    includeDerivatives: galleryConfigBool.describe('Include thumbnails and transcoded videos in storage usage'),
  })
  .meta({ id: 'AdminConfigStorageUsageDto' });

// NOT built from AdminConfigMachineLearningModelSchema: that schema's `enabled` leaf is annotated
// `visibility: User`, which would expose pet detection to every logged-in user. Pet detection is
// surfaced to no client today, so it stays admin-only like every other fork config field.
export const GalleryPetDetectionSchema = z
  .object({
    enabled: z.boolean().describe('Whether the task is enabled'),
    modelName: z.string().min(1).describe('Name of the model to use'),
    minScore: z
      .number()
      .meta({ format: 'double' })
      .min(0.1)
      .max(1)
      .describe('Minimum confidence score for pet detection'),
  })
  .meta({ id: 'AdminConfigPetDetectionDto' });

export const GalleryFaceSuggestionSchema = z
  .object({
    enabled: z.boolean().describe('Whether face suggestions are enabled'),
    maxDistance: z
      .number()
      .meta({ format: 'double' })
      .min(0.1)
      .max(2)
      .describe('Maximum embedding distance for a face to be surfaced as a suggestion on a named person'),
  })
  .meta({ id: 'AdminConfigFaceSuggestionDto' });

export const GalleryClipExtension = {
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0)
    .max(2)
    .describe('Maximum cosine distance for smart search results. 0 = disabled.'),
};

export const GalleryServerExtension = {
  mergePeopleAcrossOwners: galleryConfigBool.describe(
    "Allow a people merge to combine two of another user's people, or two people in a shared space the actor cannot edit, into one (a destructive collapse). Re-points that only move a single person to another identity are always allowed. When off, such combining merges are blocked; when on, each still requires an explicit confirmation.",
  ),
};

export const galleryJobDefaults = {
  [QueueName.PeopleBackfill]: { concurrency: 1 },
  [QueueName.PetDetection]: { concurrency: 1 },
  [QueueName.Classification]: { concurrency: 1 },
};

export const galleryMachineLearningDefaults = {
  clipMaxDistance: 0,
  faceSuggestions: { enabled: true, maxDistance: 0.7 },
  petDetection: { enabled: false, modelName: 'yolo11s', minScore: 0.6 },
};

export const galleryServerDefaults = { mergePeopleAcrossOwners: false };

export const galleryTopLevelDefaults = {
  memories: { retentionDays: 365, birthday: true, recentTrips: true, types: {} },
  classification: { enabled: true, categories: [] },
  // Gallery-fork: defaults to false, so out of the box storage usage matches upstream Immich
  // and counts original files only.
  storageUsage: { includeDerivatives: false },
};

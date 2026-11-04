import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { SourceTypeSchema } from 'src/enum.js';
import { stringToBool } from 'src/validation.js';

// Fork person DTOs and the fork fields of upstream's person schemas, merged into src/dtos/person.dto.ts with one
// spread or `.extend(...)` per schema and one re-export. Leaf module: it imports nothing from src/dtos/person.dto.ts.

/** MergePersonSchema: overrides upstream's `ids`. */
export const GalleryMergePersonExtension = {
  // Capped so a single request cannot hold the instance-wide merge advisory lock while doing one DB round-trip
  // per source (design §5.2 row 6; the web UI caps at 5).
  ids: z.array(z.uuidv4()).max(20).describe('Person IDs to merge'),
  confirmCrossOwner: z
    .boolean()
    .optional()
    .describe(
      'Acknowledgement that this merge will combine two people belonging to another user, which cannot be undone. Required to commit such a merge.',
    ),
};

const ScopedPersonProfileRefSchema = z
  .object({
    type: z.enum(['person', 'space-person']).describe('Scoped profile type'),
    id: z.uuidv4().describe('Scoped profile ID'),
    spaceId: z.uuidv4().optional().describe('Space ID for Space Person refs'),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'space-person' && !value.spaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['spaceId'],
        message: 'spaceId is required for space-person refs',
      });
    }
  })
  .meta({ id: 'ScopedPersonProfileRefDto' });

const MergeScopedPeopleSchema = z
  .object({
    target: ScopedPersonProfileRefSchema.describe('Target scoped profile'),
    // Capped so a single request cannot hold the instance-wide merge advisory lock while doing one DB round-trip
    // per source (design §5.2 row 6; the web UI caps at 5).
    sources: z.array(ScopedPersonProfileRefSchema).min(1).max(20).describe('Source scoped profiles'),
    confirmCrossOwner: z
      .boolean()
      .optional()
      .describe(
        'Acknowledgement that this merge will combine two people belonging to another user, which cannot be undone. Required to commit such a merge.',
      ),
  })
  .meta({ id: 'MergeScopedPeopleDto' });

const DetachScopedPersonSchema = z
  .object({
    profile: ScopedPersonProfileRefSchema.describe('Scoped profile to detach'),
  })
  .meta({ id: 'DetachScopedPersonDto' });

/** PersonSearchSchema */
export const GalleryPersonSearchExtension = {
  withSharedSpaces: stringToBool
    .optional()
    .describe('Include identity-grouped people from timeline-enabled shared spaces'),
  type: z
    .enum(['person', 'pet'])
    .optional()
    .describe(
      'Filter the list. `person` returns human people. `pet` returns the individual pets that pet ' +
        'recognition identified, and the People-page minimumFaces threshold is waived. Species buckets, which ' +
        'the detector produces without an embedding, are never listed. Omit for the unfiltered list.',
    ),
};

export const ScopedPrimaryProfileSchema = z
  .object({
    type: z.enum(['user-person', 'space-person']),
    id: z.string(),
    spaceId: z.string().optional(),
  })
  .meta({ id: 'ScopedPrimaryProfile' });

/** PersonResponseSchema */
export const GalleryPersonResponseExtension = {
  primaryProfile: ScopedPrimaryProfileSchema.optional().describe('Accessible profile used for navigation'),
  filterId: z.string().optional().describe('Scoped identity filter token'),
  numberOfAssets: z.number().int().min(0).optional().describe('Accessible asset count for this grouped person'),
  type: z.string().default('person').describe('Entity type (person or pet)'),
  species: z.string().nullable().optional().describe('Pet species (e.g. dog, cat)'),
  spacePersonId: z.string().optional().describe('Space person ID when viewed through a shared space'),
};

export class ScopedPersonProfileRefDto extends createZodDto(ScopedPersonProfileRefSchema) {}
export class MergeScopedPeopleDto extends createZodDto(MergeScopedPeopleSchema) {}
export class DetachScopedPersonDto extends createZodDto(DetachScopedPersonSchema) {}

const PersonFacePageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).describe('Page number'),
    size: z.coerce.number().int().min(1).max(100).default(50).describe('Number of faces per page'),
  })
  .meta({ id: 'PersonFacePageQueryDto' });

const RepresentativeFaceUpdateSchema = z
  .object({
    assetFaceId: z.uuidv4().describe('Asset face ID used as the representative face'),
  })
  .meta({ id: 'RepresentativeFaceUpdateDto' });

const PersonFaceResponseSchema = z
  .object({
    id: z.uuidv4().describe('Face ID'),
    imageHeight: z.int().min(0).describe('Image height in pixels'),
    imageWidth: z.int().min(0).describe('Image width in pixels'),
    boundingBoxX1: z.int().describe('Bounding box X1 coordinate'),
    boundingBoxX2: z.int().describe('Bounding box X2 coordinate'),
    boundingBoxY1: z.int().describe('Bounding box Y1 coordinate'),
    boundingBoxY2: z.int().describe('Bounding box Y2 coordinate'),
    sourceType: SourceTypeSchema.optional(),
    assetId: z.uuidv4().describe('Asset ID containing the face'),
    isRepresentative: z.boolean().describe('Whether this face is the current representative face'),
    fileCreatedAt: z.string().meta({ format: 'date-time' }).optional().describe('Asset creation date'),
  })
  .meta({ id: 'PersonFaceResponseDto' });

const PersonFacePageResponseSchema = z
  .object({
    faces: z.array(PersonFaceResponseSchema),
    hasNextPage: z.boolean(),
  })
  .meta({ id: 'PersonFacePageResponseDto' });

export class PersonFacePageQueryDto extends createZodDto(PersonFacePageQuerySchema) {}
export class RepresentativeFaceUpdateDto extends createZodDto(RepresentativeFaceUpdateSchema) {}
export class PersonFaceResponseDto extends createZodDto(PersonFaceResponseSchema) {}
export class PersonFacePageResponseDto extends createZodDto(PersonFacePageResponseSchema) {}

const PersonFaceSuggestionPageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).describe('Page number'),
    size: z.coerce.number().int().min(1).max(100).default(50).describe('Number of suggestions per page'),
  })
  .meta({ id: 'PersonFaceSuggestionPageQueryDto' });

const PersonFaceSuggestionParamsSchema = z
  .object({
    id: z.uuidv4().describe('Person ID'),
    assetFaceId: z.uuidv4().describe('Unassigned asset face ID being reviewed'),
  })
  .meta({ id: 'PersonFaceSuggestionParamsDto' });

const PersonFaceSuggestionResponseSchema = z
  .object({
    assetFaceId: z.uuidv4().describe('Unassigned asset face ID'),
    assetId: z.uuidv4().describe('Asset ID containing the candidate face'),
    distance: z.number().meta({ format: 'double' }).describe('Embedding distance to the person'),
    imageHeight: z.int().min(0).describe('Image height in pixels'),
    imageWidth: z.int().min(0).describe('Image width in pixels'),
    boundingBoxX1: z.int().describe('Bounding box X1 coordinate'),
    boundingBoxX2: z.int().describe('Bounding box X2 coordinate'),
    boundingBoxY1: z.int().describe('Bounding box Y1 coordinate'),
    boundingBoxY2: z.int().describe('Bounding box Y2 coordinate'),
    fileCreatedAt: z.string().meta({ format: 'date-time' }).optional().describe('Asset creation date'),
  })
  .meta({ id: 'PersonFaceSuggestionResponseDto' });

const PersonFaceSuggestionPageResponseSchema = z
  .object({
    total: z.int().min(0).describe('Total in-band pending suggestions for this person'),
    items: z.array(PersonFaceSuggestionResponseSchema),
  })
  .meta({ id: 'PersonFaceSuggestionPageResponseDto' });

// S11b (F24): the outcome of a suggestion action travels in the BODY, not the status code.
// @oazapfts/runtime's ok() resolves to the response body and discards the numeric status for every
// success code, so a 200-vs-204 contract is structurally unreadable by any generated client — the
// caller cannot tell "I acted" from "there was nothing to do". Both are 200; `acted` is the signal.
// Shared by PersonController and SharedSpaceController, which already import from this module.
const FaceSuggestionActionResponseSchema = z
  .object({
    acted: z.boolean().describe('Whether the call changed anything. False when the suggestion was already resolved.'),
  })
  .meta({ id: 'FaceSuggestionActionResponseDto' });

export class PersonFaceSuggestionPageQueryDto extends createZodDto(PersonFaceSuggestionPageQuerySchema) {}
export class PersonFaceSuggestionParamsDto extends createZodDto(PersonFaceSuggestionParamsSchema) {}
export class PersonFaceSuggestionResponseDto extends createZodDto(PersonFaceSuggestionResponseSchema) {}
export class PersonFaceSuggestionPageResponseDto extends createZodDto(PersonFaceSuggestionPageResponseSchema) {}
export class FaceSuggestionActionResponseDto extends createZodDto(FaceSuggestionActionResponseSchema) {}

/** PersonStatisticsResponseSchema: overrides upstream's `assets`. */
export const GalleryPersonStatisticsExtension = {
  assets: z.int().min(0).describe('Number of assets'),
  faces: z.int().min(0).describe('Number of faces assigned to this person in the current accessible scope'),
};

const PeopleStatisticsResponseSchema = z
  .object({
    total: z.int().min(0).describe('Total number of people'),
    hidden: z.int().min(0).describe('Number of hidden people'),
    detectedFaceCount: z.int().min(0).describe('Number of detected faces in the accessible people scope'),
  })
  .meta({ id: 'PeopleStatisticsResponseDto' });

export class PeopleStatisticsResponseDto extends createZodDto(PeopleStatisticsResponseSchema) {}

const PeopleFaceStatisticsResponseSchema = z
  .object({
    detectedFaceCount: z.int().min(0).describe('Number of detected faces in the accessible people scope'),
    assignedVisibleFaceCount: z.int().min(0).describe('Number of detected faces assigned to visible people'),
    namedVisiblePersonCount: z.int().min(0).describe('Number of named visible people in the accessible people scope'),
    assignedHiddenFaceCount: z.int().min(0).describe('Number of detected faces assigned to hidden people'),
    unassignedFaceCount: z.int().min(0).describe('Number of detected faces not assigned to people in this scope'),
  })
  .meta({ id: 'PeopleFaceStatisticsResponseDto' });

export class PeopleFaceStatisticsResponseDto extends createZodDto(PeopleFaceStatisticsResponseSchema) {}

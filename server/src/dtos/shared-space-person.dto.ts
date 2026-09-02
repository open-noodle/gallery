import { createZodDto } from 'nestjs-zod';
import { emptyStringToNull, isoDatetimeToDate, stringToBool } from 'src/validation';
import z from 'zod';

const SpacePeopleQuerySchema = z
  .object({
    takenAfter: isoDatetimeToDate.optional(),
    takenBefore: isoDatetimeToDate.optional(),
    withHidden: stringToBool.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of people to return (named sorted alphabetically, unnamed by asset count)'),
    offset: z.coerce.number().int().min(0).optional().describe('Number of people to skip'),
    named: stringToBool.optional(),
    name: z.string().trim().min(1).max(100).optional().describe('Search by person name'),
  })
  .meta({ id: 'SpacePeopleQueryDto' });

const SharedSpacePersonUpdateSchema = z
  .object({
    name: z.string().max(100).optional().describe('Person name'),
    isHidden: z.boolean().optional().describe('Person visibility (hidden)'),
    birthDate: emptyStringToNull(z.string().nullable())
      .optional()
      .describe('Person date of birth')
      .meta({ format: 'date' }),
    representativeFaceId: z.uuidv4().nullable().optional().describe('Representative face ID'),
  })
  .meta({ id: 'SharedSpacePersonUpdateDto' });

// Spec §6.2 (Slice 4, Task 2): create a space person, optionally attaching a seed face in the
// same transaction.
const SharedSpacePersonCreateSchema = z
  .object({
    name: z.string().max(100).optional().describe('Person name'),
    assetFaceId: z.uuidv4().optional().describe('Seed face to attach to the new person'),
  })
  .meta({ id: 'SharedSpacePersonCreateDto' });

const SharedSpacePersonAliasSchema = z
  .object({
    alias: z.string().trim().min(1).max(100).describe('Alias name for this person'),
  })
  .meta({ id: 'SharedSpacePersonAliasDto' });

const SpaceRepresentativeFaceUpdateSchema = z
  .object({
    assetFaceId: z.uuidv4().nullable().describe('Asset face ID used as the space representative face'),
  })
  .meta({ id: 'SpaceRepresentativeFaceUpdateDto' });

const SharedSpacePersonMergeSchema = z
  .object({
    // Capped so a single request cannot hold the instance-wide merge advisory lock while doing one DB round-trip
    // per source (design §5.2 row 6; the web UI caps at 5).
    ids: z.array(z.uuidv4()).max(20).describe('Person IDs to merge into target'),
    confirmCrossOwner: z
      .boolean()
      .optional()
      .describe(
        'Acknowledgement that this merge will combine two people belonging to another user, which cannot be undone. Required to commit such a merge.',
      ),
  })
  .meta({ id: 'SharedSpacePersonMergeDto' });

const SpacePersonParamsSchema = z
  .object({
    id: z.uuidv4().describe('Shared space ID'),
    personId: z.uuidv4().describe('Space person ID'),
  })
  .meta({ id: 'SpacePersonParamsDto' });

const SpacePersonFaceParamsSchema = SpacePersonParamsSchema.extend({
  assetFaceId: z.uuidv4().describe('Asset face ID'),
}).meta({ id: 'SpacePersonFaceParamsDto' });

const SpaceAssetFacesParamsSchema = z
  .object({
    id: z.uuidv4().describe('Shared space ID'),
    assetId: z.uuidv4().describe('Asset ID'),
  })
  .meta({ id: 'SpaceAssetFacesParamsDto' });

// Spec §6.6 (Slice 6, Task 3): delete a face box an editor drew.
const SpaceFaceParamsSchema = z
  .object({
    id: z.uuidv4().describe('Shared space ID'),
    assetFaceId: z.uuidv4().describe('Asset face ID'),
  })
  .meta({ id: 'SpaceFaceParamsDto' });

// Spec §6.5 (Slice 6, Task 2): draw a face box on a member's asset. imageWidth/imageHeight are the
// dimensions of the (possibly edited) PREVIEW the client drew on -- mirrors AssetFaceCreateDto's
// own shape, since both feed the same coordinate transform (convertFaceBoxToOriginalImageSpace).
const SpaceAssetFaceCreateSchema = z
  .object({
    spacePersonId: z.uuidv4().describe('Space person ID this face will be attached to'),
    imageWidth: z.int().describe('Image width in pixels (of the preview the box was drawn on)'),
    imageHeight: z.int().describe('Image height in pixels (of the preview the box was drawn on)'),
    x: z.int().describe('Face bounding box X coordinate'),
    y: z.int().describe('Face bounding box Y coordinate'),
    width: z.int().describe('Face bounding box width'),
    height: z.int().describe('Face bounding box height'),
  })
  .meta({ id: 'SpaceAssetFaceCreateDto' });

const SpacePersonFaceSuggestionParamsSchema = SpacePersonParamsSchema.extend({
  assetFaceId: z.uuidv4().describe('Unassigned asset face ID being reviewed'),
}).meta({ id: 'SpacePersonFaceSuggestionParamsDto' });

const SharedSpacePersonResponseSchema = z
  .object({
    id: z.string().describe('Person ID'),
    spaceId: z.string().describe('Space ID'),
    name: z.string().describe('Person name'),
    thumbnailPath: z.string().describe('Thumbnail path'),
    isHidden: z.boolean().describe('Is hidden'),
    birthDate: z.string().nullable().optional().describe('Person date of birth').meta({ format: 'date' }),
    representativeFaceId: z.string().nullable().optional().describe('Representative face ID'),
    representativeFaceSource: z.enum(['auto', 'manual']).describe('Representative face source'),
    faceCount: z.number().describe('Number of faces assigned to this person'),
    assetCount: z.number().describe('Number of unique assets with this person'),
    alias: z.string().nullable().optional().describe('User-specific alias for this person'),
    createdAt: z.string().describe('Creation date'),
    updatedAt: z.string().describe('Last update date'),
    type: z.string().optional().describe('Person type (person or pet)'),
  })
  .meta({ id: 'SharedSpacePersonResponseDto' });

// Spec §6.1 (Slice 3): one row per live, visible face on an asset, space-scoped. `spacePersonId`/
// `spacePersonName` are the SPACE's own person, never the owner's `person.name`. `isEditorDrawn`
// (Slice 9, spec §6.6) is the derived boolean `asset_face.createdBy IS NOT NULL` — the raw
// `createdBy` (who drew it) is deliberately NOT exposed here; every space member does not need to
// know which editor drew a box, only whether it is deletable.
const SpaceAssetFaceResponseSchema = z
  .object({
    id: z.uuidv4().describe('Asset face ID'),
    boundingBoxX1: z.number().describe('Bounding box X1'),
    boundingBoxY1: z.number().describe('Bounding box Y1'),
    boundingBoxX2: z.number().describe('Bounding box X2'),
    boundingBoxY2: z.number().describe('Bounding box Y2'),
    imageWidth: z.number().describe('Original image width'),
    imageHeight: z.number().describe('Original image height'),
    spacePersonId: z.uuidv4().nullable().describe('Space person ID this face is attached to, if any'),
    spacePersonName: z.string().nullable().describe('Space person name this face is attached to, if any'),
    isEditorDrawn: z
      .boolean()
      .describe('Whether this face box was drawn by a space Owner/Editor, and so may be deleted by one'),
  })
  .meta({ id: 'SpaceAssetFaceResponseDto' });

const SharedSpacePeopleStatisticsResponseSchema = z
  .object({
    total: z.int().min(0).describe('Total number of people'),
    hidden: z.int().min(0).describe('Number of hidden people'),
    detectedFaceCount: z.int().min(0).describe('Number of detected faces in the shared-space people scope'),
  })
  .meta({ id: 'SharedSpacePeopleStatisticsResponseDto' });

export class SpacePeopleQueryDto extends createZodDto(SpacePeopleQuerySchema) {}
export class SharedSpacePersonCreateDto extends createZodDto(SharedSpacePersonCreateSchema) {}
export class SharedSpacePersonUpdateDto extends createZodDto(SharedSpacePersonUpdateSchema) {}
export class SharedSpacePersonAliasDto extends createZodDto(SharedSpacePersonAliasSchema) {}
export class SpaceRepresentativeFaceUpdateDto extends createZodDto(SpaceRepresentativeFaceUpdateSchema) {}
export class SharedSpacePersonMergeDto extends createZodDto(SharedSpacePersonMergeSchema) {}
export class SpacePersonParamsDto extends createZodDto(SpacePersonParamsSchema) {}
export class SpacePersonFaceParamsDto extends createZodDto(SpacePersonFaceParamsSchema) {}
export class SpacePersonFaceSuggestionParamsDto extends createZodDto(SpacePersonFaceSuggestionParamsSchema) {}
export class SpaceAssetFacesParamsDto extends createZodDto(SpaceAssetFacesParamsSchema) {}
export class SpaceAssetFaceCreateDto extends createZodDto(SpaceAssetFaceCreateSchema) {}
export class SpaceFaceParamsDto extends createZodDto(SpaceFaceParamsSchema) {}
export class SharedSpacePersonResponseDto extends createZodDto(SharedSpacePersonResponseSchema) {}
export class SharedSpacePeopleStatisticsResponseDto extends createZodDto(SharedSpacePeopleStatisticsResponseSchema) {}
export class SpaceAssetFaceResponseDto extends createZodDto(SpaceAssetFaceResponseSchema) {}

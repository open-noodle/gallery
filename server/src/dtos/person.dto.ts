import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import type { ImageDimensions, MaybeDehydrated } from 'src/types.js';
import { AssetFace, Person, PersonUser, User } from 'src/database.js';
import { HistoryBuilder } from 'src/decorators.js';
import { BulkIdsSchema } from 'src/dtos/asset-ids.response.dto.js';
import { AssetEditActionItem } from 'src/dtos/editing.dto.js';
import { UserResponseSchema, mapUser } from 'src/dtos/user.dto.js';
import { SharingDirectionSchema, SourceTypeSchema } from 'src/enum.js';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { asDateString, asDateTimeString } from 'src/utils/date.js';
import { hasSomeDefined } from 'src/utils/misc.js';
import { transformFaceBoundingBox } from 'src/utils/transform.js';
import { hexColor, stringToBool, uniqueIds } from 'src/validation.js';

const PersonCreateSchema = z
  .object({
    name: z.string().optional().describe('Person name'),
    birthDate: z
      .string()
      .meta({ format: 'date' })
      .nullable()
      .optional()
      .refine((val) => (val ? new Date(val) <= new Date() : true), { error: 'Birth date cannot be in the future' })
      .describe('Person date of birth'),
    isHidden: z.boolean().optional().describe('Person visibility (hidden)'),
    isFavorite: z.boolean().optional().describe('Mark as favorite'),
    color: hexColor.nullable().optional().describe('Person color (hex)'),
  })
  .meta({ id: 'PersonCreateDto' });

const PersonUpdateBaseSchema = PersonCreateSchema.extend({
  featureFaceAssetId: z.uuidv4().optional().describe('Asset ID used for feature face thumbnail'),
});

const PersonUpdateSchema = PersonUpdateBaseSchema.extend({
  userId: z.uuid().optional().describe('Restrict the update to the person record of this User ID'),
})
  .refine((dto) => Object.entries(dto).some(([key, value]) => key !== 'userId' && value !== undefined), {
    message: `At least one of the following fields is required: ${Object.keys(PersonUpdateBaseSchema.shape).join(', ')}`,
  })
  .meta({ id: 'PersonUpdateDto' });

const PeopleUpdateItemSchema = PersonUpdateSchema.extend({
  id: z.uuidv4().describe('Person ID'),
}).meta({ id: 'PeopleUpdateItem' });

const PeopleUpdateSchema = z
  .object({
    people: z.array(PeopleUpdateItemSchema).describe('People to update'),
  })
  .meta({ id: 'PeopleUpdateDto' });

const MergePersonSchema = z
  .object({
    ids: z.array(z.uuidv4()).describe('Person IDs to merge'),
  })
  .meta({ id: 'MergePersonDto' });

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
    sources: z.array(ScopedPersonProfileRefSchema).min(1).describe('Source scoped profiles'),
  })
  .meta({ id: 'MergeScopedPeopleDto' });

const DetachScopedPersonSchema = z
  .object({
    profile: ScopedPersonProfileRefSchema.describe('Scoped profile to detach'),
  })
  .meta({ id: 'DetachScopedPersonDto' });

const PersonSearchSchema = z
  .object({
    withHidden: stringToBool.optional().describe('Include hidden people'),
    withSharedSpaces: stringToBool
      .optional()
      .describe('Include identity-grouped people from timeline-enabled shared spaces'),
    closestPersonId: z.uuidv4().optional().describe('Closest person ID for similarity search'),
    closestAssetId: z.uuidv4().optional().describe('Closest asset ID for similarity search'),
    page: z.coerce.number().int().min(1).default(1).describe('Page number for pagination'),
    size: z.coerce.number().int().min(1).max(1000).default(500).describe('Number of items per page'),
    sharedById: z.uuid().optional().describe('Only include people to which the user gave access'),
    sharedWithId: z.uuid().optional().describe('Only include people to which the user was given access'),
    isFavorite: stringToBool.optional().describe('Filter by favorite status'),
    isHidden: stringToBool.optional().describe('Filter by hidden status'),
  })
  .meta({ id: 'PersonSearchDto' });

export const ScopedPrimaryProfileSchema = z
  .object({
    type: z.enum(['user-person', 'space-person']),
    id: z.string(),
    spaceId: z.string().optional(),
  })
  .meta({ id: 'ScopedPrimaryProfile' });

export const PersonResponseSchema = z
  .object({
    id: z.uuidv4().describe('Person ID'),
    name: z.string().describe('Person name'),
    // TODO: use `isoDateToDate` when using `ZodSerializerDto` on the controllers.
    birthDate: z.string().meta({ format: 'date' }).describe('Person date of birth').nullable(),
    thumbnailPath: z.string().describe('Thumbnail path'),
    isHidden: z.boolean().describe('Is hidden'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    updatedAt: z
      .string()
      .meta({ format: 'date-time' })
      .optional()
      .describe('Last update date')
      .meta(new HistoryBuilder().added('v1.107.0').stable('v2').getExtensions()),
    isFavorite: z
      .boolean()
      .optional()
      .describe('Is favorite')
      .meta(new HistoryBuilder().added('v1.126.0').stable('v2').getExtensions()),
    color: z
      .string()
      .optional()
      .describe('Person color (hex)')
      .meta(new HistoryBuilder().added('v1.126.0').stable('v2').getExtensions()),
    primaryProfile: ScopedPrimaryProfileSchema.optional().describe('Accessible profile used for navigation'),
    filterId: z.string().optional().describe('Scoped identity filter token'),
    numberOfAssets: z.number().int().min(0).optional().describe('Accessible asset count for this grouped person'),
    type: z.string().default('person').describe('Entity type (person or pet)'),
    species: z.string().nullable().optional().describe('Pet species (e.g. dog, cat)'),
    spacePersonId: z.string().optional().describe('Space person ID when viewed through a shared space'),
  })
  .meta({ id: 'PersonResponseDto' });

const PersonDeleteSchema = z
  .object({ userId: z.string().optional() })
  .default({})
  .meta({ id: 'PersonDeleteDto', ...new HistoryBuilder().added('v3.3').stable('v3.3').getExtensions() });
// TODO(v4) change to {userId: string, personId: string}[]
const PeopleDeleteSchema = BulkIdsSchema.extend({ userId: z.string().optional() }).meta({
  id: 'PeopleDeleteDto',
  ...new HistoryBuilder().added('v3.3').getExtensions(),
});

export class PersonCreateDto extends createZodDto(PersonCreateSchema) {}
export class PersonUpdateDto extends createZodDto(PersonUpdateSchema) {}
export class PersonDeleteDto extends createZodDto(PersonDeleteSchema) {}
export class PeopleDeleteDto extends createZodDto(PeopleDeleteSchema) {}
export class PeopleUpdateDto extends createZodDto(PeopleUpdateSchema) {}
export class MergePersonDto extends createZodDto(MergePersonSchema) {}
export class ScopedPersonProfileRefDto extends createZodDto(ScopedPersonProfileRefSchema) {}
export class MergeScopedPeopleDto extends createZodDto(MergeScopedPeopleSchema) {}
export class DetachScopedPersonDto extends createZodDto(DetachScopedPersonSchema) {}
export class PersonSearchDto extends createZodDto(PersonSearchSchema) {}
export class PersonResponseDto extends createZodDto(PersonResponseSchema) {}
export class PeopleUserResponseDto extends createZodDto(PeopleUserResponseSchema) {}

const AssetFaceResponseSchema = z
  .object({
    id: z.uuidv4().describe('Face ID'),
    imageHeight: z.int().min(0).describe('Image height in pixels'),
    imageWidth: z.int().min(0).describe('Image width in pixels'),
    boundingBoxX1: z.int().describe('Bounding box X1 coordinate'),
    boundingBoxX2: z.int().describe('Bounding box X2 coordinate'),
    boundingBoxY1: z.int().describe('Bounding box Y1 coordinate'),
    boundingBoxY2: z.int().describe('Bounding box Y2 coordinate'),
    sourceType: SourceTypeSchema.optional(),
    person: PersonResponseSchema.nullable(),
  })
  .describe('Asset face with person')
  .meta({ id: 'AssetFaceResponseDto' });

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


export class AssetFaceResponseDto extends createZodDto(AssetFaceResponseSchema) {}

const AssetFaceUpdateItemSchema = z
  .object({
    personId: z.uuidv4().describe('Person ID'),
    assetId: z.uuidv4().describe('Asset ID'),
    userId: z.uuidv4().optional().describe('User ID'),
  })
  .meta({ id: 'AssetFaceUpdateItem' });

const AssetFaceUpdateSchema = z
  .object({
    data: z.array(AssetFaceUpdateItemSchema).describe('Face update items'),
  })
  .meta({ id: 'AssetFaceUpdateDto' });

const FaceSchema = z
  .object({
    id: z.uuidv4().describe('Face ID'),
  })
  .meta({ id: 'FaceDto' });

const AssetFaceCreateSchema = AssetFaceUpdateItemSchema.extend({
  imageWidth: z.int().describe('Image width in pixels'),
  imageHeight: z.int().describe('Image height in pixels'),
  x: z.int().describe('Face bounding box X coordinate'),
  y: z.int().describe('Face bounding box Y coordinate'),
  width: z.int().describe('Face bounding box width'),
  height: z.int().describe('Face bounding box height'),
}).meta({ id: 'AssetFaceCreateDto' });

const AssetFaceDeleteSchema = z
  .object({
    force: z.boolean().describe('Force delete even if person has other faces'),
  })
  .meta({ id: 'AssetFaceDeleteDto' });

const PersonStatisticsResponseSchema = z
  .object({
    assets: z.int().min(0).describe('Number of assets'),
    faces: z.int().min(0).describe('Number of faces assigned to this person in the current accessible scope'),
  })
  .meta({ id: 'PersonStatisticsResponseDto' });

const PersonUsersResponseSchema = z
  .array(
    z.object({
      personId: z.uuid().describe('Person ID'),
      sharedById: z.uuid().describe('User ID of the user that gave access to this person'),
      sharedWithId: z.uuid().describe('User ID of the user that was given access to this person'),
      sharedBy: UserResponseSchema.describe('The user that gave access to this person'),
      sharedWith: UserResponseSchema.describe('The user that was given access to this person'),
      role: PersonUserRoleSchema.describe('Access role'),
    }),
  )
  .meta({ id: 'PersonUsersResponseDto' });

const PersonUsersSearchSchema = z
  .object({
    personId: z.uuid().optional().describe('Person ID'),
    direction: SharingDirectionSchema.optional(),
    sharedById: z.uuid().optional().describe('User ID of the user that gave access'),
    sharedWithId: z.uuid().optional().describe('User ID of the user that was given access'),
    role: PersonUserRoleSchema.optional().describe('Role of user'),
  })
  .meta({ id: 'PersonUsersSearchDto' });

const PeopleUsersUpsertSchema = z
  .object({
    personIds: uniqueIds.optional().describe('Person IDs, required when type is omitted'),
    type: PeopleUsersUpsertTypeSchema.optional(),
    sharedWithIds: uniqueIds.describe('User IDs that should be given access to the person'),
    role: PersonUserRoleSchema.describe('Role that should be applied'),
  })
  .refine((data) => hasSomeDefined([data.personIds, data.type]), {
    error: 'Either personIds or type must be provided',
    path: ['personIds'],
  })
  .meta({ id: 'PeopleUsersUpsertDto' });

const PersonUsersDeleteSchema = z
  .array(
    z.object({
      personId: z.uuid().describe('Person ID'),
      sharedWithId: z.uuid().describe('User ID of the user that was given access to the person'),
      sharedById: z.uuid().optional().describe('User ID of the user that gave access to the person'),
    }),
  )
  .meta({ id: 'PersonUsersDeleteDto' });

export class AssetFaceUpdateDto extends createZodDto(AssetFaceUpdateSchema) {}
export class FaceDto extends createZodDto(FaceSchema) {}
export class AssetFaceCreateDto extends createZodDto(AssetFaceCreateSchema) {}
export class AssetFaceDeleteDto extends createZodDto(AssetFaceDeleteSchema) {}
export class PersonStatisticsResponseDto extends createZodDto(PersonStatisticsResponseSchema) {}
export class PersonUsersResponseDto extends createZodDto(PersonUsersResponseSchema) {}
export class PersonUsersSearchDto extends createZodDto(PersonUsersSearchSchema) {}
export class PeopleUsersUpsertDto extends createZodDto(PeopleUsersUpsertSchema) {}
export class PersonUsersDeleteDto extends createZodDto(PersonUsersDeleteSchema) {}

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

const PeopleResponseSchema = z
  .object({
    total: z.int().min(0).describe('Total number of people'),
    hidden: z.int().min(0).describe('Number of hidden people'),
    people: z.array(PersonResponseSchema),
    // TODO: make required after a few versions
    hasNextPage: z
      .boolean()
      .optional()
      .describe('Whether there are more pages')
      .meta(new HistoryBuilder().added('v1.110.0').stable('v2').getExtensions()),
  })
  .describe('People response');
export class PeopleResponseDto extends createZodDto(PeopleResponseSchema) {}

type OptionalKeys = 'otherPeople' | 'sharedBy' | 'sharedWith';

export function mapPerson(
  person: MaybeDehydrated<Omit<Person, OptionalKeys> & Partial<Pick<Person, OptionalKeys>>>,
): PersonResponseDto {
  return {
    id: person.personGroupId,
    name: person.name,
    birthDate: asDateString(person.birthDate),
    thumbnailPath: person.thumbnailPath,
    isHidden: person.isHidden,
    isFavorite: person.isFavorite,
    color: person.color ?? undefined,
    updatedAt: asDateTimeString(person.updatedAt),
    type: person.type,
    species: person.species,
  };
}

const mapPeopleUser = (user: MaybeDehydrated<PersonUser>): PeopleUserResponseDto => ({
  ...mapUser(user),
  role: user.role,
});

type PersonUserShare = {
  personId: string;
  sharedById: string;
  sharedWithId: string;
  role: PersonUserRole;
  sharedBy: MaybeDehydrated<User>;
  sharedWith: MaybeDehydrated<User>;
};

export const mapPersonUsers = (shares: PersonUserShare[]): PersonUsersResponseDto =>
  shares.map((share) => ({
    personId: share.personId,
    sharedById: share.sharedById,
    sharedWithId: share.sharedWithId,
    role: share.role,
    sharedBy: mapUser(share.sharedBy),
    sharedWith: mapUser(share.sharedWith),
  }));

function mapFacesWithoutPerson(
  face: MaybeDehydrated<Selectable<AssetFaceTable>>,
  edits?: AssetEditActionItem[],
  assetDimensions?: ImageDimensions,
) {
  return {
    id: face.id,
    ...transformFaceBoundingBox(
      {
        boundingBoxX1: face.boundingBoxX1,
        boundingBoxY1: face.boundingBoxY1,
        boundingBoxX2: face.boundingBoxX2,
        boundingBoxY2: face.boundingBoxY2,
        imageWidth: face.imageWidth,
        imageHeight: face.imageHeight,
      },
      edits ?? [],
      assetDimensions ?? { width: face.imageWidth, height: face.imageHeight },
    ),
    sourceType: face.sourceType,
  };
}

export function mapFaces(
  face: AssetFace,
  edits?: AssetEditActionItem[],
  assetDimensions?: ImageDimensions,
): AssetFaceResponseDto {
  return {
    ...mapFacesWithoutPerson(face, edits, assetDimensions),
    person: face.person ? mapPerson(face.person) : null,
  };
}

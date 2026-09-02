import { createZodDto } from 'nestjs-zod';
import { AlbumResponseSchema } from 'src/dtos/album.dto';
import { SharedSpaceRole, UserAvatarColor, UserAvatarColorSchema } from 'src/enum';
import z from 'zod';

const SharedSpaceRoleSchema = z.enum(SharedSpaceRole).meta({ id: 'SharedSpaceRole' });

const SharedSpaceCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe('Space name'),
    description: z.string().max(500).optional().describe('Space description'),
    color: UserAvatarColorSchema.default(UserAvatarColor.Primary).optional().describe('Space color'),
  })
  .meta({ id: 'SharedSpaceCreateDto' });

const SharedSpaceUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional().describe('Space name'),
    description: z.string().max(500).optional().describe('Space description'),
    thumbnailAssetId: z.uuidv4().nullable().optional().describe('Thumbnail asset ID'),
    thumbnailCropY: z
      .int()
      .min(0)
      .max(100)
      .nullable()
      .optional()
      .describe('Vertical crop position for cover photo (0-100)'),
    color: UserAvatarColorSchema.optional().describe('Space color'),
    faceRecognitionEnabled: z.boolean().optional().describe('Enable face recognition for this space'),
    petsEnabled: z.boolean().optional().describe('Show pets in space people list'),
  })
  .meta({ id: 'SharedSpaceUpdateDto' });

const SharedSpaceMemberCreateSchema = z
  .object({
    userId: z.uuidv4().describe('User ID'),
    role: SharedSpaceRoleSchema.default(SharedSpaceRole.Viewer).optional().describe('Member role'),
  })
  .meta({ id: 'SharedSpaceMemberCreateDto' });

const SharedSpaceMemberUpdateSchema = z
  .object({
    role: SharedSpaceRoleSchema.describe('Member role'),
  })
  .meta({ id: 'SharedSpaceMemberUpdateDto' });

const SharedSpaceMemberResponseSchema = z
  .object({
    userId: z.string().describe('User ID'),
    name: z.string().describe('User name'),
    email: z.string().describe('User email'),
    role: SharedSpaceRoleSchema.describe('Member role'),
    joinedAt: z.string().describe('Join date'),
    profileImagePath: z.string().optional().describe('Profile image path'),
    profileChangedAt: z.string().optional().describe('Profile change date'),
    avatarColor: z.string().optional().describe('Avatar color'),
    showInTimeline: z.boolean().describe('Show space assets in timeline'),
    sharePersonMetadata: z.boolean().describe('Share person names and birth dates with this space'),
    contributionCount: z.int().optional().describe('Number of photos contributed by this member'),
    lastActiveAt: z.string().nullable().optional().describe('Last time this member added a photo'),
    recentAssetId: z.string().nullable().optional().describe('Most recently added asset ID by this member'),
  })
  .meta({ id: 'SharedSpaceMemberResponseDto' });

const SharedSpaceLinkedLibrarySchema = z
  .object({
    libraryId: z.string(),
    libraryName: z.string(),
    addedById: z.string().nullable(),
    createdAt: z.string().meta({ format: 'date-time' }).describe('Link creation timestamp'),
  })
  .meta({ id: 'SharedSpaceLinkedLibraryDto' });

const LastContributorSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const SharedSpaceResponseSchema = z
  .object({
    id: z.string().describe('Space ID'),
    name: z.string().describe('Space name'),
    description: z.string().nullable().optional().describe('Space description'),
    createdById: z.string().describe('Creator user ID'),
    createdAt: z.string().describe('Creation date'),
    updatedAt: z.string().describe('Last update date'),
    memberCount: z.int().optional().describe('Number of members'),
    assetCount: z.int().optional().describe('Number of assets'),
    albumCount: z.int().optional().describe('Number of linked albums'),
    thumbnailAssetId: z.string().nullable().optional().describe('Thumbnail asset ID'),
    thumbnailCropY: z.int().nullable().optional().describe('Vertical crop position for cover photo (0-100)'),
    color: UserAvatarColorSchema.nullable().optional().describe('Space color'),
    faceRecognitionEnabled: z.boolean().optional().describe('Whether face recognition is enabled for this space'),
    petsEnabled: z.boolean().optional().describe('Whether pets are shown in space people list'),
    hasPets: z.boolean().optional().describe('Whether any pet-type persons exist in this space'),
    lastActivityAt: z.string().nullable().optional().describe('Last activity timestamp (most recent asset add)'),
    recentAssetIds: z.array(z.string()).optional().describe('Recent asset IDs for collage display (up to 4)'),
    recentAssetThumbhashes: z.array(z.string()).optional().describe('Thumbhashes for recent assets (parallel array)'),
    members: z.array(SharedSpaceMemberResponseSchema).optional().describe('Space members (summary)'),
    linkedLibraries: z.array(SharedSpaceLinkedLibrarySchema).optional(),
    newAssetCount: z.int().optional().describe('Number of new assets since last viewed'),
    lastContributor: LastContributorSchema.nullable().optional().describe('Last contributor since last viewed'),
    lastViewedAt: z.string().nullable().optional().describe('When the current user last viewed this space'),
  })
  .meta({ id: 'SharedSpaceResponseDto' });

const SharedSpaceMemberTimelineSchema = z
  .object({
    showInTimeline: z.boolean().describe('Show space assets in personal timeline'),
  })
  .meta({ id: 'SharedSpaceMemberTimelineDto' });

const SharedSpaceMemberPreferencesSchema = z
  .object({
    showInTimeline: z.boolean().optional().describe('Show space assets in personal timeline'),
    sharePersonMetadata: z.boolean().optional().describe('Share person names and birth dates with this space'),
  })
  .meta({ id: 'SharedSpaceMemberPreferencesDto' });

const SharedSpaceMemberMetadataContributionSchema = z
  .object({
    // Deliberately z.boolean() and not z.literal(false): nestjs-zod >= 5.5.0 emits `const` for a
    // literal, which is a JSON-Schema 2020-12 keyword that is not valid in OpenAPI 3.0 (the version
    // this spec targets), and openapi-generator rejects it outright, breaking the Dart client build.
    // Nothing is lost — updateMemberMetadataContribution already rejects a `true` payload with a
    // clearer message than a schema violation would produce.
    sharePersonMetadata: z
      .boolean()
      .describe('Disable person metadata contribution for this member; only false is accepted'),
  })
  .meta({ id: 'SharedSpaceMemberMetadataContributionDto' });

const SharedSpaceLibraryLinkSchema = z
  .object({
    libraryId: z.uuidv4().describe('Library ID'),
  })
  .meta({ id: 'SharedSpaceLibraryLinkDto' });

const SharedSpaceAlbumLinkUpdateSchema = z
  .object({
    showInTimeline: z.boolean().describe('Include this album in the space timeline'),
  })
  .meta({ id: 'SharedSpaceAlbumLinkUpdateDto' });

const SharedSpaceAlbumParamSchema = z.object({
  id: z.uuidv4(),
  albumId: z.uuidv4(),
});

// security-9: every one of these path params is a uuidv4 id in Immich (space.id, user.id,
// shared_space_person.id, asset_face.id for faceId, library.id) — validating them here turns a
// non-UUID path segment into a 400 instead of a raw Postgres 22P02 -> 500.
const SharedSpaceMemberParamSchema = z.object({
  id: z.uuidv4(),
  userId: z.uuidv4(),
});

const SharedSpacePersonParamSchema = z.object({
  id: z.uuidv4(),
  personId: z.uuidv4(),
});

const SharedSpacePersonFaceParamSchema = z.object({
  id: z.uuidv4(),
  personId: z.uuidv4(),
  faceId: z.uuidv4(),
});

const SharedSpaceLibraryParamSchema = z.object({
  id: z.uuidv4(),
  libraryId: z.uuidv4(),
});

const SharedSpaceLinkedAlbumSchema = AlbumResponseSchema.omit({ albumUsers: true })
  .extend({
    ownerId: z.string().describe('User ID of the album owner (non-PII UUID, for group-by-owner)'),
    showInTimeline: z.boolean().describe('Include this album in the space timeline'),
    addedById: z.string().nullable().describe('User who linked the album into the space'),
    linkedAt: z.string().meta({ format: 'date-time' }).describe('Link creation timestamp'),
  })
  .meta({ id: 'SharedSpaceLinkedAlbumDto' });

export const MAX_SPACE_ASSETS_PER_REQUEST = 50_000;

const SharedSpaceAssetAddSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).max(MAX_SPACE_ASSETS_PER_REQUEST).describe('Asset IDs'),
  })
  .meta({ id: 'SharedSpaceAssetAddDto' });

const SharedSpaceAssetRemoveSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).max(MAX_SPACE_ASSETS_PER_REQUEST).describe('Asset IDs'),
  })
  .meta({ id: 'SharedSpaceAssetRemoveDto' });

// A linked album that projects a given asset into the space. Used to explain to the client why an
// asset can't be removed from the space directly (it's present via a linked album — remove it there).
const SharedSpaceAssetLinkedAlbumSchema = z
  .object({
    albumId: z.string().describe('Album ID'),
    albumName: z.string().describe('Album name'),
  })
  .meta({ id: 'SharedSpaceAssetLinkedAlbumDto' });

const SharedSpaceActivityQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().describe('Number of items to return'),
    offset: z.coerce.number().int().min(0).optional().describe('Number of items to skip'),
  })
  .meta({ id: 'SharedSpaceActivityQueryDto' });

const SharedSpaceActivityResponseSchema = z
  .object({
    id: z.string().describe('Activity ID'),
    type: z.string().describe('Activity type'),
    data: z.record(z.string(), z.unknown()).describe('Event-specific data'),
    createdAt: z.string().describe('When the event occurred'),
    userId: z.string().nullable().optional().describe('User ID who performed the action'),
    userName: z.string().nullable().optional().describe('User name'),
    userEmail: z.string().nullable().optional().describe('User email'),
    userProfileImagePath: z.string().nullable().optional().describe('User profile image path'),
    userAvatarColor: z.string().nullable().optional().describe('User avatar color'),
  })
  .meta({ id: 'SharedSpaceActivityResponseDto' });

export class SharedSpaceCreateDto extends createZodDto(SharedSpaceCreateSchema) {}
export class SharedSpaceUpdateDto extends createZodDto(SharedSpaceUpdateSchema) {}
export class SharedSpaceMemberCreateDto extends createZodDto(SharedSpaceMemberCreateSchema) {}
export class SharedSpaceMemberUpdateDto extends createZodDto(SharedSpaceMemberUpdateSchema) {}
export class SharedSpaceMemberResponseDto extends createZodDto(SharedSpaceMemberResponseSchema) {}
export class SharedSpaceLinkedLibraryDto extends createZodDto(SharedSpaceLinkedLibrarySchema) {}
export class SharedSpaceResponseDto extends createZodDto(SharedSpaceResponseSchema) {}
export class SharedSpaceMemberTimelineDto extends createZodDto(SharedSpaceMemberTimelineSchema) {}
export class SharedSpaceMemberPreferencesDto extends createZodDto(SharedSpaceMemberPreferencesSchema) {}
export class SharedSpaceMemberMetadataContributionDto extends createZodDto(
  SharedSpaceMemberMetadataContributionSchema,
) {}
export class SharedSpaceLibraryLinkDto extends createZodDto(SharedSpaceLibraryLinkSchema) {}
export class SharedSpaceAlbumLinkUpdateDto extends createZodDto(SharedSpaceAlbumLinkUpdateSchema) {}
export class SharedSpaceAlbumParamDto extends createZodDto(SharedSpaceAlbumParamSchema) {}
export class SharedSpaceMemberParamDto extends createZodDto(SharedSpaceMemberParamSchema) {}
export class SharedSpacePersonParamDto extends createZodDto(SharedSpacePersonParamSchema) {}
export class SharedSpacePersonFaceParamDto extends createZodDto(SharedSpacePersonFaceParamSchema) {}
export class SharedSpaceLibraryParamDto extends createZodDto(SharedSpaceLibraryParamSchema) {}
export class SharedSpaceLinkedAlbumDto extends createZodDto(SharedSpaceLinkedAlbumSchema) {}
export class SharedSpaceAssetAddDto extends createZodDto(SharedSpaceAssetAddSchema) {}
export class SharedSpaceAssetRemoveDto extends createZodDto(SharedSpaceAssetRemoveSchema) {}
export class SharedSpaceAssetLinkedAlbumDto extends createZodDto(SharedSpaceAssetLinkedAlbumSchema) {}
export class SharedSpaceActivityQueryDto extends createZodDto(SharedSpaceActivityQuerySchema) {}
export class SharedSpaceActivityResponseDto extends createZodDto(SharedSpaceActivityResponseSchema) {}

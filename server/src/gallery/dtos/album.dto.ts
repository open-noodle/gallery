import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { isoDatetimeToDate } from 'src/validation.js';

// Which albums would accept which of a selection, so the add-to-album picker offers only valid targets.
// Mirrors the write paths' checks (AlbumAssetCreate on the album, then AssetShare or a #764 space
// contribution per asset) without writing anything.
const AlbumAddTargetsSchema = z
  .object({
    albumIds: z.array(z.uuidv4()).describe('Candidate album IDs'),
    assetIds: z.array(z.uuidv4()).describe('Asset IDs the caller wants to add'),
  })
  .meta({ id: 'AlbumAddTargetsDto' });

const AlbumAddTargetSchema = z
  .object({
    albumId: z.string().describe('Album ID'),
    acceptedAssetCount: z
      .int()
      .min(0)
      .describe('How many of the requested assets this album accepts (already-present assets included)'),
  })
  .meta({ id: 'AlbumAddTargetDto' });

const AlbumAddTargetsResponseSchema = z
  .object({
    albums: z
      .array(AlbumAddTargetSchema)
      .describe('Requested albums that accept at least one of the assets; all others are omitted'),
    shareableAssetCount: z
      .int()
      .min(0)
      .describe('How many of the requested assets the caller may place in any album, including a new one'),
  })
  .meta({ id: 'AlbumAddTargetsResponseDto' });

export class AlbumAddTargetsDto extends createZodDto(AlbumAddTargetsSchema) {}
export class AlbumAddTargetsResponseDto extends createZodDto(AlbumAddTargetsResponseSchema) {}

// Fork album fields and the fork-only space-link response, merged into src/dtos/album.dto.ts with one spread per schema
// and one re-export. Leaf module: it imports nothing from src/dtos/album.dto.ts.

/** UpdateAlbumSchema */
export const GalleryUpdateAlbumExtension = {
  createdAt: isoDatetimeToDate
    .optional()
    .describe('Album creation date. Must include a timezone designator (Z or ±HH:MM).'),
};

const AlbumSharedSpaceLinkResponseSchema = z
  .object({
    spaceId: z.uuidv4().describe('Shared space ID this album is linked into'),
    spaceName: z.string().describe('Shared space name'),
    linkedById: z.uuidv4().nullable().describe('User who linked the album into the space'),
    showInTimeline: z.boolean().describe('Whether the album appears in the aggregated space timeline'),
  })
  .meta({ id: 'AlbumSharedSpaceLinkResponseDto' });

/** AlbumResponseSchema */
export const GalleryAlbumResponseExtension = {
  // rbac-6: shared-space links for this album — populated ONLY when the caller owns the album.
  sharedSpaceLinks: z.array(AlbumSharedSpaceLinkResponseSchema).optional(),
};

export class AlbumSharedSpaceLinkResponseDto extends createZodDto(AlbumSharedSpaceLinkResponseSchema) {}

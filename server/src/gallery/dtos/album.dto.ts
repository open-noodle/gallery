import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { isoDatetimeToDate } from 'src/validation.js';

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

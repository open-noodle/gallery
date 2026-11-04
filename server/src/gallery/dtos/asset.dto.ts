import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { stringToBool } from 'src/validation.js';

const AssetInfoQuerySchema = z
  .object({
    spaceId: z.uuidv4().optional().describe('Shared space the asset is viewed in, used to resolve its people'),
  })
  .meta({ id: 'AssetInfoQueryDto' });

export class AssetInfoQueryDto extends createZodDto(AssetInfoQuerySchema) {}

/** UpdateAssetBaseSchema: overrides upstream's `isFavorite`. */
export const GalleryUpdateAssetBaseExtension = {
  // #763: deprecated alias for PUT /assets/favorites. Still routes into the SAME service method
  // (AssetService.updateFavorites) as the canonical endpoint, behind this DTO's stricter
  // Permission.AssetUpdate route guard (see specs/2026-07-20-per-user-favorites-design.md §8.1).
  isFavorite: z
    .boolean()
    .optional()
    .describe('Mark as favorite. Deprecated: use PUT /assets/favorites instead (favorites are per-user).'),
};

/** AssetDownloadOriginalSchema */
export const GalleryAssetDownloadOriginalExtension = {
  download: stringToBool.default(false).optional().describe('Return original asset as an attachment download'),
};

const AssetEditableSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).describe('Asset IDs to resolve editability for'),
  })
  .meta({ id: 'AssetEditableDto' });

const AssetEditableResponseSchema = z
  .object({
    editableAssetIds: z.array(z.string()).describe('Subset of the requested IDs the caller may edit'),
  })
  .meta({ id: 'AssetEditableResponseDto' });

// #763: the canonical write surface for favorites. Gated on Permission.AssetRead (own assets,
// shared-space assets at ANY role including viewer, shared-album, partner-shared) — see
// specs/2026-07-20-per-user-favorites-design.md §5.1. `ids` is bounded (E28):
// an explicit, documented limit rather than an unbounded statement.
const AssetFavoriteUpdateSchema = z
  .object({
    ids: z.array(z.uuidv4()).min(1).max(1000).describe('Asset IDs'),
    isFavorite: z.boolean().describe('Favorite state for the requesting user'),
  })
  .meta({ id: 'AssetFavoriteUpdateDto' });

export class AssetEditableDto extends createZodDto(AssetEditableSchema) {}
export class AssetEditableResponseDto extends createZodDto(AssetEditableResponseSchema) {}
export class AssetFavoriteUpdateDto extends createZodDto(AssetFavoriteUpdateSchema) {}

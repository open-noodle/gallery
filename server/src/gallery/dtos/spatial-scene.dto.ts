import { createZodDto } from 'nestjs-zod';
import z from 'zod';

// Spread into GalleryAssetResponseExtension (src/gallery/dtos/asset-response.dto.ts). A leaf module: it must not import from src/dtos.
export const SpatialSceneAssetResponseExtension = {
  spatialScene: z
    .boolean()
    .optional()
    .describe(
      'Whether the viewer offers Spatial Scene for this photo: it has a depth map and the admin offers it on every photo, or the photo counts as suitable. Present only on single-asset reads.',
    ),
  spatialSceneChoice: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'The per-photo choice behind spatialScene: true offered and false not offered whatever the automatic choice says, null for the automatic choice. Present only on single-asset reads while Spatial Scene is enabled.',
    ),
  spatialSceneDepthMapCreatedAt: z
    .string()
    .meta({ format: 'date-time' })
    .optional()
    .describe(
      'When the depth map was made. A client adds it to the depth map URL, so a map made again (another model, a refresh) is not served from its cache. Present only on single-asset reads of a photo with a depth map while Spatial Scene is enabled.',
    ),
};

// Spread into ServerFeaturesSchema. Optional: absent on servers that predate it, which a client reads as off.
export const SpatialSceneServerFeatures = {
  spatialScene: z
    .boolean()
    .optional()
    .describe('Whether Spatial Scene is enabled, so single-asset reads may set spatialScene. Absent on older servers.'),
};

// PUT /assets/{id}/spatial-scene (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions").
const SpatialSceneOfferSchema = z
  .object({
    offered: z
      .boolean()
      .nullable()
      .describe(
        'true offers Spatial Scene on this photo and false stops offering it, whatever the automatic choice says; null returns the photo to the automatic choice',
      ),
  })
  .meta({ id: 'SpatialSceneOfferDto' });

export class SpatialSceneOfferDto extends createZodDto(SpatialSceneOfferSchema) {}

// GET and DELETE /admin/spatial-scene/choices.
const SpatialSceneChoicesResponseSchema = z
  .object({
    count: z.int().min(0).describe('Number of photos with a per-photo choice (for DELETE, the number removed)'),
  })
  .meta({ id: 'SpatialSceneChoicesResponseDto' });

export class SpatialSceneChoicesResponseDto extends createZodDto(SpatialSceneChoicesResponseSchema) {}

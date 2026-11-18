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

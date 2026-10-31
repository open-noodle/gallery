import z from 'zod';

// Spread into AssetResponseSchema. A leaf module: it must not import from src/dtos.
export const GalleryAssetResponseExtension = {
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

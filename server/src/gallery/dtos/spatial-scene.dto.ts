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

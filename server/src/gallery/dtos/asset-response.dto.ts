import z from 'zod';

// Fork asset response fields, merged into AssetResponseSchema in src/dtos/asset-response.dto.ts with one spread.

/** AssetResponseSchema */
export const GalleryAssetResponseExtension = {
  resolvedSpaceId: z.string().optional().describe('Resolved space ID (when server auto-detects space context)'),
  canEdit: z
    .boolean()
    .optional()
    .describe(
      'Whether the caller may edit this asset (owner, or Owner/Editor of a space whose member owns it). Present only on single-asset reads; absent from list responses, where resolving it per asset would be an N+1 access check.',
    ),
};

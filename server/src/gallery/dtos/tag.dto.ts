import z from 'zod';

// Fork tag fields, merged into src/dtos/tag.dto.ts with one spread per schema
// (specs/2026-11-27-bulk-tag-feedback-design.md, "API").

/** TagBulkAssetsResponseSchema */
export const GalleryTagBulkAssetsResponseExtension = {
  taggedAssetIds: z
    .array(z.uuidv4())
    .optional()
    .describe(
      'Requested assets the caller may tag that carry every permitted requested tag after the call, whether the link is new or already existed. Empty when no requested tag is permitted. Absent on older servers.',
    ),
  skippedAssetIds: z
    .array(z.uuidv4())
    .optional()
    .describe('Requested assets the caller may not tag; nothing was written for them. Absent on older servers.'),
  skippedTagIds: z
    .array(z.uuidv4())
    .optional()
    .describe('Requested tag IDs the caller may not use; nothing was written for them. Absent on older servers.'),
};

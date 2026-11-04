import z from 'zod';

// Fork shared-link fields, merged into SharedLinkCreateSchema in src/dtos/shared-link.dto.ts with one spread.

/** SharedLinkCreateSchema */
export const GallerySharedLinkCreateExtension = {
  spaceId: z
    .uuidv4()
    .optional()
    .describe(
      'Shared space this link is created from. Lets the link cover assets contributed by other ' +
        'members, which requires the caller to be an Owner or Editor of the space.',
    ),
};

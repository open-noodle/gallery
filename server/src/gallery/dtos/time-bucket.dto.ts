import { LibraryViewSchema } from 'src/enum.js';

/** Fork fields of the timeline queries, extending upstream's TimeBucketQueryBaseSchema. */
export const GalleryTimeBucketExtension = {
  libraryView: LibraryViewSchema.optional(),
};

import type { CleanupQueueSlug } from '$lib/gallery/cleanup/cleanup';

/** URLs of the Library Cleanup pages, kept out of upstream's `Route` so that file stays upstream text. */
export const CleanupRoute = {
  utility: () => '/utilities/cleanup',
  rewind: ({ monthDay }: { monthDay: number }) => `/utilities/cleanup/rewind/${monthDay}`,
  queue: ({ queue }: { queue: CleanupQueueSlug }) => `/utilities/cleanup/${queue}`,
};

import { authenticate } from '$lib/utils/auth';
import { slugToQueue, type CleanupQueueSlug } from '$lib/utils/cleanup';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

// The queue page fetches its items itself, so a filter change can reset the list without a reload.
export const load = (async ({ url, params, untrack }) => {
  // Opening the viewer changes the URL; untracking it keeps that from reloading the page data.
  await authenticate(new URL(untrack(() => url.href)));
  const slug = params.queue as CleanupQueueSlug;
  const queue = slugToQueue(slug);
  const $t = await getFormatter();

  return {
    slug,
    queue,
    meta: {
      title: $t(`cleanup_queue_${queue}`),
    },
  };
}) satisfies PageLoad;

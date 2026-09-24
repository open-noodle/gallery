import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

// Data is fetched by the page on mount, in parallel, so the hub renders immediately and each
// panel fills in as its request resolves.
export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  return {
    meta: {
      title: $t('cleanup'),
    },
  };
}) satisfies PageLoad;

import { authenticate } from '#lib/utils/auth.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import { getAllSpaces } from '@immich/sdk';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const spaces = await getAllSpaces();
  const $t = await getFormatter();

  return {
    spaces,
    meta: {
      title: $t('spaces'),
    },
  };
}) satisfies PageLoad;

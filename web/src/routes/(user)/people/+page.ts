import { QueryParameter } from '#lib/constants.ts';
import type { PeopleFilter } from '#lib/types.ts';
import { authenticate } from '#lib/utils/auth.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import { getAllPeople } from '@immich/sdk';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);

  const people = await getAllPeople({ withHidden: true, withSharedSpaces: true });
  const $t = await getFormatter();

  return {
    people,
    filter,
    meta: {
      title: $t('people'),
    },
  };
}) satisfies PageLoad;

import { getAllPeople } from '@immich/sdk';
import { QueryParameter } from '$lib/constants';
import type { PeopleFilter } from '$lib/types';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
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

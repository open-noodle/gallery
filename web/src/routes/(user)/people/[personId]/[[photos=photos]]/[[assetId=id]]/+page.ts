import { getPersonOrUnavailable, spacePersonRouteFor } from '#lib/gallery/people/person-page-load.ts';
import { authenticate } from '#lib/utils/auth.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import { getPersonStatistics } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);

  const person = await getPersonOrUnavailable(params.personId);
  const spaceRoute = spacePersonRouteFor(person, url, params.assetId);
  if (spaceRoute) {
    redirect(307, spaceRoute);
  }
  const statistics = await getPersonStatistics({ id: params.personId });
  const $t = await getFormatter();

  return {
    person,
    statistics,
    meta: {
      title: person.name || $t('person'),
    },
  };
}) satisfies PageLoad;

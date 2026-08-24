import { getMembers, getSpace, getSpacePerson, getSpacePersonStatistics } from '@immich/sdk';
import { QueryParameter } from '$lib/constants';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);

  const action = url.searchParams.get(QueryParameter.ACTION);
  // Same-origin gate at the read site, required by the no-restricted-syntax rule
  // web/eslint.config.js gains in immich-30950; it replaces this route's hand-rolled origin
  // check. Absence is decided with has() rather than a second get(), because Route.continue
  // resolves an empty value against the base URL instead of reporting it as missing. The result
  // is normalised back to a path: every person link below re-emits it as a query param, and an
  // absolute URL would be round-tripped verbatim.
  const requestedPrevious = url.searchParams.has(QueryParameter.PREVIOUS_ROUTE)
    ? Route.continue(url.searchParams.get(QueryParameter.PREVIOUS_ROUTE), '')
    : '';
  const previousUrl =
    requestedPrevious === '' ? null : new URL(requestedPrevious.toString(), url);
  const previousRoute = previousUrl
    ? previousUrl.pathname + previousUrl.search
    : null;

  const [space, members, person, statistics] = await Promise.all([
    getSpace({ id: params.spaceId }),
    getMembers({ id: params.spaceId }),
    getSpacePerson({ id: params.spaceId, personId: params.personId }),
    getSpacePersonStatistics({ id: params.spaceId, personId: params.personId }),
  ]);

  return {
    space,
    members,
    person,
    statistics,
    action,
    previousRoute,
    meta: {
      title: `${person.name || space.name} - ${space.name}`,
    },
  };
}) satisfies PageLoad;

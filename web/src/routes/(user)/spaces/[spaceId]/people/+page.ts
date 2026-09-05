import { getSpacePeople, getSpacePeopleStatistics } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import { getPersistedPeopleTypeParam } from '$lib/utils/people-filter';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  // The People tab is hidden when face recognition is off; a direct/bookmarked nav redirects to Photos.
  if (!space.faceRecognitionEnabled) {
    redirect(307, `/spaces/${params.spaceId}`);
  }

  // Apply the persisted People/Pets choice to the FIRST request. The tab used to load unfiltered and
  // re-fetch in onMount, so refreshing under a Pets filter painted the full people list for one
  // round trip before narrowing to pets.
  const type = getPersistedPeopleTypeParam();

  const [people, peopleStatistics] = await Promise.all([
    getSpacePeople({ id: params.spaceId, limit: 100, ...(type && { $type: type }) }),
    getSpacePeopleStatistics({ id: params.spaceId, ...(type && { $type: type }) }).catch(() => null),
  ]);

  // Whether the space has ANY people, ignoring the active type filter. The show/hide screen is the
  // one place a misdetected species bucket can be corrected, so a Pets filter matching nothing must
  // not hide it (see `hasSpacePeople` in +page.svelte). Anything the filtered queries already found
  // answers this, so the extra unfiltered request is spent only when the filter matched nothing —
  // never on an unfiltered load, and never on a filtered one that returned rows.
  let hasSpacePeople = people.length > 0 || (peopleStatistics?.total ?? 0) > 0;
  if (!hasSpacePeople && type) {
    const unfiltered = await getSpacePeopleStatistics({ id: params.spaceId }).catch(() => null);
    hasSpacePeople = (unfiltered?.total ?? 0) > 0;
  }

  return { people, peopleStatistics, hasSpacePeople };
}) satisfies PageLoad;

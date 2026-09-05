import { getAllPeople, getPeopleStatistics } from '@immich/sdk';
import { PEOPLE_PAGE_SIZE } from '$lib/constants';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import { getPersistedPeopleFilterBy, peopleFilterToTypeParam } from '$lib/utils/people-filter';
import type { PageLoad } from './$types';

export const load = (async ({ parent, url }) => {
  await authenticate(url);

  // Apply the persisted People/Pets choice to the FIRST request. The page used to load unfiltered
  // and re-fetch in onMount, so refreshing under a Pets filter painted the full people list for one
  // round trip before narrowing to pets.
  const filterBy = getPersistedPeopleFilterBy();
  const type = peopleFilterToTypeParam(filterBy);

  // Fire the (heavy) people query up front so it overlaps the root layout's init() instead of
  // serializing behind await parent(). ssr=false, so the SDK's global fetch works even before
  // init() assigns defaults.fetch. It is awaited below via Promise.all.
  const peoplePromise = getAllPeople({
    withHidden: true,
    withSharedSpaces: true,
    size: PEOPLE_PAGE_SIZE,
    $type: type,
  });

  // parent() resolves once the root layout's init() has populated the feature-flags manager.
  await parent();

  // The peopleStatistics flag only gates *display* in +page.svelte, but the overview stats query is
  // expensive. Skip it entirely when the flag is off (the default) instead of running it and
  // discarding the result. valueOrUndefined fails safe to "off" when flags are unavailable (e.g.
  // maintenance mode, where the layout skips featureFlagsManager.init()).
  const statisticsEnabled = featureFlagsManager.valueOrUndefined?.peopleStatistics ?? false;

  const [people, peopleStatistics] = await Promise.all([
    peoplePromise,
    statisticsEnabled ? getPeopleStatistics({ withSharedSpaces: true }).catch(() => null) : Promise.resolve(null),
  ]);
  const $t = await getFormatter();

  return {
    people,
    peopleStatistics,
    // Header totals for an active filter. The overview-statistics endpoint is unfiltered, so under a
    // filter the header has to read the filtered list's own totals; handing them over here saves the
    // page a round trip to discover what it already fetched. Null under `All`, where the unfiltered
    // overview statistics are the right source.
    peopleListTotals: type ? { total: people.total, hidden: people.hidden } : null,
    meta: {
      title: $t('people'),
    },
  };
}) satisfies PageLoad;

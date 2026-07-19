import { getSpaceActivities } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

const ACTIVITY_PAGE_SIZE = 20;

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  const activities = await getSpaceActivities({ id: params.spaceId, limit: ACTIVITY_PAGE_SIZE, offset: 0 });
  return {
    activities,
    hasMoreActivities: activities.length === ACTIVITY_PAGE_SIZE,
    meta: { title: `${space.name} - Activity` },
  };
}) satisfies PageLoad;

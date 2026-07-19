import { getSpacePeople, getSpacePeopleStatistics } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  // The People tab is hidden when face recognition is off; a direct/bookmarked nav redirects to Photos.
  if (!space.faceRecognitionEnabled) {
    redirect(307, `/spaces/${params.spaceId}`);
  }
  const [people, peopleStatistics] = await Promise.all([
    getSpacePeople({ id: params.spaceId, limit: 100 }),
    getSpacePeopleStatistics({ id: params.spaceId }).catch(() => null),
  ]);
  return { people, peopleStatistics };
}) satisfies PageLoad;

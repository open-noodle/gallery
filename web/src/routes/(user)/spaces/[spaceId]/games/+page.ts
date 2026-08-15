import { getChallenges } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  await parent();
  const challenges = await getChallenges({ spaceId: params.spaceId });
  return { challenges };
}) satisfies PageLoad;

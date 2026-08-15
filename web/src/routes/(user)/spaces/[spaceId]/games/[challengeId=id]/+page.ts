import { getChallenge } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  await parent();
  const challenge = await getChallenge({ id: params.challengeId });
  return { challenge };
}) satisfies PageLoad;

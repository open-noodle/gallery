import { getChallenges } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  const challenges = await getChallenges({ spaceId: params.spaceId });
  // "Challenges", matching the space-tabs.svelte label for this tab ($t('game_challenges')) - same
  // convention as the sibling Activity/Members pages (space name + the tab's own English label).
  return { challenges, meta: { title: `${space.name} - Challenges` } };
}) satisfies PageLoad;

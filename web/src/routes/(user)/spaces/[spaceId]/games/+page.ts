import { getChallenges, getDailyChallenge } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  // In parallel: the daily's first read is what GENERATES it, which runs the candidate queries and
  // the CLIP prompts, so serialising it behind the list would add that latency to every page load.
  const [challenges, daily] = await Promise.all([
    getChallenges({ spaceId: params.spaceId }),
    getDailyChallenge({ spaceId: params.spaceId }),
  ]);
  // "Challenges", matching the space-tabs.svelte label for this tab ($t('game_challenges')) - same
  // convention as the sibling Activity/Members pages (space name + the tab's own English label).
  return { challenges, daily: daily.challenge, meta: { title: `${space.name} - Challenges` } };
}) satisfies PageLoad;

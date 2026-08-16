import { getChallenges, getDailyChallenge, getLeaderboard, getStandings } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  // In parallel: the daily's first read is what GENERATES it, which runs the candidate queries and
  // the CLIP prompts, so serialising it behind the list would add that latency to every page load.
  // The standings join that group - they depend on nothing else on this page.
  const [challenges, daily, standings] = await Promise.all([
    getChallenges({ spaceId: params.spaceId }),
    getDailyChallenge({ spaceId: params.spaceId }),
    getStandings({ spaceId: params.spaceId }),
  ]);

  // The one genuinely serial hop: today's board is keyed by the daily's id, which only exists once
  // the call above has returned (or generated) it. A space with no usable photos has no daily and
  // therefore no board - not an empty one.
  const todayBoard = daily.challenge ? await getLeaderboard({ id: daily.challenge.id }) : null;

  // "Challenges", matching the space-tabs.svelte label for this tab ($t('game_challenges')) - same
  // convention as the sibling Activity/Members pages (space name + the tab's own English label).
  return {
    challenges,
    daily: daily.challenge,
    standings,
    todayBoard,
    meta: { title: `${space.name} - Challenges` },
  };
}) satisfies PageLoad;

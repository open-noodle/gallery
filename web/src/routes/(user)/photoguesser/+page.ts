import { getSoloDailyChallenge, getSoloHistory, getSoloStats } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { SOLO_HISTORY_PAGE_SIZE } from '$lib/utils/game';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  // In parallel: reading the daily is what GENERATES it, which runs the candidate queries and the
  // CLIP prompts, so serialising the other two behind it would add that latency to every load.
  // Nothing space-scoped is fetched at all - a user in no shared space must still get this page.
  const [daily, stats, history] = await Promise.all([
    getSoloDailyChallenge(),
    getSoloStats(),
    getSoloHistory({ page: 1, size: SOLO_HISTORY_PAGE_SIZE }),
  ]);

  return { daily: daily.challenge, stats, history, meta: { title: $t('photoguesser') } };
}) satisfies PageLoad;

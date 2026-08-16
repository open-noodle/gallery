import { getChallenge } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  await parent();
  try {
    const challenge = await getChallenge({ id: params.challengeId });
    return { challenge };
  } catch (error) {
    // Challenge deleted (or access revoked) while this page was open elsewhere - back to the
    // space's challenge list rather than the generic error page. Same precedent as the [spaceId]
    // layout's own space-gone handling (+layout.ts).
    const status = (error as { status?: number })?.status;
    if (status === 403 || status === 404) {
      redirect(302, `/spaces/${params.spaceId}/games`);
    }
    throw error;
  }
}) satisfies PageLoad;

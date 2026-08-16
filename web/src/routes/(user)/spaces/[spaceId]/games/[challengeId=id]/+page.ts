import { getChallenge } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  await parent();
  try {
    const challenge = await getChallenge({ id: params.challengeId });
    // The challenge name alone, mirroring the sibling album detail page (meta: { title:
    // album.albumName }) - the play page's own header shows this same bare name (+page.svelte).
    return { challenge, meta: { title: challenge.name } };
  } catch (error) {
    // Challenge deleted (or access revoked) while this page was open elsewhere - back to the
    // space's challenge list rather than the generic error page. Same precedent as the [spaceId]
    // layout's own space-gone handling (+layout.ts).
    const status = (error as { status?: number })?.status;
    if (status === 403 || status === 404) {
      redirect(302, Route.viewSpaceGames({ id: params.spaceId }));
    }
    throw error;
  }
}) satisfies PageLoad;

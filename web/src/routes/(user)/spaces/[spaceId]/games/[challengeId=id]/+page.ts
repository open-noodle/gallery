import { getChallenge, type GameChallengeDetailResponseDto } from '@immich/sdk';
import { error, redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  await parent();

  let challenge: GameChallengeDetailResponseDto;
  try {
    challenge = await getChallenge({ id: params.challengeId });
  } catch (loadError) {
    // Challenge deleted (or access revoked) while this page was open elsewhere - back to the
    // space's challenge list rather than the generic error page. Same precedent as the [spaceId]
    // layout's own space-gone handling (+layout.ts).
    const status = (loadError as { status?: number })?.status;
    if (status === 403 || status === 404) {
      redirect(302, Route.viewSpaceGames({ id: params.spaceId }));
    }
    throw loadError;
  }

  // A solo challenge, or another space's, is readable by this caller but not renderable by this
  // route: there is no space to draw a leaderboard or a member list from. 404 rather than redirect
  // to wherever it does belong, so a wrong link stays visible instead of being papered over into a
  // page that quietly is not the one asked for (design §11). Deliberately outside the try above,
  // which would otherwise catch this 404 and turn it into the redirect.
  if (challenge.spaceId !== params.spaceId) {
    // Localized, because this string is what the error page shows the player.
    error(404, (await getFormatter())('game_challenge_load_failed'));
  }

  // The challenge name alone, mirroring the sibling album detail page (meta: { title:
  // album.albumName }) - the play page's own header shows this same bare name (+page.svelte).
  return { challenge, meta: { title: challenge.name } };
}) satisfies PageLoad;

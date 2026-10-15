import { getChallenge, type GameChallengeDetailResponseDto } from '@immich/sdk';
import { error, redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);

  let challenge: GameChallengeDetailResponseDto;
  try {
    challenge = await getChallenge({ id: params.challengeId });
  } catch (loadError) {
    // Unplayed challenges are pruned after seven days, so a bookmarked free-play link genuinely
    // stops existing. Back to the landing page rather than the generic error page, mirroring the
    // sibling space route's handling of a deleted challenge.
    const status = (loadError as { status?: number })?.status;
    if (status === 403 || status === 404) {
      redirect(302, Route.photoGuesser());
    }
    throw loadError;
  }

  // A space challenge is readable by a member but not renderable here: this route has no space
  // chrome, no member list and no leaderboard. 404 rather than redirect to where it does belong,
  // so a wrong link stays visible instead of being papered over into a page that quietly is not
  // the one asked for (design §11). Deliberately outside the try above, which would otherwise
  // catch this 404 and turn it into the redirect.
  if (challenge.spaceId !== null) {
    // Localized, because this string is what the error page shows the player.
    error(404, (await getFormatter())('game_challenge_load_failed'));
  }

  // The challenge's own name - except for a daily, whose stored `name` is the raw UTC date the
  // server keeps only to hold the column non-null. meta.title is the BROWSER TAB, so leaving it
  // raw would put "2026-08-19" there in every language while the visible header (+page.svelte)
  // shows the localized label. The two must agree.
  return {
    challenge,
    meta: { title: challenge.dailyOn ? (await getFormatter())('game_daily_challenge') : challenge.name },
  };
}) satisfies PageLoad;

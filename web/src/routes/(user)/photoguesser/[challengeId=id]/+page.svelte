<script lang="ts">
  import { goto } from '$app/navigation';
  import GamePlay from '$lib/components/games/game-play.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import {
    createSoloChallenge,
    GameChallengeType,
    GameRoundType,
    isHttpError,
    type GameChallengeDetailResponseDto,
  } from '@immich/sdk';
  import { Button, IconButton, toastManager } from '@immich/ui';
  import { mdiArrowLeft } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const challenge = $derived<GameChallengeDetailResponseDto>(data.challenge);

  let startingAgain = $state(false);

  // Labelled from the rounds the challenge actually contains, not from whatever type was requested
  // - a mixed request that could only find location photos produced a places game, so "another one
  // like that" is a places game. Same rule daily-challenge-card.svelte labels its hero by.
  const typeOf = (finished: GameChallengeDetailResponseDto): GameChallengeType => {
    const locationRounds = finished.rounds.filter((round) => round.type === GameRoundType.Location).length;
    if (locationRounds === finished.rounds.length) {
      return GameChallengeType.Location;
    }
    return locationRounds === 0 ? GameChallengeType.Date : GameChallengeType.Mixed;
  };

  const totalScore = (finished: GameChallengeDetailResponseDto) =>
    finished.rounds.reduce((total, round) => total + (round.score ?? 0), 0);

  async function playAgain(finished: GameChallengeDetailResponseDto) {
    // Guards a double-tap: generation takes seconds (candidate queries plus CLIP prompts), which
    // is comfortably long enough for a second click to create a second game from one intent.
    if (startingAgain) {
      return;
    }
    startingAgain = true;
    try {
      // No `sources`: the finished challenge froze its own toggles onto its row and does not
      // report them back, so the stored preference - the player's standing choice - is what a
      // one-click rematch should draw from. Widening it is a decision that belongs on the create
      // panel, where the toggles are.
      const next = await createSoloChallenge({
        gameSoloCreateDto: { roundCount: finished.roundCount, type: typeOf(finished) },
      });
      await goto(Route.viewPhotoGuesserGame({ challengeId: next.id }));
    } catch (error) {
      // handleError prefers the server's raw message for any HttpError, truncated to 75 chars, and
      // this 400's body is longer than that - so the localized string wins for that known status.
      // Only for that status: handleError's fallback is what renders when the server sent no
      // message at all - a dropped connection - and the no-photos copy would blame the library for
      // a network failure.
      if (isHttpError(error) && error.status === 400) {
        toastManager.danger($t('game_solo_no_photos'));
      } else {
        handleError(error, $t('errors.something_went_wrong'));
      }
    } finally {
      startingAgain = false;
    }
  }
</script>

<!-- A daily has no user-facing name: the server stores its UTC date in `name` only to keep the
     column non-null, so titling the page with it would show a raw "2026-08-19" in every language. -->
<UserPageLayout title={challenge.dailyOn ? $t('game_daily_challenge') : challenge.name}>
  {#snippet leading()}
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      aria-label={$t('back')}
      onclick={() => void goto(Route.photoGuesser())}
      icon={mdiArrowLeft}
    />
  {/snippet}

  <!-- Same play loop as the space route; only the ending differs. Solo has nobody to rank against,
       so its ending is the player's own total and a way straight into the next game.

       Keyed on the challenge id because "play again" navigates from one challenge to another under
       THIS SAME route, which SvelteKit serves by reusing this component and swapping `data` rather
       than remounting. game-play.svelte seeds its state from the challenge it is first handed, so
       without the key the player would be dropped back onto the game they just finished. The space
       route needs no such key: nothing there navigates between two challenges without passing
       through the list route in between. -->
  {#key challenge.id}
    <GamePlay {challenge}>
      {#snippet ending(finished)}
        <p class="text-4xl font-bold dark:text-white" data-testid="solo-score-total">
          {$t('game_points', { values: { score: new Intl.NumberFormat().format(totalScore(finished)) } })}
        </p>
        <div>
          <Button loading={startingAgain} onclick={() => void playAgain(finished)} data-testid="solo-play-again">
            {$t('game_solo_play_again')}
          </Button>
        </div>
      {/snippet}
    </GamePlay>
  {/key}
</UserPageLayout>

<script lang="ts">
  import { goto } from '$app/navigation';
  import DateRound from '$lib/components/games/date-round.svelte';
  import GameLeaderboard, { toAvatarUser } from '$lib/components/games/game-leaderboard.svelte';
  import LocationRound from '$lib/components/games/location-round.svelte';
  import RoundResult from '$lib/components/games/round-result.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { yearFromIso } from '$lib/utils/game';
  import {
    GameRoundType,
    getChallenge,
    getLeaderboard,
    guessRound,
    isHttpError,
    type GameChallengeDetailResponseDto,
    type GameGuessDto,
    type GameLeaderboardResponseDto,
    type SharedSpaceMemberResponseDto,
  } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiArrowLeft } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  // GameRoundDetailResponseDto.answer is withheld until a round is guessed (spec §6), so no round in
  // the payload ever carries a pool date the client hasn't already revealed to the player - there is
  // no year range anywhere to derive a slider lower bound from. Fixed instead of derived.
  const GAME_MIN_YEAR = 1970;

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let challenge = $state<GameChallengeDetailResponseDto>(data.challenge);
  let leaderboard = $state<GameLeaderboardResponseDto>();
  // Guards against a double-tap on mobile firing two guesses for the same round - the second would
  // 409 and overwrite a complete reveal with a degraded one (no distance/offset/guess pin).
  let submitting = $state(false);

  type ResultView = {
    type: 'location' | 'date';
    score: number;
    distanceKm?: number;
    offsetDays?: number;
    answer?: { date: string | null; lat: number | null; lon: number | null };
    guess?: { lat: number; lon: number };
  };
  let result = $state<ResultView>();

  // The response already tells us which rounds this caller has answered - a round carries
  // `answer`/`score` only once guessed - so the starting round is derived from the payload itself
  // rather than tracked client-side across reloads.
  function firstUnansweredIndex(c: GameChallengeDetailResponseDto): number {
    const index = c.rounds.findIndex((round) => round.score === undefined);
    return index === -1 ? c.rounds.length : index;
  }

  // Set once from the initial payload. Re-fetching `challenge` after a guess must NOT recompute
  // this: the just-answered round becomes scored on that same re-fetch, and recomputing would skip
  // straight past its own result screen instead of showing it.
  let currentIndex = $state(firstUnansweredIndex(data.challenge));

  // By the round's own `.index`, not array position. Correct either way only because the server
  // orders rounds by `index asc` over a contiguous 0..N-1 set - looking it up keeps that invariant
  // local instead of leaning on it silently at every call site.
  function findRound(index: number) {
    return challenge.rounds.find((round) => round.index === index);
  }

  const currentRound = $derived(findRound(currentIndex));
  const maxYear = $derived(yearFromIso(challenge.createdAt));

  const memberById = $derived(
    new Map((data.members as SharedSpaceMemberResponseDto[]).map((member) => [member.userId, member])),
  );

  const leaderboardRows = $derived(
    (leaderboard?.entries ?? []).flatMap((entry) => {
      const member = memberById.get(entry.userId);
      // The server only returns current members, so a miss here means the member list is stale -
      // skip rather than render a nameless avatar.
      if (!member) {
        return [];
      }
      return [
        {
          user: toAvatarUser(member),
          total: entry.total,
          detail:
            entry.answered === 0
              ? $t('game_not_played')
              : $t('game_rounds_answered', { values: { answered: entry.answered, total: challenge.rounds.length } }),
          value: entry.answered === 0 ? '—' : $t('game_points', { values: { score: entry.total } }),
          isMe: entry.userId === authManager.user.id,
        },
      ];
    }),
  );

  async function loadLeaderboard() {
    try {
      leaderboard = await getLeaderboard({ id: challenge.id });
    } catch (error) {
      handleError(error, $t('errors.something_went_wrong'));
    }
  }

  // Covers a challenge that was already fully answered when this page loaded (e.g. reopening a
  // finished game).
  if (currentIndex >= challenge.rounds.length) {
    void loadLeaderboard();
  }

  // The only source for the revealed answer: GameGuessResponseDto carries score/distanceKm/
  // offsetDays but no answer (spec §9/API verified). Re-fetching the challenge is also the recovery
  // path for a duplicate (409) guess, so both callers below share this one function.
  async function showResult(extra?: {
    score: number;
    distanceKm?: number;
    offsetDays?: number;
    guess?: { lat: number; lon: number };
  }) {
    challenge = await getChallenge({ id: challenge.id });
    const round = findRound(currentIndex);
    if (!round) {
      // Cannot happen under the server's index-ordering guarantee (see findRound) - guard rather
      // than build a result view with no round to read `type`/`answer` from.
      throw new Error(`Round ${currentIndex} missing from the refreshed challenge`);
    }
    result = {
      type: round.type === GameRoundType.Location ? 'location' : 'date',
      score: extra?.score ?? round.score ?? 0,
      distanceKm: extra?.distanceKm,
      offsetDays: extra?.offsetDays,
      answer: round.answer,
      guess: extra?.guess,
    };
  }

  async function submitGuess(gameGuessDto: GameGuessDto, guessPoint?: { lat: number; lon: number }) {
    if (submitting) {
      return;
    }
    submitting = true;
    try {
      const response = await guessRound({ id: challenge.id, index: currentIndex, gameGuessDto });
      await showResult({
        score: response.score,
        distanceKm: response.distanceKm ?? undefined,
        offsetDays: response.offsetDays ?? undefined,
        guess: guessPoint,
      });
    } catch (error) {
      if (isHttpError(error) && error.status === 409) {
        // Already answered - a page left open and replayed. Reuse the exact same re-fetch as a
        // successful guess rather than surfacing a raw error the player can't act on. That re-fetch
        // is itself a network call and can fail on its own: a throw inside a catch block is NOT
        // caught by the enclosing try, and every caller below invokes this fire-and-forget
        // (`void submitGuess(...)`), so without this nested try/catch a failed recovery here would
        // surface as an unhandled rejection - no toast, a frozen screen - instead of a toast.
        try {
          await showResult();
        } catch (refetchError) {
          handleError(refetchError, $t('errors.something_went_wrong'));
        }
      } else {
        handleError(error, $t('errors.something_went_wrong'));
      }
    } finally {
      submitting = false;
    }
  }

  function handleLocationGuess(point: { lat: number; lon: number }) {
    void submitGuess({ lat: point.lat, lon: point.lon }, point);
  }

  function handleDateGuess(isoDate: string) {
    void submitGuess({ date: isoDate });
  }

  function handleNext() {
    result = undefined;
    currentIndex += 1;
    if (currentIndex >= challenge.rounds.length) {
      void loadLeaderboard();
    }
  }
</script>

<!-- The challenge's own name is the title (mirrors the space-album detail page's back-nav +
     title pattern); unlike that page, there is no editable title inline in the round/result
     surfaces below, so the header is the only place it's shown. -->
<!-- A daily has no user-facing name: the server stores its UTC date in `name` only to keep the
     column non-null, so titling the page with it would show a raw "2026-08-16" in every language. -->
<UserPageLayout title={challenge.dailyOn ? $t('game_daily_challenge') : challenge.name}>
  {#snippet leading()}
    <!-- spaceId is null for a solo challenge, and viewSpaceGames only exists for a space one -
         this route is space-only for now, so the guard is currently always true, but the type is
         nullable and a future solo route must not inherit a broken back button by omission. -->
    {#if challenge.spaceId}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('back')}
        onclick={() => void goto(Route.viewSpaceGames({ id: challenge.spaceId! }))}
        icon={mdiArrowLeft}
      />
    {/if}
  {/snippet}

  <div class="flex h-full flex-col">
    {#if currentRound}
      <p class="px-4 py-2 text-sm text-gray-500 dark:text-gray-400" data-testid="game-progress">
        {$t('game_round_progress', { values: { current: currentIndex + 1, total: challenge.rounds.length } })}
      </p>
    {/if}

    <div class="min-h-0 flex-1">
      {#if result && currentRound}
        <RoundResult
          challengeId={challenge.id}
          index={currentIndex}
          type={result.type}
          score={result.score}
          distanceKm={result.distanceKm}
          offsetDays={result.offsetDays}
          answer={result.answer}
          guess={result.guess}
          onNext={handleNext}
        />
      {:else if currentRound}
        {#if currentRound.type === GameRoundType.Location}
          <LocationRound challengeId={challenge.id} index={currentIndex} onGuess={handleLocationGuess} />
        {:else}
          <DateRound
            challengeId={challenge.id}
            index={currentIndex}
            minYear={GAME_MIN_YEAR}
            {maxYear}
            onGuess={handleDateGuess}
          />
        {/if}
      {:else}
        <div class="flex h-full flex-col gap-4 overflow-y-auto p-4" data-testid="game-completed">
          <h1 class="text-xl font-semibold dark:text-white">{$t('game_completed')}</h1>
          {#if leaderboard}
            <GameLeaderboard rows={leaderboardRows} />
          {/if}
        </div>
      {/if}
    </div>
  </div>
</UserPageLayout>

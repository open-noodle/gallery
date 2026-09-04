<script lang="ts">
  import DateRound from '$lib/components/games/date-round.svelte';
  import LocationRound from '$lib/components/games/location-round.svelte';
  import RoundResult from '$lib/components/games/round-result.svelte';
  import { yearFromIso } from '$lib/utils/game';
  import { handleError } from '$lib/utils/handle-error';
  import {
    GameRoundType,
    getChallenge,
    guessRound,
    isHttpError,
    type GameChallengeDetailResponseDto,
    type GameGuessDto,
  } from '@immich/sdk';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  // GameRoundDetailResponseDto.answer is withheld until a round is guessed (spec §6), so no round in
  // the payload ever carries a pool date the client hasn't already revealed to the player - there is
  // no year range anywhere to derive a slider lower bound from. Fixed instead of derived.
  const GAME_MIN_YEAR = 1970;

  interface Props {
    challenge: GameChallengeDetailResponseDto;
    // Fires once the round loop runs out - both on mount, for a challenge that was already fully
    // answered, and after the last round's "next" - so the caller can start whatever its own ending
    // needs (the space route's leaderboard fetch). Solo (Task 13) can derive its score summary from
    // the `challenge` handed to `ending` below, so this callback carries no payload of its own.
    onComplete?: () => void;
    // The end-of-game panel, rendered under the shared "Completed" heading: a leaderboard for a
    // space challenge, a score summary for solo (Task 13) - one play loop, two endings, chosen by
    // the caller. Handed the latest `challenge` (every round scored) so an ending that only needs
    // round scores never has to re-fetch the challenge itself.
    ending: Snippet<[challenge: GameChallengeDetailResponseDto]>;
  }

  let { challenge: initialChallenge, onComplete, ending }: Props = $props();

  let challenge = $state<GameChallengeDetailResponseDto>(initialChallenge);
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
  let currentIndex = $state(firstUnansweredIndex(initialChallenge));

  // By the round's own `.index`, not array position. Correct either way only because the server
  // orders rounds by `index asc` over a contiguous 0..N-1 set - looking it up keeps that invariant
  // local instead of leaning on it silently at every call site.
  function findRound(index: number) {
    return challenge.rounds.find((round) => round.index === index);
  }

  const currentRound = $derived(findRound(currentIndex));
  const maxYear = $derived(yearFromIso(challenge.createdAt));

  // Covers a challenge that was already fully answered when this component mounted (e.g. reopening
  // a finished game).
  if (currentIndex >= challenge.rounds.length) {
    onComplete?.();
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
      onComplete?.();
    }
  }
</script>

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
        {@render ending(challenge)}
      </div>
    {/if}
  </div>
</div>

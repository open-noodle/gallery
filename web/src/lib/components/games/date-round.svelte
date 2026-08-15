<script lang="ts">
  import RoundPhoto from '$lib/components/games/round-photo.svelte';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    challengeId: string;
    index: number;
    minYear: number;
    maxYear: number;
    onGuess: (isoDate: string) => void;
  };

  let { challengeId, index, minYear, maxYear, onGuess }: Props = $props();

  let year = $state(Math.round((minYear + maxYear) / 2));

  function handleGuess() {
    // Midnight UTC for the chosen year - the server scores date rounds by UTC day
    // index, so a local-midnight Date silently lands on the previous or next day
    // depending on the player's timezone.
    onGuess(new Date(Date.UTC(year, 0, 1)).toISOString());
  }
</script>

<div data-testid="date-round" class="relative size-full overflow-hidden">
  <RoundPhoto {challengeId} {index} alt={$t('game_when_was_this')} />

  <!-- Timeline inset over the photo, per the approved mockup. -->
  <div class="absolute inset-x-3 bottom-3 flex flex-col gap-2 sm:inset-x-auto sm:inset-e-3 sm:w-72 md:w-80">
    <div class="rounded-2xl bg-black/70 px-3 py-2 text-white shadow-lg">
      <label for="date-round-year" class="block text-center text-xs sm:text-sm">{$t('game_when_was_this')}</label>
      <p class="text-center text-lg font-semibold">{year}</p>

      <input
        id="date-round-year"
        type="range"
        min={minYear}
        max={maxYear}
        step="1"
        bind:value={year}
        data-testid="date-round-slider"
        class="w-full"
      />

      <div class="flex justify-between text-xs">
        <span>{minYear}</span>
        <span>{maxYear}</span>
      </div>
    </div>

    <Button variant="filled" fullWidth onclick={handleGuess} data-testid="date-round-guess">
      {$t('game_guess_year', { values: { year } })}
    </Button>
  </div>
</div>

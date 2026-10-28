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
  // '1'-'12', held as a string so the rendered <option>s carry a real value attribute. Svelte keeps
  // a non-string option value in an internal __value and leaves the DOM value empty, which makes
  // the month unselectable by value from outside the component (its DOM value falls back to the
  // localised label, so anything selecting by number silently lands on January).
  //
  // July is just a mid-range default to open on; the server grades a date round at month
  // granularity (monthOffsetDays), so an untouched month is a real guess like any other rather
  // than the error-halving compromise a year-only slider needed.
  let month = $state('7');

  // Localised month names for free - the browser already knows all twelve in the user's locale, so
  // this needs no i18n keys of its own. 'long' rather than 'short' because the select is the only
  // place the month is named.
  const monthNames = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' });
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: monthNames.format(new Date(Date.UTC(2020, i, 1))),
  }));
  const selectedMonth = $derived(Number(month));

  function handleGuess() {
    // The 1st of the chosen month. The server grades by month, so the day only has to identify
    // which month this is.
    //
    // Midnight UTC (not local midnight) - a local-midnight Date silently lands on the previous or
    // next day depending on the player's timezone, which at a month boundary means the previous or
    // next MONTH, i.e. a wrong answer for a player who picked correctly.
    onGuess(new Date(Date.UTC(year, selectedMonth - 1, 1)).toISOString());
  }
</script>

<div data-testid="date-round" class="relative size-full overflow-hidden">
  <RoundPhoto {challengeId} {index} alt={$t('game_when_was_this')} />

  <!-- Timeline inset over the photo, per the approved mockup. -->
  <div class="absolute inset-x-3 bottom-3 flex flex-col gap-2 sm:inset-x-auto sm:inset-e-3 sm:w-72 md:w-80">
    <div class="rounded-2xl bg-black/70 px-3 py-2 text-white shadow-lg">
      <label for="date-round-year" class="block text-center text-xs sm:text-sm">{$t('game_when_was_this')}</label>
      <p class="text-center text-lg font-semibold">{months[selectedMonth - 1].label} {year}</p>

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

      <label for="date-round-month" class="sr-only">{$t('month')}</label>
      <select
        id="date-round-month"
        value={month}
        onchange={(event) => (month = event.currentTarget.value)}
        data-testid="date-round-month"
        class="mt-2 w-full rounded-lg bg-white/10 px-2 py-1 text-center text-sm text-white"
      >
        {#each months as option (option.value)}
          <option value={option.value} class="text-black">{option.label}</option>
        {/each}
      </select>
    </div>

    <Button variant="filled" fullWidth onclick={handleGuess} data-testid="date-round-guess">
      {$t('game_guess_month_year', { values: { month: months[selectedMonth - 1].label, year } })}
    </Button>
  </div>
</div>

<script lang="ts">
  import RoundPhoto from '$lib/components/games/round-photo.svelte';
  import Map from '$lib/components/shared-components/map/Map.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { parseUtcDate } from '$lib/utils/date-time';
  import { formatDistanceKm, scorePercent } from '$lib/utils/game';
  import type { MapMarkerResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    challengeId: string;
    index: number;
    type: 'location' | 'date';
    score: number;
    distanceKm?: number; // location rounds
    offsetDays?: number; // date rounds
    // The raw revealed answer. The API has no place name (only date/lat/lon —
    // GameRoundDetailResponseDto.answer, fetch-client.ts:1502-1511), so a location round shows the
    // pin on the map instead of inventing a city/country label.
    answer?: { date: string | null; lat: number | null; lon: number | null };
    guess?: { lat: number; lon: number }; // location rounds
    onNext: () => void;
  };

  let { challengeId, index, type, score, distanceKm, offsetDays, answer, guess, onNext }: Props = $props();

  let percent = $derived(scorePercent(score));

  // "game_you_were_off" takes a single pre-formatted {offset} placeholder (mirrors
  // "game_you_were_away" taking a pre-formatted {distance} via formatDistanceKm), so the day unit
  // is localised here via the existing generic day/days pluraliser rather than a new key.
  let offsetLabel = $derived(
    offsetDays == null ? undefined : `${offsetDays} ${$t('cutoff_day', { values: { count: offsetDays } })}`,
  );

  let formattedAnswerDate = $derived(
    answer?.date
      ? parseUtcDate(answer.date).toLocaleString(
          { month: 'short', day: 'numeric', year: 'numeric' },
          { locale: $locale },
        )
      : undefined,
  );

  // mapMarkers must stay explicit — leaving it undefined makes Map.svelte fetch and render the
  // space's own photo markers (see location-round.svelte's identical comment / Map.svelte:281-284).
  let mapMarkers = $derived(
    type === 'location' && guess && answer?.lat != null && answer?.lon != null
      ? ([
          { id: 'guess', lat: guess.lat, lon: guess.lon, city: null, state: null, country: null },
          { id: 'answer', lat: answer.lat, lon: answer.lon, city: null, state: null, country: null },
        ] satisfies MapMarkerResponseDto[])
      : [],
  );
</script>

<div data-testid="round-result" class="relative flex size-full flex-col overflow-hidden">
  <RoundPhoto {challengeId} {index} alt={$t('game_actual')} dimmed />

  <!-- Reveal content spans the whole surface (score, distance/offset, map, button) rather than a
       bottom caption, so a bottom-only gradient (space-hero.svelte's pattern) would leave marginal
       contrast well above the fold on a bright photo. A full-surface scrim guarantees legibility
       everywhere, layered on top of round-photo's own `dimmed` baseline (task-7 contrast call). -->
  <div class="absolute inset-0 bg-linear-to-t from-black/85 via-black/70 to-black/60"></div>

  <div
    class="relative flex size-full flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center text-white"
  >
    <p class="text-4xl font-bold" data-testid="round-result-score">
      {$t('game_points', { values: { score } })}
    </p>

    <div class="h-2 w-48 max-w-full overflow-hidden rounded-full bg-white/20">
      <div
        data-testid="round-result-bar"
        class="h-full rounded-full bg-white transition-all duration-500 ease-out"
        style="width: {percent}%"
      ></div>
    </div>

    {#if type === 'location' && distanceKm != null}
      <p data-testid="round-result-distance">
        {$t('game_you_were_away', { values: { distance: formatDistanceKm(distanceKm) } })}
      </p>
    {:else if type === 'date' && offsetLabel}
      <p data-testid="round-result-offset">
        {$t('game_you_were_off', { values: { offset: offsetLabel } })}
      </p>
    {/if}

    <div class="w-full max-w-xs">
      <p class="text-xs font-medium tracking-wide text-white/70 uppercase">{$t('game_actual')}</p>

      {#if type === 'location'}
        <div class="mt-2 h-40 overflow-hidden rounded-2xl shadow-lg sm:h-48">
          <Map {mapMarkers} autoFitBounds simplified rounded showSimpleControls={false} />
        </div>
      {/if}

      {#if formattedAnswerDate}
        <p class="mt-2" data-testid="round-result-answer-date">{formattedAnswerDate}</p>
      {/if}
    </div>

    <div class="w-full max-w-xs">
      <Button variant="filled" fullWidth onclick={onNext} data-testid="round-result-next">
        {$t('game_next_round')}
      </Button>
    </div>
  </div>
</div>

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
  // player's ENTIRE geotagged library (getMapMarkers, global — not space-scoped; see
  // location-round.svelte's identical comment for the full self-fetch-gating explanation). Not an
  // answer leak here (the reveal has already happened), but a settings-cog click or a background
  // asset change would otherwise destroy the guess/answer pins mid-reveal.
  // 'guess'/'answer' are not real asset IDs (MapMarkerResponseDto.id is normally an asset ID), so
  // `useLocationPin` MUST be passed below — otherwise Map.svelte's default marker layer renders an
  // <img> keyed off this id (Map.svelte:432-433) and both pins 404. The id doubles as the popup
  // snippet's discriminator, since the pin icon itself is identical for every marker (see below).
  //
  // `guess` is optional: the 409-recovery path (a duplicate guess, caught and re-shown from the
  // challenge re-fetch) has an answer but no guess of its own to plot, since that request never
  // reached the server. Render the answer alone rather than an empty map in that case — the reveal
  // is still informative without a guess pin to compare it against.
  let mapMarkers = $derived(
    type === 'location' && answer?.lat != null && answer?.lon != null
      ? ([
          ...(guess ? [{ id: 'guess', lat: guess.lat, lon: guess.lon, city: null, state: null, country: null }] : []),
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
          <!-- useLocationPin: our marker ids ('guess'/'answer') are not real asset IDs, so the
               default image-marker branch would 404 (see the mapMarkers comment above). -->
          <Map
            {mapMarkers}
            autoFitBounds
            useLocationPin
            simplified
            rounded
            showSimpleControls={false}
            showSettings={false}
          >
            {#snippet popup({ marker })}
              <!-- Map.svelte's location-pin branch draws the SAME icon (colour, shape, size) for
                   every marker (Map.svelte:429-431) — there is no per-marker style override in its
                   public API, and redesigning Map.svelte is out of scope here. This on-tap label is
                   the only differentiation available: the guess and answer pins are visually
                   identical at rest, and two guesses within ~35px still collapse into one cluster
                   badge (Map.svelte:404), which is worse for a near-perfect guess. -->
              <span class="text-sm font-medium">{marker.id === 'guess' ? $t('game_guess') : $t('game_actual')}</span>
            {/snippet}
          </Map>
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

<script lang="ts">
  import RoundPhoto from '$lib/components/games/round-photo.svelte';
  import Map from '$lib/components/shared-components/map/Map.svelte';
  import { wrapLongitude } from '$lib/utils/game';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    challengeId: string;
    index: number;
    onGuess: (point: { lat: number; lon: number }) => void;
  };

  let { challengeId, index, onGuess }: Props = $props();

  // Held until the player taps the map; the guess button stays genuinely disabled (not just
  // styled) while this is undefined, and a click can't fire onGuess before it is set.
  let pin: { lat: number; lon: number } | undefined = $state();

  function handleGuess() {
    if (!pin) {
      return;
    }
    onGuess(pin);
  }
</script>

<div data-testid="location-round" class="relative size-full overflow-hidden">
  <RoundPhoto {challengeId} {index} alt={$t('game_where_was_this')} />

  <!-- Map inset over the photo, per the approved mockup. -->
  <div class="absolute inset-x-3 bottom-3 flex flex-col gap-2 sm:inset-x-auto sm:inset-e-3 sm:w-72 md:w-80">
    <div class="h-48 overflow-hidden rounded-2xl shadow-lg sm:h-56">
      <!-- mapMarkers must stay an explicit [] — leaving it undefined makes Map.svelte fetch and
           render the player's ENTIRE geotagged library (getMapMarkers, global — not space-scoped;
           the space-scoped endpoint needs a spaceId prop that isn't passed here), which could
           include the round's answer. mapMarkers is $bindable(), so a self-fetch inside Map.svelte
           can still write a freshly-fetched marker set back into it after mount — Map.svelte now
           gates its two self-fetch paths (the mount-time fetch and onAssetsChanged, its handler for
           the global asset-changed websocket event) on whether markers were supplied at init, so
           this [] closes both. The one remaining path is the settings-cog click handler
           (handleSettingsClick), which is not gated the same way — showSettings={false} below hides
           the cog so it can't be reached at all. The player's placed pin still renders: handleMapClick
           in Map.svelte drops a plain maplibre-gl Marker on click, independent of mapMarkers. -->
      <Map
        mapMarkers={[]}
        clickable
        useLocationPin
        simplified
        rounded
        showSimpleControls={false}
        showSettings={false}
        onClickPoint={({ lat, lng }) => (pin = { lat, lon: wrapLongitude(lng) })}
      />
    </div>

    <p class="self-center rounded-full bg-black/70 px-3 py-1 text-center text-xs text-white sm:text-sm">
      {$t('game_place_your_pin')}
    </p>

    <!-- Placing a pin is mouse/touch-only today (a keyboard-only user can never trigger this) - a
         full fix (coordinate or place-search entry) is a separate design decision. In the meantime,
         this announces the Guess button's enabled state changing for anyone relying on a screen
         reader. The coordinates themselves (not a translated sentence) are the announced content -
         genuinely informative on their own, and numbers need no new i18n key. -->
    <div class="sr-only" aria-live="polite" data-testid="location-round-pin-announcement">
      {#if pin}
        {pin.lat.toFixed(2)}, {pin.lon.toFixed(2)}
      {/if}
    </div>

    <Button variant="filled" fullWidth disabled={!pin} onclick={handleGuess} data-testid="location-round-guess">
      {$t('game_guess')}
    </Button>
  </div>
</div>

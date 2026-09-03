<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { locale, t } from 'svelte-i18n';

  // The per-tile chrome for both cleanup grids, so the markup and the testid contract exist ONCE.
  //
  // The date is not decoration: for babies and toddlers it is usually a stronger signal than the crop, and it
  // costs nothing extra because the column rides a query that already ran.
  //
  // The magnifier is always rendered rather than hover-only, which would strand touch and keyboard users; it
  // dims instead. Its click MUST NOT reach the tile button behind it — selecting a face is a staged decision,
  // and looking at a photo is not.
  //
  // Defence in depth, not the guarantee. The guarantee is structural: this button is a SIBLING of the tile
  // button, and a click bubbles only up its own ancestor chain, so it can never reach the tile. This call
  // matters only if someone later adds a click handler to the wrapper or a container above it. T7.7 pins the
  // sibling structure; if that ever regresses to nesting, T7.3 fails too.
  interface Props {
    localDateTime: string;
    onOpen: () => void;
  }

  const { localDateTime, onOpen }: Props = $props();

  // Luxon directly, and UTC: see FacePhotoModal for why fromISODateTimeUTC's `DateTime<true>` cast is the
  // wrong tool when invalid input is a real case. Month + year fits a ~90px tile in the 8-column grid.
  const takenLabel = $derived.by(() => {
    const parsed = DateTime.fromISO(localDateTime, { zone: 'UTC', locale: $locale ?? undefined });
    return parsed.isValid ? parsed.toLocaleString({ month: 'short', year: 'numeric' }) : null;
  });
</script>

{#if takenLabel}
  <span
    class="pointer-events-none absolute bottom-1 left-1 rounded-sm bg-black/60 px-1 py-px text-[9px] font-semibold text-white"
    data-testid="face-tile-date"
  >
    {takenLabel}
  </span>
{/if}

<button
  type="button"
  class="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-md bg-black/55 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
  aria-label={$t('admin.face_cleanup_view_photo')}
  title={$t('admin.face_cleanup_view_photo')}
  data-testid="face-tile-view-photo"
  onclick={(event) => {
    event.stopPropagation();
    onOpen();
  }}
>
  <Icon icon={mdiMagnify} size="12" color="white" />
</button>

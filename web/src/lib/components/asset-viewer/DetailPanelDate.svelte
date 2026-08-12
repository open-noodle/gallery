<script lang="ts">
  import AssetChangeDateModal from '$lib/modals/AssetChangeDateModal.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { applyContextualFilter } from '$lib/utils/filter-target';
  import { fromISODateTime, fromISODateTimeUTC, toTimelineAsset } from '$lib/utils/timeline-util';
  import { type AssetResponseDto } from '@immich/sdk';
  import { Icon, IconButton, modalManager } from '@immich/ui';
  import { mdiCalendar, mdiPencil } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    /**
     * R3 — was re-derived locally from authManager; every other DetailPanel child takes it as a
     * prop, and only the parent knows about a shared link (where authManager.user THROWS).
     */
    isOwner: boolean;
    /** R4/E2 — false on a shared link. */
    canFilter?: boolean;
  };

  const { asset, isOwner, canFilter = false }: Props = $props();

  const timeZone = $derived(asset.exifInfo?.timeZone ?? undefined);
  const dateTime = $derived(
    timeZone && asset.exifInfo?.dateTimeOriginal
      ? fromISODateTime(asset.exifInfo.dateTimeOriginal, timeZone)
      : fromISODateTimeUTC(asset.localDateTime),
  );

  // E14 — the filter must be the day the row DISPLAYS. `dateTime` above prefers the EXIF timestamp
  // in the asset's own time zone and only falls back to localDateTime, so deriving the day from
  // anything else (localDateTime, or a UTC re-bucketing of dateTime) can filter a DIFFERENT day than
  // the one on screen — e.g. a photo taken 01:00 on 1 Jan in Auckland is 31 Dec in UTC.
  const day = $derived(dateTime?.toISODate() ?? undefined);

  const handleChangeDate = async () => {
    if (!isOwner) {
      return;
    }

    await modalManager.show(AssetChangeDateModal, {
      asset: toTimelineAsset(asset),
      initialDate: dateTime,
      initialTimeZone: timeZone,
    });
  };
</script>

{#if dateTime}
  <!-- R3 — the whole row used to be a <button> meaning "edit date"; the date is a filter now, so the
       edit action moved onto its own pencil IconButton. R10: `detail-panel-edit-date-button` moved
       with it (Playwright clicks that testid to open the modal). -->
  <div class="flex w-full place-items-start justify-between gap-4 py-4 text-start">
    <div class="flex gap-4">
      <Icon icon={mdiCalendar} size="24" />

      <div>
        <p>
          {#if canFilter && day}
            {@const label = dateTime.toLocaleString(
              { month: 'short', day: 'numeric', year: 'numeric' },
              { locale: $locale },
            )}
            <button
              type="button"
              class="text-left hover:text-primary"
              aria-label="{$t('filter_by_date')}: {label}"
              onclick={() => applyContextualFilter({ dateAfter: day, dateBefore: day })}
            >
              {label}
            </button>
          {:else}
            {dateTime.toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' }, { locale: $locale })}
          {/if}
        </p>
        <div class="flex gap-2 text-sm">
          <p>
            {dateTime.toLocaleString(
              {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: timeZone ? 'longOffset' : undefined,
              },
              { locale: $locale },
            )}
          </p>
        </div>
      </div>
    </div>

    {#if isOwner}
      <IconButton
        icon={mdiPencil}
        aria-label={$t('edit_date')}
        size="small"
        shape="round"
        color="secondary"
        variant="ghost"
        onclick={handleChangeDate}
        data-testid="detail-panel-edit-date-button"
      />
    {/if}
  </div>
{:else if !dateTime && isOwner}
  <div class="flex place-items-start justify-between gap-4 py-4">
    <div class="flex gap-4">
      <Icon icon={mdiCalendar} size="24" />
    </div>
    <div class="p-1">
      <Icon icon={mdiPencil} size="20" />
    </div>
  </div>
{/if}

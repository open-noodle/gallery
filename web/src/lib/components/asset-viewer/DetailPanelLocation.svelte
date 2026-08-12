<script lang="ts">
  import { page } from '$app/state';
  import GeolocationPointPickerModal from '$lib/modals/GeolocationPointPickerModal.svelte';
  import { applyContextualFilter, buildContextualMapUrl } from '$lib/utils/filter-target';
  import { handleError } from '$lib/utils/handle-error';
  import { updateAsset, type AssetResponseDto } from '@immich/sdk';
  import { Icon, IconButton, modalManager } from '@immich/ui';
  import { mdiMapMarkerOutline, mdiMapOutline, mdiPencil } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    isOwner: boolean;
    /**
     * R4/E2 — false on a shared link, where there is no timeline to filter. Threaded from
     * DetailPanel exactly like `isOwner`.
     */
    canFilter?: boolean;
    asset: AssetResponseDto;
  };

  let { isOwner, canFilter = false, asset = $bindable() }: Props = $props();

  // R9/E7 — a value that trims to nothing produces a patch that trims to nothing: the click would
  // close the asset viewer and apply NO filter. Such a value is rendered as plain text.
  const city = $derived(asset.exifInfo?.city?.trim() ?? '');
  const state = $derived(asset.exifInfo?.state?.trim() ?? '');
  const country = $derived(asset.exifInfo?.country?.trim() ?? '');

  // E10 — the pin carries the current context (Space scope + active filters) to the full map, and
  // centers it on this asset. Null on an album, which has no map URL (see buildContextualMapUrl).
  const mapUrl = $derived(
    buildContextualMapUrl(
      page.url,
      asset.exifInfo?.latitude && asset.exifInfo.longitude
        ? { lat: asset.exifInfo.latitude, lng: asset.exifInfo.longitude, zoom: 12.5 }
        : undefined,
    ),
  );

  const onAction = async () => {
    const point = await modalManager.show(GeolocationPointPickerModal, { asset });
    if (!point) {
      return;
    }

    try {
      asset = await updateAsset({
        id: asset.id,
        updateAssetDto: { latitude: point.lat, longitude: point.lng },
      });
    } catch (error) {
      handleError(error, $t('errors.unable_to_change_location'));
    }
  };
</script>

{#if asset.exifInfo?.country}
  <!--
    R3 — this row used to be ONE <button> wrapping the pin, all three value lines AND the pencil.
    The three value lines are filter affordances now, so the outer button had to go (a button inside
    a button is invalid HTML) and the pencil became a real IconButton.
  -->
  <div class="flex w-full place-items-start justify-between gap-4 py-4 text-start" data-testid="detail-panel-location">
    <div class="flex gap-4">
      <div><Icon icon={mdiMapMarkerOutline} size="24" /></div>

      <div>
        {#if asset.exifInfo?.city}
          <p>
            {#if canFilter && city}
              <button
                type="button"
                class="text-left hover:text-primary"
                aria-label="{$t('filter_by_location')}: {city}"
                onclick={() => applyContextualFilter({ city, state: undefined, country })}
              >
                {asset.exifInfo.city}
              </button>
            {:else}
              <span>{asset.exifInfo.city}</span>
            {/if}
          </p>
        {/if}
        {#if asset.exifInfo?.state}
          <div class="flex gap-2 text-sm">
            <p>
              {#if canFilter && state}
                <button
                  type="button"
                  class="text-left hover:text-primary"
                  aria-label="{$t('filter_by_location')}: {state}"
                  onclick={() => applyContextualFilter({ city: undefined, state, country })}
                >
                  {asset.exifInfo.state}
                </button>
              {:else}
                <span>{asset.exifInfo.state}</span>
              {/if}
            </p>
          </div>
        {/if}
        {#if asset.exifInfo?.country}
          <div class="flex gap-2 text-sm">
            <p>
              {#if canFilter && country}
                <button
                  type="button"
                  class="text-left hover:text-primary"
                  aria-label="{$t('filter_by_location')}: {country}"
                  onclick={() => applyContextualFilter({ city: undefined, state: undefined, country })}
                >
                  {asset.exifInfo.country}
                </button>
              {:else}
                <span>{asset.exifInfo.country}</span>
              {/if}
            </p>
          </div>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-1">
      {#if canFilter && mapUrl}
        <IconButton
          href={mapUrl}
          icon={mdiMapOutline}
          aria-label={$t('view_in_map')}
          size="small"
          shape="round"
          color="secondary"
          variant="ghost"
        />
      {/if}
      {#if isOwner}
        <IconButton
          icon={mdiPencil}
          aria-label={$t('edit_location')}
          size="small"
          shape="round"
          color="secondary"
          variant="ghost"
          onclick={onAction}
        />
      {/if}
    </div>
  </div>
{:else if !asset.exifInfo?.city && isOwner}
  <!--
    The ONLY entry point to the geo picker for an asset with no location at all. Untested before this
    slice; pinned by detail-panel-location.spec.ts now. Do not delete it "fixing" the branch above.
  -->
  <button
    type="button"
    class="flex w-full place-items-start justify-between gap-4 rounded-lg py-4 text-start hover:text-primary"
    onclick={onAction}
    title={$t('add_location')}
    data-testid="detail-panel-location"
  >
    <div class="flex gap-4">
      <div><Icon icon={mdiMapMarkerOutline} size="24" /></div>
      <p>{$t('add_a_location')}</p>
    </div>
    <div class="p-1 focus:outline-none">
      <Icon icon={mdiPencil} size="20" />
    </div>
  </button>
{/if}

<script lang="ts">
  import StarRating, { type Rating } from '$lib/elements/StarRating.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { handlePromiseError } from '$lib/utils';
  import { applyContextualFilter } from '$lib/utils/filter-target';
  import { handleError } from '$lib/utils/handle-error';
  import { updateAsset, type AssetResponseDto } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiFilterOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    isOwner: boolean;
    /** R4/E2 — false on a shared link, where there is no timeline to filter. */
    canFilter?: boolean;
  }

  let { asset, isOwner, canFilter = false }: Props = $props();

  let rating = $derived(asset.exifInfo?.rating ?? null) as Rating;

  const handleChangeRating = async (rating: Rating) => {
    try {
      await updateAsset({ id: asset.id, updateAssetDto: { rating } });
    } catch (error) {
      handleError(error, $t('errors.cant_apply_changes'));
    }
  };

  /**
   * R6 — the stars ARE the editing control (a star click already means "set the rating to N"), so
   * the filter cannot live on the value. It gets its own icon.
   *
   * R9 — and only when there is a rating to filter BY: parseRating (filter-url.ts) rejects anything
   * outside 1..5, so an unrated asset's icon would close the asset viewer and apply nothing at all.
   */
  let filterableRating = $derived(rating !== null && rating >= 1 && rating <= 5 ? rating : undefined);
</script>

{#if !authManager.isSharedLink && authManager.authenticated && authManager.preferences.ratings.enabled}
  <section class="flex items-center gap-2 px-4 pt-4" data-testid="detail-panel-rating">
    <StarRating {rating} readOnly={!isOwner} onRating={(rating) => handlePromiseError(handleChangeRating(rating))} />
    {#if canFilter && filterableRating !== undefined}
      <IconButton
        icon={mdiFilterOutline}
        aria-label="{$t('filter_by_rating')}: {filterableRating}"
        size="small"
        shape="round"
        color="secondary"
        variant="ghost"
        onclick={() => applyContextualFilter({ rating: filterableRating })}
      />
    {/if}
  </section>
{/if}

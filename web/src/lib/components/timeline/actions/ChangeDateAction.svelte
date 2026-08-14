<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import AssetSelectionChangeDateModal from '$lib/modals/AssetSelectionChangeDateModal.svelte';
  import { fromTimelinePlainDateTime } from '$lib/utils/timeline-util';
  import { modalManager } from '@immich/ui';
  import { mdiCalendarEditOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    menuItem?: boolean;
    /**
     * #734: which of the current selection the caller may edit — send only these. Omitted on
     * surfaces that don't resolve it (every render site outside `SelectionToolbar.svelte`),
     * where it falls back to the pre-#734 ownership-only filter.
     */
    editableSelectedAssetIds?: string[];
  };

  let { menuItem = false, editableSelectedAssetIds }: Props = $props();

  const handleChangeDate = async () => {
    // The modal narrows to `editableAssetIds` itself (and reports the skipped count) at
    // submit time — mirrors ChangeDescription/ChangeLocation, which likewise pass the full
    // selection through and let the eventual API call do the filtering.
    const assets = assetMultiSelectManager.assets;
    const initialDate = assets.length === 1 ? fromTimelinePlainDateTime(assets[0].localDateTime) : DateTime.now();
    const success = await modalManager.show(AssetSelectionChangeDateModal, {
      initialDate,
      assets,
      editableAssetIds: editableSelectedAssetIds ?? assetMultiSelectManager.getOwnedAssets().map((asset) => asset.id),
    });
    if (success) {
      assetMultiSelectManager.clear();
    }
  };
</script>

{#if menuItem}
  <MenuOption text={$t('change_date')} icon={mdiCalendarEditOutline} onClick={handleChangeDate} />
{/if}

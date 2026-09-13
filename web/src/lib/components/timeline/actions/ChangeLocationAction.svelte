<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import GeolocationPointPickerModal from '$lib/modals/GeolocationPointPickerModal.svelte';
  import { getEditableAssetsWithWarning, getOwnedAssetsWithWarning } from '$lib/utils/asset-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { updateAssets } from '@immich/sdk';
  import { modalManager, toastManager } from '@immich/ui';
  import { mdiMapMarkerMultipleOutline } from '@mdi/js';
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

  const onAction = async () => {
    const point = await modalManager.show(GeolocationPointPickerModal, {});
    if (!point) {
      return;
    }

    const ids =
      editableSelectedAssetIds === undefined
        ? getOwnedAssetsWithWarning(assetMultiSelectManager.assets, authManager.user)
        : getEditableAssetsWithWarning(assetMultiSelectManager.assets, editableSelectedAssetIds);

    try {
      await updateAssets({ assetBulkUpdateDto: { ids, latitude: point.lat, longitude: point.lng } });
      toastManager.primary();
      assetMultiSelectManager.clear();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_location'));
    }
  };
</script>

{#if menuItem}
  <MenuOption text={$t('change_location')} icon={mdiMapMarkerMultipleOutline} onClick={onAction} />
{/if}

<script lang="ts">
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import AssetUpdateDescriptionConfirmModal from '$lib/modals/AssetUpdateDescriptionConfirmModal.svelte';
  import { getEditableAssetsWithWarning, getOwnedAssetsWithWarning } from '$lib/utils/asset-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { updateAssets } from '@immich/sdk';
  import { modalManager } from '@immich/ui';
  import { mdiText } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import MenuOption from '../../shared-components/context-menu/MenuOption.svelte';

  interface Props {
    menuItem?: boolean;
    /**
     * #734: which of the current selection the caller may edit — send only these. Omitted on
     * surfaces that don't resolve it (every render site outside `SelectionToolbar.svelte`),
     * where it falls back to the pre-#734 ownership-only filter.
     */
    editableSelectedAssetIds?: string[];
  }

  let { menuItem = false, editableSelectedAssetIds }: Props = $props();

  const handleUpdateDescription = async () => {
    const description = await modalManager.show(AssetUpdateDescriptionConfirmModal);
    if (description) {
      const ids =
        editableSelectedAssetIds === undefined
          ? getOwnedAssetsWithWarning(assetMultiSelectManager.assets, authManager.user)
          : getEditableAssetsWithWarning(assetMultiSelectManager.assets, editableSelectedAssetIds);

      try {
        await updateAssets({ assetBulkUpdateDto: { ids, description } });
        assetMultiSelectManager.clear();
      } catch (error) {
        handleError(error, $t('errors.unable_to_change_description'));
      }
    }
  };
</script>

{#if menuItem}
  <MenuOption text={$t('change_description')} icon={mdiText} onClick={() => handleUpdateDescription()} />
{/if}

<script lang="ts">
  import { shortcut } from '$lib/actions/shortcut';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import AssetTagModal from '$lib/modals/AssetTagModal.svelte';
  import { getEditableAssetsWithWarning } from '$lib/utils/asset-utils';
  import { IconButton, modalManager } from '@immich/ui';
  import { mdiTagMultipleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    menuItem?: boolean;
    /**
     * #734: which of the current selection the caller may edit — send only these. Omitted on
     * surfaces that don't resolve it (every render site outside `SelectionToolbar.svelte`),
     * where this falls back to the exact pre-#734 ownership-only filter (no toast, no
     * empty-selection guard) so those pages stay behaviour-identical.
     */
    editableSelectedAssetIds?: string[];
  }

  let { menuItem = false, editableSelectedAssetIds }: Props = $props();

  const text = $t('tag');
  const icon = mdiTagMultipleOutline;

  const handleTagAssets = async () => {
    if (editableSelectedAssetIds === undefined) {
      const assets = assetMultiSelectManager.ownedAssets;
      const didUpdate = await modalManager.show(AssetTagModal, { assetIds: assets.map(({ id }) => id) });
      if (didUpdate) {
        assetMultiSelectManager.clear();
      }
      return;
    }

    // #734: send only the editable subset, and report the skipped (not-editable) count via a
    // toast. A selection resolved to nothing editable must not open the modal at all — that's
    // exactly the empty-assetIds "false success" this branch exists to prevent.
    const ids = getEditableAssetsWithWarning(assetMultiSelectManager.assets, editableSelectedAssetIds);
    if (ids.length === 0) {
      return;
    }
    const didUpdate = await modalManager.show(AssetTagModal, { assetIds: ids });
    if (didUpdate) {
      assetMultiSelectManager.clear();
    }
  };
</script>

<svelte:document use:shortcut={{ shortcut: { key: 't' }, onShortcut: handleTagAssets }} />

{#if menuItem}
  <MenuOption {text} {icon} onClick={handleTagAssets} />
{/if}

{#if !menuItem}
  <IconButton shape="round" color="secondary" variant="ghost" aria-label={text} {icon} onclick={handleTagAssets} />
{/if}

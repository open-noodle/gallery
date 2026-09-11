<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { mergeRotation } from '$lib/services/asset.service';
  import { waitForWebsocketEvent } from '$lib/stores/websocket';
  import { getEditableAssetsWithWarning } from '$lib/utils/asset-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { editAsset, getAssetEdits, getAssetInfo, removeAssetEdits } from '@immich/sdk';
  import { toastManager } from '@immich/ui';
  import { mdiRotateLeft, mdiRotateRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    /**
     * #734: which of the current selection the caller may edit — send only these. Omitted on
     * surfaces that don't resolve it (every render site outside `SelectionToolbar.svelte`),
     * where it falls back to the pre-#734 ownership-only filter.
     */
    editableSelectedAssetIds?: string[];
  }

  let { editableSelectedAssetIds }: Props = $props();

  const handleRotate = async (angle: number) => {
    try {
      // getEditableAssetsWithWarning also reports the skipped (not-editable) count via a toast.
      const ids =
        editableSelectedAssetIds === undefined
          ? assetMultiSelectManager.getOwnedAssets().map((asset) => asset.id)
          : getEditableAssetsWithWarning(assetMultiSelectManager.assets, editableSelectedAssetIds);
      const editableIds = new Set(ids);
      const assets = assetMultiSelectManager.assets.filter((asset) => editableIds.has(asset.id) && asset.isImage);
      if (assets.length === 0) {
        return;
      }

      let success = 0;
      let failed = 0;
      const pendingRefreshes: Promise<void>[] = [];

      for (const asset of assets) {
        try {
          const existing = await getAssetEdits({ id: asset.id });
          const edits = mergeRotation(
            existing.edits.map(({ action, parameters }) => ({ action, parameters })),
            angle,
          );

          const editCompleted = waitForWebsocketEvent(
            'AssetEditReadyV2',
            (event) => event.asset.id === asset.id,
            10_000,
          );

          await (edits.length === 0
            ? removeAssetEdits({ id: asset.id })
            : editAsset({ id: asset.id, assetEditsCreateDto: { edits } }));

          pendingRefreshes.push(
            editCompleted
              .then(() => getAssetInfo({ id: asset.id }))
              .then((refreshed) => void eventManager.emit('AssetUpdate', refreshed))
              .catch(() => {}),
          );
          success++;
        } catch {
          failed++;
        }
      }

      if (failed > 0) {
        toastManager.warning($t('rotated_count', { values: { count: success } }) + ` (${failed} ${$t('failed')})`);
      } else {
        toastManager.success($t('rotated_count', { values: { count: success } }));
      }

      assetMultiSelectManager.clear();

      // Refresh thumbnails in the background after edits complete
      void Promise.allSettled(pendingRefreshes);
    } catch (error) {
      handleError(error, $t('rotate_error'));
    }
  };
</script>

<MenuOption icon={mdiRotateRight} text={$t('rotate_right')} onClick={() => handleRotate(90)} />
<MenuOption icon={mdiRotateLeft} text={$t('rotate_left')} onClick={() => handleRotate(270)} />
<MenuOption icon={mdiRotateRight} text={$t('rotate_180')} onClick={() => handleRotate(180)} />

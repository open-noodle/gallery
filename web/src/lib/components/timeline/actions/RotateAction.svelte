<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/menu-option.svelte';
  import { getAssetControlContext } from '$lib/utils/context';
  import { handleError } from '$lib/utils/handle-error';
  import { AssetEditAction, editAsset, getAssetEdits, type AssetEditActionItemDto } from '@immich/sdk';
  import { toastManager } from '@immich/ui';
  import { mdiRotateLeft, mdiRotateRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  let loading = $state(false);

  const { clearSelect, getOwnedAssets } = getAssetControlContext();

  const handleRotate = async (angle: number) => {
    loading = true;
    try {
      const assets = [...getOwnedAssets()].filter((asset) => asset.isImage);
      if (assets.length === 0) {
        return;
      }

      let success = 0;
      let failed = 0;

      for (const asset of assets) {
        try {
          const existing = await getAssetEdits({ id: asset.id });
          const newEdit: AssetEditActionItemDto = {
            action: AssetEditAction.Rotate,
            parameters: { angle },
          };
          const edits = [...existing.edits.map(({ action, parameters }) => ({ action, parameters })), newEdit];
          await editAsset({ id: asset.id, assetEditsCreateDto: { edits } });
          success++;
        } catch {
          failed++;
        }
      }

      if (failed > 0) {
        toastManager.warning(
          $t('rotated_count', { values: { count: success } }) + ` (${failed} ${$t('failed')})`,
        );
      } else {
        toastManager.success($t('rotated_count', { values: { count: success } }));
      }

      clearSelect();
    } catch (error) {
      handleError(error, $t('rotate_error'));
    } finally {
      loading = false;
    }
  };
</script>

<MenuOption icon={mdiRotateRight} text={$t('rotate_right')} onClick={() => handleRotate(90)} />
<MenuOption icon={mdiRotateLeft} text={$t('rotate_left')} onClick={() => handleRotate(-90)} />
<MenuOption icon={mdiRotateRight} text={$t('rotate_180')} onClick={() => handleRotate(180)} />

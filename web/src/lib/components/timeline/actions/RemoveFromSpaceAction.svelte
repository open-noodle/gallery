<script lang="ts">
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { removeAssets } from '@immich/sdk';
  import { IconButton, modalManager, toastManager } from '@immich/ui';
  import { mdiImageRemoveOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceId: string;
    onRemove?: (assetIds: string[]) => void;
  }

  let { spaceId, onRemove }: Props = $props();

  const removeFromSpace = async () => {
    const assets = [...assetMultiSelectManager.assets];
    const isConfirmed = await modalManager.showDialog({
      prompt: $t('remove_assets_shared_space_confirmation', { values: { count: assets.length } }),
    });

    if (!isConfirmed) {
      return;
    }

    try {
      const assetIds = assets.map((a) => a.id);
      await removeAssets({
        id: spaceId,
        sharedSpaceAssetRemoveDto: { assetIds },
      });

      eventManager.emit('SpaceRemoveAssets', { assetIds, spaceId });
      onRemove?.(assetIds);

      toastManager.success($t('assets_removed_count', { values: { count: assetIds.length } }));
      assetMultiSelectManager.clear();
    } catch (error) {
      handleError(error, $t('errors.error_removing_assets_from_space'));
    }
  };
</script>

<IconButton
  shape="round"
  color="secondary"
  variant="ghost"
  aria-label={$t('remove_from_space')}
  icon={mdiImageRemoveOutline}
  onclick={removeFromSpace}
/>

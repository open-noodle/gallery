<script lang="ts">
  import { removeFromSpace } from '$lib/gallery/space-remove/space-removal';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { IconButton } from '@immich/ui';
  import { mdiImageRemoveOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceId: string;
    onRemove?: (assetIds: string[]) => void;
  }

  let { spaceId, onRemove }: Props = $props();

  // The flow (confirmation, removal, messages) is shared with removing from the Photos timeline.
  const remove = async () => {
    const removedAssetIds = await removeFromSpace(
      spaceId,
      assetMultiSelectManager.assets.map((asset) => asset.id),
    );
    if (removedAssetIds.length > 0) {
      onRemove?.(removedAssetIds);
    }
  };
</script>

<IconButton
  shape="round"
  color="secondary"
  variant="ghost"
  aria-label={$t('remove_from_space')}
  icon={mdiImageRemoveOutline}
  onclick={remove}
/>

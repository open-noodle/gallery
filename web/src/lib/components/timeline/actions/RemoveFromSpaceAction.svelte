<script lang="ts">
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { getSharedSpaceAssetLinkedAlbums, removeAssets } from '@immich/sdk';
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
      // The server removes only DIRECT space members and returns exactly what it removed — a selected
      // asset that is present only via a linked album is a no-op. Reflect the real result so we never
      // optimistically hide (or claim to have removed) an album-projected asset.
      const removedAssetIds = await removeAssets({
        id: spaceId,
        sharedSpaceAssetRemoveDto: { assetIds },
      });

      if (removedAssetIds.length > 0) {
        eventManager.emit('SpaceRemoveAssets', { assetIds: removedAssetIds, spaceId });
        onRemove?.(removedAssetIds);
      }

      const removed = new Set(removedAssetIds);
      const blockedAssetIds = assetIds.filter((id) => !removed.has(id));

      if (blockedAssetIds.length === 0) {
        // Every selected asset was a direct member — a clean removal.
        toastManager.success($t('assets_removed_count', { values: { count: removedAssetIds.length } }));
        assetMultiSelectManager.clear();
        return;
      }

      // The rest are present only via a linked album, so the server removed nothing for them. Name the
      // album(s) so the user knows where to manage them, and keep the selection so they can act on it.
      let albumNames: string[] = [];
      try {
        const albums = await getSharedSpaceAssetLinkedAlbums({
          id: spaceId,
          sharedSpaceAssetRemoveDto: { assetIds: blockedAssetIds },
        });
        albumNames = [...new Set(albums.map((album) => album.albumName))];
      } catch {
        // Best-effort: if the album lookup fails, fall back to the generic explanation below.
      }

      toastManager.warning(
        albumNames.length > 0
          ? $t('remove_from_space_album_blocked', {
              values: { count: blockedAssetIds.length, albums: albumNames.join(', ') },
            })
          : $t('no_assets_removed_from_space'),
      );
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

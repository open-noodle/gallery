<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { getAlbumInfo, removeAssetFromAlbum, type AlbumResponseDto } from '@immich/sdk';
  import { IconButton, modalManager, toastManager } from '@immich/ui';
  import { mdiDeleteOutline, mdiImageRemoveOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    album: AlbumResponseDto;
    onRemove: ((assetIds: string[]) => void) | undefined;
    assetIds?: string[];
    menuItem?: boolean;
    /** Playwright hook for the album-path control bar (rbac-5/albums-8, C4). */
    'data-testid'?: string;
  }

  let { album = $bindable(), onRemove, assetIds, menuItem = false, 'data-testid': testId }: Props = $props();

  const removeFromAlbum = async () => {
    const ids = assetIds ?? assetMultiSelectManager.assets.map(({ id }) => id) ?? [];

    const isConfirmed = await modalManager.showDialog({
      prompt: $t('remove_assets_album_confirmation', { values: { count: ids.length } }),
    });

    if (!isConfirmed) {
      return;
    }

    try {
      const results = await removeAssetFromAlbum({
        id: album.id,
        bulkIdsDto: { ids },
      });

      album = await getAlbumInfo({ id: album.id });

      // #752 launch review: the server answers per-asset (a space editor may not remove another
      // member's own album_asset rows) — prune and report only what was actually removed.
      const removedIds = results.filter(({ success }) => success).map(({ id }) => id);
      onRemove?.(removedIds);

      if (removedIds.length === ids.length) {
        toastManager.primary($t('assets_removed_count', { values: { count: removedIds.length } }));
      } else if (removedIds.length > 0) {
        toastManager.info(
          $t('assets_removed_partial_count', {
            values: { removedCount: removedIds.length, totalCount: ids.length },
          }),
        );
      } else {
        toastManager.warning($t('assets_remove_failed_count', { values: { count: ids.length } }));
      }

      assetMultiSelectManager.clear();
    } catch (error) {
      handleError(error, $t('errors.error_removing_assets_from_album'));
    }
  };
</script>

{#if menuItem}
  <MenuOption text={$t('remove_from_album')} icon={mdiImageRemoveOutline} onClick={removeFromAlbum} />
{:else}
  <IconButton
    shape="round"
    color="secondary"
    variant="ghost"
    aria-label={$t('remove_from_album')}
    icon={mdiDeleteOutline}
    onclick={removeFromAlbum}
    data-testid={testId}
  />
{/if}

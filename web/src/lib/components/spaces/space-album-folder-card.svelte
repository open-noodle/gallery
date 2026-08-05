<script lang="ts">
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import SpaceCollage from '$lib/components/spaces/space-collage.svelte';
  import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiDotsVertical, mdiFolder } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    folder: SharedSpaceAlbumFolderDto;
    albumCount: number;
    previewAssetIds: string[];
    canManage: boolean;
    onOpen?: (folder: SharedSpaceAlbumFolderDto) => void;
    onRename?: (folder: SharedSpaceAlbumFolderDto) => void;
    onMove?: (folder: SharedSpaceAlbumFolderDto) => void;
    onDelete?: (folder: SharedSpaceAlbumFolderDto) => void;
  }

  let { folder, albumCount, previewAssetIds, canManage, onOpen, onRename, onMove, onDelete }: Props = $props();

  // SpaceCollage takes {id, thumbhash}; folder previews are resolved album covers, which the
  // server has already cleared through spaceVisibilityGate, so no thumbhash is available.
  const collageAssets = $derived(previewAssetIds.map((id) => ({ id, thumbhash: null })));
</script>

<div
  data-testid="space-album-folder-card"
  draggable={canManage}
  class="group relative rounded-2xl border border-transparent p-5 hover:border-gray-200 hover:bg-gray-100 dark:hover:border-gray-800 dark:hover:bg-gray-900"
>
  {#if canManage}
    <div
      class="absolute inset-e-6 top-6 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
      data-testid="space-album-folder-card-menu"
    >
      <ButtonContextMenu
        icon={mdiDotsVertical}
        title={$t('more')}
        color="secondary"
        variant="filled"
        size="medium"
        align="top-right"
        direction="left"
        buttonClass="icon-white-drop-shadow"
      >
        <MenuOption text={$t('space_album_folder_rename')} onClick={() => onRename?.(folder)} />
        <MenuOption text={$t('space_album_folder_move')} onClick={() => onMove?.(folder)} />
        <MenuOption text={$t('space_album_folder_delete')} onClick={() => onDelete?.(folder)} />
      </ButtonContextMenu>
    </div>
  {/if}

  <button
    type="button"
    class="w-full text-start"
    onclick={() => onOpen?.(folder)}
    data-testid="space-album-folder-card-open"
  >
    <div class="relative aspect-square w-full overflow-hidden rounded-xl">
      <SpaceCollage assets={collageAssets} />
      <!-- Badge, so a folder is never mistaken for an album at a glance. -->
      <div class="absolute inset-s-2 bottom-2 rounded-lg bg-black/55 p-1.5 text-white">
        <Icon icon={mdiFolder} size="20" />
      </div>
    </div>

    <div class="mt-4">
      <p
        class="line-clamp-2 w-full text-lg/6 font-semibold text-black group-hover:text-primary dark:text-white"
        title={folder.name}
      >
        {folder.name}
      </p>
      <p class="text-sm dark:text-immich-dark-fg" data-testid="space-album-folder-card-count">
        {$t('space_album_folder_albums_count', { values: { count: albumCount } })}
      </p>
    </div>
  </button>
</div>

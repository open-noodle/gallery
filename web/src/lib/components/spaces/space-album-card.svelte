<script lang="ts">
  import AlbumCover from '$lib/components/album-page/AlbumCover.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { Route } from '$lib/route';
  import { type AlbumResponseDto, type SharedSpaceLinkedAlbumDto } from '@immich/sdk';
  import { mdiDotsVertical } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceId: string;
    album: SharedSpaceLinkedAlbumDto;
    canManage: boolean;
    onUnlink?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
  }

  let { spaceId, album, canManage, onUnlink, onToggleTimeline }: Props = $props();
</script>

<div
  data-testid="space-album-card"
  class="group relative rounded-2xl border border-transparent p-5 hover:border-gray-200 hover:bg-gray-100 dark:hover:border-gray-800 dark:hover:bg-gray-900"
>
  <!-- ⋯ menu — sibling of the anchor, not inside it -->
  {#if canManage}
    <div
      class="absolute inset-e-6 top-6 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
      data-testid="space-album-card-menu"
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
        <MenuOption
          text={album.showInTimeline ? $t('spaces_hide_from_timeline') : $t('spaces_linked_albums_show_in_timeline')}
          onClick={() => onToggleTimeline?.(album)}
        />
        <MenuOption text={$t('spaces_linked_albums_unlink')} onClick={() => onUnlink?.(album)} />
      </ButtonContextMenu>
    </div>
  {/if}

  <a href={Route.viewSpaceAlbum({ spaceId, albumId: album.id })} data-testid="space-album-card-link">
    <!-- Cover image -->
    <div class="relative aspect-square w-full overflow-hidden rounded-xl {album.showInTimeline ? '' : 'opacity-60'}">
      <AlbumCover album={album as unknown as AlbumResponseDto} class="size-full object-cover" />
    </div>

    <!-- Text info -->
    <div class="mt-4">
      <p
        class="line-clamp-2 w-full text-lg/6 font-semibold text-black group-hover:text-primary dark:text-white"
        title={album.albumName}
      >
        {album.albumName}
      </p>
      <p class="text-sm dark:text-immich-dark-fg">
        {$t('items_count', { values: { count: album.assetCount } })}
        {#if !album.showInTimeline}
          · {$t('space_albums_hidden_from_timeline')}
        {/if}
      </p>
    </div>
  </a>
</div>

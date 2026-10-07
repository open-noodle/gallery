<script lang="ts">
  import AlbumCover from '$lib/components/album-page/AlbumCover.svelte';
  import { Route } from '$lib/route';
  import { setActiveDragPayload, writeDragPayload } from '$lib/utils/space-album-folder-dnd';
  import { type AlbumResponseDto, type SharedSpaceLinkedAlbumDto } from '@immich/sdk';
  import { ContextMenuButton } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceId: string;
    album: SharedSpaceLinkedAlbumDto;
    canManage: boolean;
    onUnlink?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleMyTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
    onMove?: (album: SharedSpaceLinkedAlbumDto) => void;
  }

  let { spaceId, album, canManage, onUnlink, onToggleTimeline, onToggleMyTimeline, onMove }: Props = $props();

  // Plain items for @immich/ui's menuManager, which only mounts a menu when one is opened. The old
  // per-card ButtonContextMenu kept a hidden menu plus window/document listeners alive for every
  // card, which is most of what made a space with thousands of albums slow to open.
  const menuItems = $derived([
    {
      title: album.hiddenFromMyTimeline
        ? $t('space_albums_show_in_my_timeline')
        : $t('space_albums_hide_from_my_timeline'),
      onAction: () => onToggleMyTimeline?.(album),
    },
    {
      title: album.showInTimeline
        ? $t('space_albums_hide_from_space_photos')
        : $t('spaces_linked_albums_show_in_timeline'),
      $if: () => canManage,
      onAction: () => onToggleTimeline?.(album),
    },
    { title: $t('space_album_folder_move'), $if: () => canManage, onAction: () => onMove?.(album) },
    { title: $t('spaces_linked_albums_unlink'), $if: () => canManage, onAction: () => onUnlink?.(album) },
  ]);
</script>

<div
  data-testid="space-album-card"
  role="listitem"
  draggable={canManage}
  ondragstart={(event) => {
    // draggable="false" on this div does not stop the inner <a>/cover image from being natively
    // draggable, and dragstart bubbles — so without this guard a viewer could still drag the
    // cover and write a payload. No target ever accepts it (every drop target also gates on
    // canManage) and the server enforces regardless, but this keeps that guarantee local rather
    // than relying on every other surface getting it right.
    if (!canManage || !event.dataTransfer) {
      return;
    }
    const payload = { kind: 'album' as const, id: album.id };
    writeDragPayload(event.dataTransfer, payload);
    setActiveDragPayload(payload);
  }}
  ondragend={() => setActiveDragPayload(null)}
  class="group relative rounded-2xl border border-transparent p-5 [contain-intrinsic-height:auto_20rem] [content-visibility:auto] hover:border-gray-200 hover:bg-gray-100 dark:hover:border-gray-800 dark:hover:bg-gray-900"
>
  <!-- ⋯ menu — sibling of the anchor, not inside it. Every member sees it (the "my timeline" item
       is a personal preference, not an editor action); only canManage adds the space-wide items. -->
  <div
    class="absolute inset-e-6 top-6 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
    data-testid="space-album-card-menu"
  >
    <ContextMenuButton
      aria-label={$t('more')}
      position="top-left"
      variant="filled"
      class="icon-white-drop-shadow"
      items={menuItems}
    />
  </div>

  <a href={Route.viewSpaceAlbum({ spaceId, albumId: album.id })} data-testid="space-album-card-link">
    <!-- Cover image -->
    <div
      class="relative aspect-square w-full overflow-hidden rounded-xl {album.showInTimeline &&
      !album.hiddenFromMyTimeline
        ? ''
        : 'opacity-60'}"
    >
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
          · {$t('space_albums_hidden_from_space_photos')}
        {/if}
        {#if album.hiddenFromMyTimeline}
          · {$t('space_albums_hidden_from_timeline')}
        {/if}
      </p>
    </div>
  </a>
</div>

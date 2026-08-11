<script lang="ts">
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { SortOrder, locale } from '$lib/stores/preferences.store';
  import { spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
  import {
    isSpaceAlbumGroupCollapsed,
    toggleSpaceAlbumGroupCollapsing,
    type SpaceAlbumGroup,
  } from '$lib/utils/space-album-grouping';
  import { getFolderContents, getRecursiveAlbumCount } from '$lib/utils/space-album-folders';
  import { dateFormats } from '$lib/constants';
  import { Route } from '$lib/route';
  import { type SharedSpaceAlbumFolderDto, type SharedSpaceLinkedAlbumDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight, mdiDotsVertical, mdiFolder } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { slide } from 'svelte/transition';

  interface Props {
    spaceId: string;
    albums: SharedSpaceLinkedAlbumDto[];
    canManage: boolean;
    groups?: SpaceAlbumGroup[];
    grouped?: boolean;
    folders?: SharedSpaceAlbumFolderDto[];
    /** EVERY linked album in the space, not just this level — recursive counts need the lot. */
    allAlbums?: SharedSpaceLinkedAlbumDto[];
    currentFolderId?: string | null;
    onUnlink?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleMyTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
    onOpenFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
  }

  let {
    spaceId,
    albums,
    canManage,
    groups = [],
    grouped = false,
    folders = [],
    allAlbums = [],
    currentFolderId = null,
    onUnlink,
    onToggleTimeline,
    onToggleMyTimeline,
    onOpenFolder,
  }: Props = $props();

  const dateLocaleString = (dateString: string) => {
    return new Date(dateString).toLocaleDateString($locale, dateFormats.album);
  };

  // Same rule as the cover grid: sort by name, honour the sort DIRECTION, ignore the sort key.
  // Switching view modes (or sort-by-item-count etc.) must never reorder the folder list.
  const levelFolders = $derived(
    getFolderContents(folders, [], currentFolderId)
      .folders.slice()
      .sort((a, b) =>
        $spaceAlbumViewSettings.sortOrder === SortOrder.Desc
          ? b.name.localeCompare(a.name)
          : a.name.localeCompare(b.name),
      ),
  );
</script>

{#snippet albumRow(album: SharedSpaceLinkedAlbumDto)}
  <tr
    class="flex w-full place-items-center border-3 border-transparent p-2 text-center odd:bg-subtle/80 even:bg-subtle/20 hover:border-immich-primary/75 md:px-5 md:py-2 odd:dark:bg-immich-dark-gray/75 even:dark:bg-immich-dark-gray/50 dark:hover:border-immich-dark-primary/75"
  >
    <td class="text-md w-8/12 items-center text-start text-ellipsis sm:w-4/12 md:w-4/12 xl:w-[30%] 2xl:w-[40%]">
      <a
        href={Route.viewSpaceAlbum({ spaceId, albumId: album.id })}
        data-testid="space-album-row-{album.id}"
        class="hover:text-immich-primary"
      >
        {album.albumName}
      </a>
    </td>
    <td class="text-md text-center text-ellipsis sm:w-2/12 md:w-2/12 xl:w-[15%] 2xl:w-[12%]">
      {$t('items_count', { values: { count: album.assetCount } })}
    </td>
    <td class="text-md hidden w-3/12 text-center text-ellipsis sm:block xl:w-[15%] 2xl:w-[12%]">
      {dateLocaleString(album.updatedAt)}
    </td>
    <td class="text-md hidden w-3/12 text-center text-ellipsis sm:block xl:w-[15%] 2xl:w-[12%]">
      {dateLocaleString(album.createdAt)}
    </td>
    <!-- Every member sees the menu (the "my timeline" item is a personal preference, not an
         editor action); only canManage adds the space-wide items. -->
    <td class="text-md w-1/12 text-end" data-testid="space-album-row-menu-{album.id}">
      <ButtonContextMenu
        icon={mdiDotsVertical}
        title={$t('more')}
        color="secondary"
        variant="ghost"
        size="medium"
        align="top-right"
        direction="left"
      >
        <MenuOption
          text={album.hiddenFromMyTimeline
            ? $t('space_albums_show_in_my_timeline')
            : $t('space_albums_hide_from_my_timeline')}
          onClick={() => onToggleMyTimeline?.(album)}
        />
        {#if canManage}
          <MenuOption
            text={album.showInTimeline
              ? $t('space_albums_hide_from_space_photos')
              : $t('spaces_linked_albums_show_in_timeline')}
            onClick={() => onToggleTimeline?.(album)}
          />
          <MenuOption text={$t('spaces_linked_albums_unlink')} onClick={() => onUnlink?.(album)} />
        {/if}
      </ButtonContextMenu>
    </td>
  </tr>
{/snippet}

{#snippet folderRow(folder: SharedSpaceAlbumFolderDto)}
  <tr
    class="flex w-full cursor-pointer place-items-center border-3 border-transparent p-2 text-center odd:bg-subtle/80 even:bg-subtle/20 hover:border-immich-primary/75 md:px-5 md:py-2 odd:dark:bg-immich-dark-gray/75 even:dark:bg-immich-dark-gray/50 dark:hover:border-immich-dark-primary/75"
    data-testid="space-album-folder-row-{folder.id}"
    onclick={() => onOpenFolder?.(folder)}
  >
    <td
      class="text-md flex w-8/12 items-center gap-2 text-start text-ellipsis sm:w-4/12 md:w-4/12 xl:w-[30%] 2xl:w-[40%]"
    >
      <Icon icon={mdiFolder} size="20" />
      {folder.name}
    </td>
    <td class="text-md text-center text-ellipsis sm:w-2/12 md:w-2/12 xl:w-[15%] 2xl:w-[12%]">
      {$t('space_album_folder_albums_count', {
        values: { count: getRecursiveAlbumCount(folders, allAlbums, folder.id) },
      })}
    </td>
    <td class="text-md hidden w-3/12 text-center text-ellipsis sm:block xl:w-[15%] 2xl:w-[12%]"></td>
    <td class="text-md hidden w-3/12 text-center text-ellipsis sm:block xl:w-[15%] 2xl:w-[12%]"></td>
    {#if canManage}
      <td class="text-md w-1/12 text-end"></td>
    {/if}
  </tr>
{/snippet}

<table class="w-full text-start">
  <thead>
    <tr class="flex w-full place-items-center border-3 border-transparent p-2 text-center md:px-5 md:py-2">
      <th class="text-md w-8/12 text-start sm:w-4/12 md:w-4/12 xl:w-[30%] 2xl:w-[40%]">{$t('album_name')}</th>
      <th class="text-md w-4/12 text-center sm:w-2/12 md:w-2/12 xl:w-[15%] 2xl:w-[12%]">{$t('sort_items')}</th>
      <th class="text-md hidden text-center sm:block xl:w-[15%] 2xl:w-[12%]">{$t('sort_modified')}</th>
      <th class="text-md hidden text-center sm:block xl:w-[15%] 2xl:w-[12%]">{$t('date_created')}</th>
      <th class="text-md w-1/12 text-end"></th>
    </tr>
  </thead>
  {#if levelFolders.length > 0}
    <tbody data-testid="space-album-folders-tbody">
      {#each levelFolders as folder (folder.id)}
        {@render folderRow(folder)}
      {/each}
    </tbody>
  {/if}
  {#if grouped}
    {#each groups as group (group.id)}
      {@const collapsed = isSpaceAlbumGroupCollapsed($spaceAlbumViewSettings, group.id)}
      {@const iconRotation = collapsed ? 'rotate-0' : 'rotate-90'}
      <tbody class="mt-4 block w-full">
        <tr
          class="flex w-full place-items-center p-2 md:py-3 md:ps-5 md:pe-5"
          onclick={() => toggleSpaceAlbumGroupCollapsing(group.id)}
          aria-expanded={!collapsed}
          data-testid="space-album-group-header-{group.id}"
        >
          <td class="text-md -mb-1 text-start">
            <Icon
              icon={mdiChevronRight}
              size="20"
              class="-mt-2 inline-block transition-all duration-250 {iconRotation}"
            />
            <span class="text-2xl font-bold">{group.name}</span>
            <span class="ms-1.5">
              ({$t('albums_count', { values: { count: group.albums.length } })})
            </span>
          </td>
        </tr>
      </tbody>
      {#if !collapsed}
        <tbody class="mt-2 block w-full" transition:slide={{ duration: 300 }}>
          {#each group.albums as album (album.id)}
            {@render albumRow(album)}
          {/each}
        </tbody>
      {/if}
    {/each}
  {:else}
    <tbody>
      {#each albums as album (album.id)}
        {@render albumRow(album)}
      {/each}
    </tbody>
  {/if}
</table>

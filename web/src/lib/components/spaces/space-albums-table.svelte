<script lang="ts">
  import { SortOrder, locale } from '$lib/stores/preferences.store';
  import { spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
  import {
    isSpaceAlbumGroupCollapsed,
    toggleSpaceAlbumGroupCollapsing,
    type SpaceAlbumGroup,
  } from '$lib/utils/space-album-grouping';
  import LazyChunks from '$lib/gallery/components/lazy-chunks.svelte';
  import SpaceAlbumsTableHeader from '$lib/components/spaces/space-albums-table-header.svelte';
  import {
    SpaceAlbumSortBy,
    spaceAlbumMenuColumnStyle,
    spaceAlbumSortOptionsMetadata,
  } from '$lib/utils/space-album-sort';
  import { buildFolderSummaries, EMPTY_FOLDER_SUMMARY, getFolderContents } from '$lib/utils/space-album-folders';
  import { dateFormats } from '$lib/constants';
  import { Route } from '$lib/route';
  import { type SharedSpaceAlbumFolderDto, type SharedSpaceLinkedAlbumDto } from '@immich/sdk';
  import { ContextMenuButton, Icon } from '@immich/ui';
  import { mdiChevronRight, mdiFolder } from '@mdi/js';
  import { t } from 'svelte-i18n';

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

  // One pass for the whole space rather than one per rendered row — see buildFolderSummaries.
  const folderSummaries = $derived(buildFolderSummaries(folders, allAlbums));

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
    {#each spaceAlbumSortOptionsMetadata as option (option.id)}
      <td class="text-md text-ellipsis {option.columnStyle}">
        {#if option.id === SpaceAlbumSortBy.Title}
          <a
            href={Route.viewSpaceAlbum({ spaceId, albumId: album.id })}
            data-testid="space-album-row-{album.id}"
            class="hover:text-immich-primary"
          >
            {album.albumName}
          </a>
        {:else if option.id === SpaceAlbumSortBy.ItemCount}
          {$t('items_count', { values: { count: album.assetCount } })}
        {:else if option.id === SpaceAlbumSortBy.DateModified}
          {dateLocaleString(album.updatedAt)}
        {:else if option.id === SpaceAlbumSortBy.DateCreated}
          {dateLocaleString(album.createdAt)}
        {:else if option.id === SpaceAlbumSortBy.MostRecentPhoto}
          {album.endDate ? dateLocaleString(album.endDate) : '-'}
        {:else if option.id === SpaceAlbumSortBy.OldestPhoto}
          {album.startDate ? dateLocaleString(album.startDate) : '-'}
        {:else if option.id === SpaceAlbumSortBy.RecentlyLinked}
          {dateLocaleString(album.linkedAt)}
        {/if}
      </td>
    {/each}
    <!-- Every member sees the menu (the "my timeline" item is a personal preference, not an
         editor action); only canManage adds the space-wide items. -->
    <td class="text-md {spaceAlbumMenuColumnStyle}" data-testid="space-album-row-menu-{album.id}">
      <!-- @immich/ui only mounts the menu once opened; see space-album-card. -->
      <ContextMenuButton
        aria-label={$t('more')}
        position="top-left"
        items={[
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
          { title: $t('spaces_linked_albums_unlink'), $if: () => canManage, onAction: () => onUnlink?.(album) },
        ]}
      />
    </td>
  </tr>
{/snippet}

<!-- Rows mount in chunks near the viewport (see LazyChunks); a row is ~3.5rem tall. -->
{#snippet albumRows(rowAlbums: SharedSpaceLinkedAlbumDto[])}
  <LazyChunks items={rowAlbums} chunkSize={50} estimateHeight={(count) => count * 56} tag="tbody" class="block w-full">
    {#snippet chunk(chunkAlbums)}
      {#each chunkAlbums as album (album.id)}
        {@render albumRow(album)}
      {/each}
    {/snippet}
  </LazyChunks>
{/snippet}

{#snippet folderRow(folder: SharedSpaceAlbumFolderDto)}
  <tr
    class="flex w-full place-items-center border-3 border-transparent p-2 text-center odd:bg-subtle/80 even:bg-subtle/20 hover:border-immich-primary/75 md:px-5 md:py-2 odd:dark:bg-immich-dark-gray/75 even:dark:bg-immich-dark-gray/50 dark:hover:border-immich-dark-primary/75"
    data-testid="space-album-folder-row-{folder.id}"
  >
    {#each spaceAlbumSortOptionsMetadata as option (option.id)}
      {#if option.id === SpaceAlbumSortBy.Title}
        <td class="text-md flex items-center gap-2 text-ellipsis {option.columnStyle}">
          <Icon icon={mdiFolder} size="20" />
          <!-- An anchor, not a click handler on the <tr>: album rows in this same table are links,
             and a row that only responds to a mouse click is unreachable by keyboard and announces
             nothing to a screen reader. Going through the real URL also gives folders the
             middle-click / open-in-new-tab / deep-link behaviour albums already have. The click
             handler stays so the page can navigate client-side without a full load. -->
          <a
            href={Route.viewSpaceAlbums({ id: spaceId, folderId: folder.id })}
            class="hover:text-immich-primary"
            data-testid="space-album-folder-link-{folder.id}"
            onclick={(event) => {
              if (!onOpenFolder) {
                return;
              }
              event.preventDefault();
              onOpenFolder(folder);
            }}
          >
            {folder.name}
          </a>
        </td>
      {:else if option.id === SpaceAlbumSortBy.ItemCount}
        <td class="text-md text-ellipsis {option.columnStyle}">
          {$t('space_album_folder_albums_count', {
            values: { count: (folderSummaries.get(folder.id) ?? EMPTY_FOLDER_SUMMARY).albumCount },
          })}
        </td>
      {:else}
        <td class="text-md text-ellipsis {option.columnStyle}"></td>
      {/if}
    {/each}
    <td class="text-md {spaceAlbumMenuColumnStyle}"></td>
  </tr>
{/snippet}

<table class="w-full text-start">
  <thead>
    <tr class="flex w-full place-items-center border-3 border-transparent p-2 text-center md:px-5 md:py-2">
      {#each spaceAlbumSortOptionsMetadata as option (option.id)}
        <SpaceAlbumsTableHeader {option} />
      {/each}
      <th class="text-md {spaceAlbumMenuColumnStyle}"></th>
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
        {@render albumRows(group.albums)}
      {/if}
    {/each}
  {:else}
    {@render albumRows(albums)}
  {/if}
</table>

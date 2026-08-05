<script lang="ts">
  import type {
    SharedSpaceAlbumFolderDto,
    SharedSpaceLinkedAlbumDto,
    SharedSpaceMemberResponseDto,
  } from '@immich/sdk';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';
  import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
  import {
    buildSpaceAlbumGroups,
    getSelectedSpaceAlbumGroupOption,
    isSpaceAlbumGroupCollapsed,
    toggleSpaceAlbumGroupCollapsing,
  } from '$lib/utils/space-album-grouping';
  import { sortSpaceAlbums } from '$lib/utils/space-album-sort';
  import {
    flattenForSearch,
    getFolderContents,
    getFolderPreviewAssetIds,
    getRecursiveAlbumCount,
  } from '$lib/utils/space-album-folders';
  import type { DragPayload } from '$lib/utils/space-album-folder-dnd';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import SpaceAlbumCard from '$lib/components/spaces/space-album-card.svelte';
  import SpaceAlbumFolderCard from '$lib/components/spaces/space-album-folder-card.svelte';
  import SpaceAlbumsTable from '$lib/components/spaces/space-albums-table.svelte';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { slide } from 'svelte/transition';

  interface Props {
    spaceId: string;
    albums: SharedSpaceLinkedAlbumDto[];
    folders?: SharedSpaceAlbumFolderDto[];
    /** The most recent folders fetch failed — fall back to a flat, unscoped album list rather
     * than hiding every album that lives in a folder we have no metadata for. */
    foldersUnavailable?: boolean;
    currentFolderId?: string | null;
    canManage: boolean;
    members?: SharedSpaceMemberResponseDto[];
    groupIds?: string[];
    searchQuery?: string;
    onUnlink?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleMyTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
    onMoveAlbum?: (album: SharedSpaceLinkedAlbumDto) => void;
    onOpenFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
    onRenameFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
    onMoveFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
    onDeleteFolder?: (folder: SharedSpaceAlbumFolderDto) => void;
    onDropItem?: (payload: DragPayload, targetFolderId: string | null) => void;
  }

  let {
    spaceId,
    albums,
    folders = [],
    foldersUnavailable = false,
    currentFolderId = null,
    canManage,
    members = [],
    // eslint-disable-next-line no-useless-assignment
    groupIds = $bindable([]),
    searchQuery = '',
    onUnlink,
    onToggleTimeline,
    onToggleMyTimeline,
    onMoveAlbum,
    onOpenFolder,
    onRenameFolder,
    onMoveFolder,
    onDeleteFolder,
    onDropItem,
  }: Props = $props();

  const isSearching = $derived((searchQuery ?? '').trim().length > 0);

  // While searching we leave the folder tree entirely: hits come from the whole space, each
  // labelled with its path. `?folder=` is untouched, so clearing the box restores this level.
  // flattenForSearch returns raw server order — re-apply the active sort so a search doesn't
  // silently discard the user's chosen ordering (grouping is the only thing search drops).
  const searchHits = $derived.by(() => {
    if (!isSearching) {
      return [];
    }
    const hits = flattenForSearch(folders, albums, searchQuery);
    const pathByAlbumId = new Map(hits.map((hit) => [hit.album.id, hit.path]));
    const sortedHitAlbums = sortAlbums(hits.map((hit) => hit.album) as unknown as AlbumResponseDto[], {
      sortBy: $spaceAlbumViewSettings.sortBy,
      orderBy: $spaceAlbumViewSettings.sortOrder,
    }) as unknown as SharedSpaceLinkedAlbumDto[];
    return sortedHitAlbums.map((album) => ({ album, path: pathByAlbumId.get(album.id) ?? [] }));
  });

  const searchHitAlbums = $derived(searchHits.map((hit) => hit.album));

  const contents = $derived(getFolderContents(folders, albums, currentFolderId ?? null));

  // Folders sort by NAME, honouring the sort direction but ignoring the sort key: assetCount and
  // mostRecentPhoto do not map onto a folder, and reshuffling them under "sort by item count" is
  // noise. Folders are never part of a search result set, and are hidden entirely (rather than
  // shown untrustworthy) while the folder tree failed to load.
  const sortedFolders = $derived(
    isSearching || foldersUnavailable
      ? []
      : contents.folders
          .slice()
          .sort((a, b) =>
            $spaceAlbumViewSettings.sortOrder === SortOrder.Desc
              ? b.name.localeCompare(a.name)
              : a.name.localeCompare(b.name),
          ),
  );

  // Everything downstream — filter, sort, group — now sees only THIS level's albums. When the
  // folder tree failed to load we can't reliably scope by level at all (we don't know which
  // albums belong at THIS level vs. a folder we have no data for), so degrade to every album in
  // the space, flat — far better than silently hiding anything with a non-null folderId.
  const levelAlbums = $derived(isSearching ? [] : foldersUnavailable ? albums : contents.albums);

  const filtered = $derived.by(() => {
    const q = (searchQuery ?? '').trim().toLowerCase();
    if (!q) {
      return levelAlbums;
    }
    return levelAlbums.filter(
      (a) => a.albumName.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q),
    );
  });

  const sorted = $derived(
    sortSpaceAlbums(filtered, {
      sortBy: $spaceAlbumViewSettings.sortBy,
      orderBy: $spaceAlbumViewSettings.sortOrder,
    }),
  );

  const groups = $derived(
    buildSpaceAlbumGroups(sorted, $spaceAlbumViewSettings, {
      ungrouped: $t('albums'),
      unknownYear: $t('unknown_year'),
      unassigned: $t('unassigned'),
      myAlbums: $t('my_albums'),
      currentUserId: authManager.user.id,
      members: members.map((m) => ({ userId: m.userId, name: m.name })),
    }),
  );

  const isGrouped = $derived(getSelectedSpaceAlbumGroupOption($spaceAlbumViewSettings) !== SpaceAlbumGroupBy.None);

  $effect(() => {
    groupIds = groups.map((g) => g.id);
  });
</script>

{#if isSearching}
  {#if searchHits.length === 0}
    <p data-testid="space-albums-no-results" class="p-4 text-center text-gray-500">{$t('space_albums_no_matching')}</p>
  {:else if $spaceAlbumViewSettings.view === AlbumViewMode.List}
    <!-- Respect the user's List/Cover preference during a search too — it must not be silently
         discarded for the duration of the query. Deliberately UNGROUPED and with no folder rows
         (search escapes the folder tree entirely). -->
    <SpaceAlbumsTable {spaceId} albums={searchHitAlbums} {canManage} {onUnlink} {onToggleTimeline} />
  {:else}
    <!-- Flattened, deliberately UNGROUPED: the path subtitle is the organising signal. -->
    <div class="grid grid-auto-fill-56 gap-y-4">
      {#each searchHits as hit (hit.album.id)}
        <div>
          <SpaceAlbumCard {spaceId} album={hit.album} {canManage} {onUnlink} {onToggleTimeline} {onToggleMyTimeline} onMove={onMoveAlbum} />
          {#if hit.path.length > 0}
            <p class="px-5 text-xs opacity-70" data-testid="space-album-search-path-{hit.album.id}">
              {hit.path.join(' › ')}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{:else if currentFolderId && levelAlbums.length === 0 && sortedFolders.length === 0}
  <!-- Reusing the space-level empty state here would wrongly claim the space has no albums at
       all, when it only means THIS folder is empty. -->
  <p class="p-8 text-center text-gray-500" data-testid="space-album-folder-empty">
    {$t('space_album_folder_empty')}
  </p>
{:else if sortedFolders.length > 0 || filtered.length > 0}
  {#if $spaceAlbumViewSettings.view === AlbumViewMode.List}
    {#if isGrouped}
      <SpaceAlbumsTable
        {spaceId}
        albums={sorted}
        {folders}
        allAlbums={albums}
        {currentFolderId}
        {canManage}
        {groups}
        grouped
        {onUnlink}
        {onToggleTimeline}
        {onToggleMyTimeline}
        {onOpenFolder}
      />
    {:else}
      <SpaceAlbumsTable
        {spaceId}
        albums={sorted}
        {folders}
        allAlbums={albums}
        {currentFolderId}
        {canManage}
        {onUnlink}
        {onToggleTimeline}
        {onToggleMyTimeline}
        {onOpenFolder}
      />
    {/if}
  {:else}
    {#if sortedFolders.length > 0}
      <div class="grid grid-auto-fill-56 gap-y-4" data-testid="space-album-folders-grid">
        {#each sortedFolders as folder (folder.id)}
          <SpaceAlbumFolderCard
            {folder}
            albumCount={getRecursiveAlbumCount(folders, albums, folder.id)}
            previewAssetIds={getFolderPreviewAssetIds(folders, albums, folder.id)}
            {canManage}
            {folders}
            {albums}
            onOpen={onOpenFolder}
            onRename={onRenameFolder}
            onMove={onMoveFolder}
            onDelete={onDeleteFolder}
            {onDropItem}
          />
        {/each}
      </div>
    {/if}
    {#if filtered.length > 0}
      {#if isGrouped}
        {#each groups as group (group.id)}
          {@const collapsed = isSpaceAlbumGroupCollapsed($spaceAlbumViewSettings, group.id)}
          {@const iconRotation = collapsed ? 'rotate-0' : 'rotate-90'}
          <div class="grid">
            <button
              type="button"
              onclick={() => toggleSpaceAlbumGroupCollapsing(group.id)}
              class="mt-2 w-full cursor-pointer rounded-md py-2 pe-2 text-start transition-colors hover:bg-subtle hover:text-primary dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray"
              aria-expanded={!collapsed}
              data-testid="space-album-group-{group.id}"
            >
              <Icon
                icon={mdiChevronRight}
                size="24"
                class="-mt-2.5 inline-block transition-all duration-250 {iconRotation}"
              />
              <span class="text-3xl font-bold text-black dark:text-white">{group.name}</span>
              <span class="ms-1.5">({$t('albums_count', { values: { count: group.albums.length } })})</span>
            </button>
            <hr class="dark:border-immich-dark-gray" />
          </div>
          {#if !collapsed}
            <div class="mt-4 grid grid-auto-fill-56 gap-y-4" transition:slide={{ duration: 300 }}>
              {#each group.albums as album (album.id)}
                <SpaceAlbumCard {spaceId} {album} {canManage} {onUnlink} {onToggleTimeline} {onToggleMyTimeline} onMove={onMoveAlbum} />
              {/each}
            </div>
          {/if}
        {/each}
      {:else}
        <div class="grid grid-auto-fill-56 gap-y-4">
          {#each sorted as album (album.id)}
            <SpaceAlbumCard {spaceId} {album} {canManage} {onUnlink} {onToggleTimeline} {onToggleMyTimeline} onMove={onMoveAlbum} />
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
{:else}
  <!-- Reachable on first paint (folders starts empty and is only filled by the caller's
       on-mount reload, so a space whose albums all live in folders is briefly like this) and,
       without foldersUnavailable being set, on a load failure — never leave the pane silently
       blank while that resolves. -->
  <div class="flex justify-center p-8" data-testid="space-albums-loading">
    <LoadingSpinner />
  </div>
{/if}

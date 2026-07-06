<script lang="ts">
  import { AlbumSortBy, AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';
  import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
  import { type AlbumSortOptionMetadata, findSortOptionMetadata, sortOptionsMetadata } from '$lib/utils/album-utils';
  import {
    collapseAllSpaceAlbumGroups,
    expandAllSpaceAlbumGroups,
    findSpaceGroupOptionMetadata,
    getSelectedSpaceAlbumGroupOption,
    spaceGroupOptionsMetadata,
    type SpaceAlbumGroupOptionMetadata,
  } from '$lib/utils/space-album-grouping';
  import { Button, Icon, Text } from '@immich/ui';
  import {
    mdiArrowDownThin,
    mdiArrowUpThin,
    mdiChevronDown,
    mdiFolderRemoveOutline,
    mdiFormatListBulletedSquare,
    mdiLinkVariantPlus,
    mdiPlus,
    mdiUnfoldLessHorizontal,
    mdiUnfoldMoreHorizontal,
    mdiViewGridOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    groupIds?: string[];
    searchQuery?: string;
    canManage?: boolean;
    onCreate?: () => void;
    onLink?: () => void;
  }

  let { groupIds = [], searchQuery = $bindable(''), canManage = false, onCreate, onLink }: Props = $props();

  let showSortMenu = $state(false);
  let showGroupMenu = $state(false);

  const flipOrdering = (ordering: string) => {
    return ordering === SortOrder.Asc ? SortOrder.Desc : SortOrder.Asc;
  };

  const handleChangeSortBy = ({ id, defaultOrder }: AlbumSortOptionMetadata) => {
    if ($spaceAlbumViewSettings.sortBy === id) {
      $spaceAlbumViewSettings.sortOrder = flipOrdering($spaceAlbumViewSettings.sortOrder);
    } else {
      $spaceAlbumViewSettings.sortBy = id;
      $spaceAlbumViewSettings.sortOrder = defaultOrder;
    }
    showSortMenu = false;
  };

  const handleChangeGroupBy = ({ id, defaultOrder }: SpaceAlbumGroupOptionMetadata) => {
    if ($spaceAlbumViewSettings.groupBy === id) {
      $spaceAlbumViewSettings.groupOrder = flipOrdering($spaceAlbumViewSettings.groupOrder);
    } else {
      $spaceAlbumViewSettings.groupBy = id;
      $spaceAlbumViewSettings.groupOrder = defaultOrder;
    }
    showGroupMenu = false;
  };

  const handleToggleView = () => {
    $spaceAlbumViewSettings.view =
      $spaceAlbumViewSettings.view === AlbumViewMode.Cover ? AlbumViewMode.List : AlbumViewMode.Cover;
  };

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-testid="space-albums-sort-container"]')) {
      showSortMenu = false;
    }
    if (!target.closest('[data-testid="space-albums-group-container"]')) {
      showGroupMenu = false;
    }
  }

  let selectedSortOption = $derived(findSortOptionMetadata($spaceAlbumViewSettings.sortBy));
  let sortIcon = $derived($spaceAlbumViewSettings.sortOrder === SortOrder.Desc ? mdiArrowDownThin : mdiArrowUpThin);

  let selectedGroupOption = $derived(findSpaceGroupOptionMetadata($spaceAlbumViewSettings.groupBy));
  let isGrouped = $derived(getSelectedSpaceAlbumGroupOption($spaceAlbumViewSettings) !== SpaceAlbumGroupBy.None);

  let albumSortByNames: Record<AlbumSortBy, string> = $derived({
    [AlbumSortBy.Title]: $t('sort_title'),
    [AlbumSortBy.ItemCount]: $t('sort_items'),
    [AlbumSortBy.DateModified]: $t('sort_modified'),
    [AlbumSortBy.DateCreated]: $t('sort_created'),
    [AlbumSortBy.MostRecentPhoto]: $t('sort_recent'),
    [AlbumSortBy.OldestPhoto]: $t('sort_oldest'),
  });

  let spaceGroupByNames: Record<SpaceAlbumGroupBy, string> = $derived({
    [SpaceAlbumGroupBy.None]: $t('group_no'),
    [SpaceAlbumGroupBy.Year]: $t('group_year'),
    [SpaceAlbumGroupBy.LinkedBy]: $t('group_linked_by'),
    [SpaceAlbumGroupBy.Owner]: $t('group_owner'),
  });
</script>

<svelte:window onclick={handleClickOutside} />

<div class="flex items-center justify-between gap-2 px-4 py-2" data-testid="space-albums-view-toggle">
  <!-- Search Albums -->
  <input
    type="search"
    data-testid="space-albums-search"
    bind:value={searchQuery}
    aria-label={$t('search_albums')}
    placeholder={$t('search_albums')}
    class="h-8 w-48 rounded-lg bg-gray-100 px-3 text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-immich-primary sm:w-64 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
  />
  <div class="flex items-center gap-1">
    <!-- Sort Albums -->
    <div class="relative" data-testid="space-albums-sort-container">
      <button
        type="button"
        title={$t('sort_albums_by')}
        aria-label={$t('sort_albums_by')}
        class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
        data-testid="space-albums-sort-btn"
        onclick={() => (showSortMenu = !showSortMenu)}
      >
        <Icon icon={sortIcon} size="18" />
        <span class="hidden sm:inline">{albumSortByNames[selectedSortOption.id as AlbumSortBy]}</span>
        <Icon icon={mdiChevronDown} size="14" />
      </button>

      {#if showSortMenu}
        <div
          class="absolute top-full right-0 z-10 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          data-testid="space-albums-sort-menu"
        >
          {#each sortOptionsMetadata as option (option.id)}
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              class:font-semibold={$spaceAlbumViewSettings.sortBy === option.id}
              onclick={() => handleChangeSortBy(option)}
              data-testid="space-albums-sort-option-{option.id}"
            >
              {albumSortByNames[option.id as AlbumSortBy]}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Group Albums -->
    <div class="relative" data-testid="space-albums-group-container">
      <button
        type="button"
        title={$t('group_albums_by')}
        aria-label={$t('group_albums_by')}
        class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
        data-testid="space-albums-group-btn"
        onclick={() => (showGroupMenu = !showGroupMenu)}
      >
        <Icon icon={mdiFolderRemoveOutline} size="18" />
        <span class="hidden sm:inline">{spaceGroupByNames[selectedGroupOption.id]}</span>
        <Icon icon={mdiChevronDown} size="14" />
      </button>

      {#if showGroupMenu}
        <div
          class="absolute top-full right-0 z-10 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          data-testid="space-albums-group-menu"
        >
          {#each spaceGroupOptionsMetadata as option (option.id)}
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800"
              class:font-semibold={$spaceAlbumViewSettings.groupBy === option.id}
              disabled={option.isDisabled()}
              onclick={() => handleChangeGroupBy(option)}
              data-testid="space-albums-group-option-{option.id}"
            >
              {spaceGroupByNames[option.id]}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if isGrouped}
      <button
        type="button"
        title={$t('expand_all')}
        aria-label={$t('expand_all')}
        class="flex items-center rounded-lg p-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
        data-testid="space-albums-expand-all"
        onclick={() => expandAllSpaceAlbumGroups()}
      >
        <Icon icon={mdiUnfoldMoreHorizontal} size="18" />
      </button>
      <button
        type="button"
        title={$t('collapse_all')}
        aria-label={$t('collapse_all')}
        class="flex items-center rounded-lg p-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
        data-testid="space-albums-collapse-all"
        onclick={() => collapseAllSpaceAlbumGroups(groupIds)}
      >
        <Icon icon={mdiUnfoldLessHorizontal} size="18" />
      </button>
    {/if}

    <!-- Cover/List Display Toggle -->
    {#if $spaceAlbumViewSettings.view === AlbumViewMode.List}
      <Button
        leadingIcon={mdiViewGridOutline}
        onclick={handleToggleView}
        size="small"
        variant="ghost"
        color="secondary"
      >
        <Text class="hidden md:block">{$t('covers')}</Text>
      </Button>
    {:else}
      <Button
        leadingIcon={mdiFormatListBulletedSquare}
        onclick={handleToggleView}
        size="small"
        variant="ghost"
        color="secondary"
      >
        <Text class="hidden md:block">{$t('list')}</Text>
      </Button>
    {/if}

    {#if canManage}
      <Button size="small" leadingIcon={mdiPlus} onclick={() => onCreate?.()} data-testid="create-album-button">
        {$t('create_album')}
      </Button>
      <Button
        size="small"
        variant="ghost"
        leadingIcon={mdiLinkVariantPlus}
        onclick={() => onLink?.()}
        data-testid="link-album-button"
      >
        {$t('spaces_linked_albums_link_album')}
      </Button>
    {/if}
  </div>
</div>

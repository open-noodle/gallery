<script lang="ts">
  import type { SharedSpaceLinkedAlbumDto, SharedSpaceMemberResponseDto } from '@immich/sdk';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { AlbumViewMode } from '$lib/stores/preferences.store';
  import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
  import {
    buildSpaceAlbumGroups,
    getSelectedSpaceAlbumGroupOption,
    isSpaceAlbumGroupCollapsed,
    toggleSpaceAlbumGroupCollapsing,
  } from '$lib/utils/space-album-grouping';
  import { sortSpaceAlbums } from '$lib/utils/space-album-sort';
  import SpaceAlbumCard from '$lib/components/spaces/space-album-card.svelte';
  import SpaceAlbumsTable from '$lib/components/spaces/space-albums-table.svelte';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { slide } from 'svelte/transition';

  interface Props {
    spaceId: string;
    albums: SharedSpaceLinkedAlbumDto[];
    canManage: boolean;
    members?: SharedSpaceMemberResponseDto[];
    groupIds?: string[];
    searchQuery?: string;
    onUnlink?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
  }

  let {
    spaceId,
    albums,
    canManage,
    members = [],
    // eslint-disable-next-line no-useless-assignment
    groupIds = $bindable([]),
    searchQuery = '',
    onUnlink,
    onToggleTimeline,
  }: Props = $props();

  const filtered = $derived.by(() => {
    const q = (searchQuery ?? '').trim().toLowerCase();
    if (!q) {
      return albums;
    }
    return albums.filter(
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

{#if filtered.length === 0}
  <p data-testid="space-albums-no-results" class="p-4 text-center text-gray-500">{$t('space_albums_no_matching')}</p>
{:else if $spaceAlbumViewSettings.view === AlbumViewMode.List}
  {#if isGrouped}
    <SpaceAlbumsTable {spaceId} albums={sorted} {canManage} {groups} grouped {onUnlink} {onToggleTimeline} />
  {:else}
    <SpaceAlbumsTable {spaceId} albums={sorted} {canManage} {onUnlink} {onToggleTimeline} />
  {/if}
{:else if isGrouped}
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
          <SpaceAlbumCard {spaceId} {album} {canManage} {onUnlink} {onToggleTimeline} />
        {/each}
      </div>
    {/if}
  {/each}
{:else}
  <div class="grid grid-auto-fill-56 gap-y-4">
    {#each sorted as album (album.id)}
      <SpaceAlbumCard {spaceId} {album} {canManage} {onUnlink} {onToggleTimeline} />
    {/each}
  </div>
{/if}

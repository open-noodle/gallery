<script lang="ts">
  import { page } from '$app/state';
  import { Route } from '$lib/route';
  import {
    isSpaceAlbumsExpanded,
    recentSpaceAlbumsExpanded,
    setSpaceAlbumsExpanded,
  } from '$lib/stores/preferences.store';
  import { pinnedSpaceIds } from '$lib/stores/space-view.store';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { splitPinnedSpaces } from '$lib/utils/space-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { getAllSpaces, getSharedSpaceAlbums } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronDown, mdiChevronRight } from '@mdi/js';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  const sortByActivity = <T extends { lastActivityAt?: string | null }>(a: T, b: T): number => {
    const aTime = a.lastActivityAt ?? '';
    const bTime = b.lastActivityAt ?? '';
    return aTime > bTime ? -1 : aTime < bTime ? 1 : 0;
  };

  let allSpaces = $state(userInteraction.recentSpaces);

  let spaces = $derived.by(() => {
    if (!allSpaces) {
      return [];
    }
    const { pinned, unpinned } = splitPinnedSpaces(allSpaces, $pinnedSpaceIds);
    return [...pinned.sort(sortByActivity), ...unpinned.sort(sortByActivity)].slice(0, 3);
  });

  const topSpaceIds = $derived(spaces.map((s) => s.id));

  // Spaces with a fetch currently in flight — guards against a duplicate `getSharedSpaceAlbums`
  // call when the mount/refresh effect below re-runs while the cache is still unset.
  const inFlightSpaceAlbumFetches = new SvelteSet<string>();

  const loadAlbums = async (spaceId: string) => {
    const cachedAlbums = userInteraction.spaceAlbums?.[spaceId];
    if (cachedAlbums || inFlightSpaceAlbumFetches.has(spaceId)) {
      return; // already fetched (possibly an empty list), or a fetch is already in flight — never refetch
    }
    inFlightSpaceAlbumFetches.add(spaceId);
    try {
      const albums = await getSharedSpaceAlbums({ id: spaceId });
      const sorted = [...albums].sort((a, b) => b.linkedAt.localeCompare(a.linkedAt));
      userInteraction.spaceAlbums = { ...userInteraction.spaceAlbums, [spaceId]: sorted };
    } catch (error) {
      handleError(error, $t('failed_to_load_albums'));
      setSpaceAlbumsExpanded(spaceId, false, topSpaceIds); // cache stays unset → retry on next expand
    } finally {
      inFlightSpaceAlbumFetches.delete(spaceId);
    }
  };

  const toggleAlbums = (spaceId: string) => {
    const nowExpanded = !isSpaceAlbumsExpanded($recentSpaceAlbumsExpanded, spaceId);
    setSpaceAlbumsExpanded(spaceId, nowExpanded, topSpaceIds);
    if (nowExpanded) {
      void loadAlbums(spaceId);
    }
  };

  // Re-fetch albums for any currently-shown space whose expansion state was persisted as `true`
  // (e.g. from a prior session) but whose in-memory album cache hasn't been populated yet — covers
  // both a fresh page load (cache always starts undefined) and an in-session cache eviction after
  // a link/unlink while the space is still marked expanded.
  $effect(() => {
    for (const space of spaces) {
      if (
        isSpaceAlbumsExpanded($recentSpaceAlbumsExpanded, space.id) &&
        userInteraction.spaceAlbums?.[space.id] === undefined
      ) {
        void loadAlbums(space.id);
      }
    }
  });

  const refreshSpaces = async () => {
    try {
      allSpaces = await getAllSpaces();
      userInteraction.recentSpaces = allSpaces;
    } catch (error) {
      handleError(error, $t('failed_to_load_spaces'));
    }
  };

  $effect(() => {
    if (!userInteraction.recentSpaces) {
      void refreshSpaces();
    }
  });
</script>

{#each spaces as space (space.id)}
  {@const spacePath = `/spaces/${space.id}`}
  {@const openAlbumPath = `${spacePath}/albums/`}
  <!-- Opening one of the albums below hands the selection down to that album's own row, so only a
       single row ever reads as selected. The space keeps it everywhere else — including its albums
       *list* page (`/albums`, no trailing id), which has no row of its own to hand it to. -->
  {@const active = page.url.pathname.startsWith(spacePath) && !page.url.pathname.startsWith(openAlbumPath)}
  {@const hasAlbums = (space.albumCount ?? 0) > 0}
  {@const cachedAlbums = userInteraction.spaceAlbums?.[space.id]}
  {@const expanded =
    isSpaceAlbumsExpanded($recentSpaceAlbumsExpanded, space.id) &&
    (cachedAlbums === undefined || cachedAlbums.length > 0)}
  <div>
    <!-- The chevron is absolutely positioned against this wrapper, so it must enclose the space row
         alone: with the expanded album rows inside it, `top-1/2` would centre the chevron on the
         whole group instead of on the space it belongs to. -->
    <div class="relative">
      {#if hasAlbums}
        <button
          type="button"
          aria-label={expanded ? $t('collapse') : $t('expand')}
          aria-expanded={expanded}
          data-testid="sidebar-space-chevron-{space.id}"
          class="absolute inset-s-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-lg p-0.5 hover:bg-subtle md:block"
          onclick={() => toggleAlbums(space.id)}
        >
          <!-- 1em matches the chevron @immich/ui's NavbarItem renders for the Spaces row above. -->
          <Icon icon={expanded ? mdiChevronDown : mdiChevronRight} size="1em" />
        </button>
      {/if}
      <a
        href={Route.viewSpace({ id: space.id })}
        title={space.name}
        aria-current={active ? 'page' : undefined}
        data-testid="sidebar-space-{space.id}"
        class="flex w-full place-items-center gap-4 rounded-e-full py-3 ps-10 transition-[padding] delay-100 duration-100 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary group-hover:sm:pe-4 md:pe-4 dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary {active
          ? 'bg-primary/10 text-immich-primary dark:text-immich-dark-primary'
          : ''}"
      >
        <div class="flex size-6 items-center justify-center">
          <!-- Always the thumbnail: the sidebar identifies a space, it doesn't report on it. New
               activity is surfaced on the Spaces page and by the in-timeline new-assets divider. -->
          <div
            class="size-6 rounded-sm bg-gray-200 bg-cover dark:bg-gray-600"
            style={space.thumbnailAssetId
              ? `background-image:url('${getAssetMediaUrl({ id: space.thumbnailAssetId })}')`
              : ''}
            data-testid="sidebar-space-thumbnail-{space.id}"
          ></div>
        </div>
        <div class="grow truncate text-sm font-medium">
          {space.name}
        </div>
      </a>
    </div>
    {#if expanded}
      {#each (cachedAlbums ?? []).slice(0, 3) as album (album.id)}
        {@const albumActive = page.url.pathname.startsWith(`${openAlbumPath}${album.id}`)}
        <a
          href={Route.viewSpaceAlbum({ spaceId: space.id, albumId: album.id })}
          title={album.albumName}
          aria-current={albumActive ? 'page' : undefined}
          data-testid="sidebar-space-album-{album.id}"
          class="flex w-full place-items-center gap-4 rounded-e-full py-2 ps-14 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary {albumActive
            ? 'bg-primary/10 text-immich-primary dark:text-immich-dark-primary'
            : ''}"
        >
          <div
            class="size-6 rounded-sm bg-gray-200 bg-cover dark:bg-gray-600"
            style={album.albumThumbnailAssetId
              ? `background-image:url('${getAssetMediaUrl({ id: album.albumThumbnailAssetId })}')`
              : ''}
          ></div>
          <div class="grow truncate text-sm font-medium">{album.albumName}</div>
        </a>
      {/each}
      {#if (cachedAlbums?.length ?? 0) > 3}
        <a
          href={Route.viewSpaceAlbums({ id: space.id })}
          data-testid="sidebar-space-see-all-{space.id}"
          class="flex w-full place-items-center rounded-e-full py-2 ps-14 text-sm font-medium text-immich-primary hover:bg-subtle dark:text-immich-dark-primary"
        >
          {$t('sidebar_space_see_all_albums', { values: { count: cachedAlbums?.length ?? 0 } })}
        </a>
      {/if}
    {/if}
  </div>
{/each}

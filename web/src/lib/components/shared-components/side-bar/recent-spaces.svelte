<script lang="ts">
  import { page } from '$app/state';
  import { Route } from '$lib/route';
  import {
    isSpaceAlbumsExpanded,
    recentSpaceAlbumsExpanded,
    setSpaceAlbumsExpanded,
  } from '$lib/stores/preferences.store';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import { pinnedSpaceIds } from '$lib/stores/space-view.store';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { splitPinnedSpaces } from '$lib/utils/space-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { getAllSpaces, getSharedSpaceAlbums } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronDown, mdiChevronRight, mdiDotsHorizontal } from '@mdi/js';
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

  // These rows stay rendered in the rail so it keeps the sidebar's vertical rhythm; collapsed
  // they show only their thumbnail, centred, the way Google Photos' rail does.
  const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.railExpanded);
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
      <!-- No chevron in the rail: it is unreadable beside a 24px thumbnail at 5rem, and the
           sub-tree it toggles is already showing. Expansion is driven from the expanded
           sidebar and persists, exactly as the parent nav item's own chevron does.
           `inset-s-8` indents it past the Spaces row's own chevron at `inset-s-3`: stacked at
           the same inset the parent caret sat directly above its children's, reading as one
           column rather than a hierarchy. The 20px step mirrors the rows' own indent. -->
      {#if hasAlbums && !collapsed}
        <button
          type="button"
          aria-label={expanded ? $t('collapse') : $t('expand')}
          aria-expanded={expanded}
          data-testid="sidebar-space-chevron-{space.id}"
          class="absolute inset-s-8 top-1/2 z-10 hidden -translate-y-1/2 rounded-lg p-0.5 hover:bg-subtle md:block"
          onclick={() => toggleAlbums(space.id)}
        >
          <!-- 1.25em matches the chevron the Spaces row above renders: 1em read too faint next to
               a 1.375em nav icon and a 1.5em thumbnail. -->
          <Icon icon={expanded ? mdiChevronDown : mdiChevronRight} size="1.25em" />
        </button>
      {/if}
      <!-- Expanded, the pill carries the sidebar's shared 0.75rem inset on both ends rather than
           `w-full`, and its `ps-*` is 0.75rem short of the thumbnail's distance from the sidebar
           edge to compensate - the same pairing SidebarNavItem uses, so the two indent scales stay
           in step. -->
      <a
        href={Route.viewSpace({ id: space.id })}
        title={space.name}
        aria-current={active ? 'page' : undefined}
        data-testid="sidebar-space-{space.id}"
        class="flex place-items-center gap-4 rounded-e-full py-3 transition-[padding,margin,width] delay-100 duration-100 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary {collapsed
          ? 'ms-4 w-12 ps-3'
          : 'mx-3 w-[calc(100%-1.5rem)] ps-12 group-hover:sm:pe-4 md:pe-4'} {active
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
        <!-- Kept mounted and collapsed to zero width rather than unmounted, so rail <-> expanded
             stays a CSS transition. `grow` has to go with it or the name would still claim width. -->
        <div
          class="truncate text-sm font-medium"
          class:grow={!collapsed}
          class:w-0={collapsed}
          class:opacity-0={collapsed}
        >
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
          class="flex place-items-center gap-4 rounded-e-full py-2 transition-[padding,margin,width] delay-100 duration-100 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary {collapsed
            ? 'ms-4 w-12 ps-3'
            : 'mx-3 w-[calc(100%-1.5rem)] ps-16'} {albumActive
            ? 'bg-primary/10 text-immich-primary dark:text-immich-dark-primary'
            : ''}"
        >
          <div
            class="size-6 shrink-0 rounded-sm bg-gray-200 bg-cover dark:bg-gray-600"
            style={album.albumThumbnailAssetId
              ? `background-image:url('${getAssetMediaUrl({ id: album.albumThumbnailAssetId })}')`
              : ''}
          ></div>
          <div
            class="truncate text-sm font-medium"
            class:grow={!collapsed}
            class:w-0={collapsed}
            class:opacity-0={collapsed}
          >
            {album.albumName}
          </div>
        </a>
      {/each}
      {#if (cachedAlbums?.length ?? 0) > 3}
        <!-- Collapsed this row keeps its box and its link, showing an ellipsis instead of the
             sentence - dropping it would put the rail a row short of the sidebar again, which is
             the drift these thumbnails exist to remove. The label carries the accessible name. -->
        <a
          href={Route.viewSpaceAlbums({ id: space.id })}
          title={collapsed
            ? $t('sidebar_space_see_all_albums', { values: { count: cachedAlbums?.length ?? 0 } })
            : undefined}
          data-testid="sidebar-space-see-all-{space.id}"
          class="flex place-items-center rounded-e-full py-2 text-sm font-medium text-immich-primary transition-[padding,margin,width] delay-100 duration-100 hover:bg-subtle dark:text-immich-dark-primary {collapsed
            ? 'ms-4 w-12 ps-3.5'
            : 'mx-3 w-[calc(100%-1.5rem)] ps-16'}"
        >
          {#if collapsed}
            <Icon icon={mdiDotsHorizontal} size="1.25em" aria-hidden={true} />
          {/if}
          <span class="truncate" class:w-0={collapsed} class:opacity-0={collapsed}>
            {$t('sidebar_space_see_all_albums', { values: { count: cachedAlbums?.length ?? 0 } })}
          </span>
        </a>
      {/if}
    {/if}
  </div>
{/each}

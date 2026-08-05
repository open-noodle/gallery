<script lang="ts">
  import { Route } from '$lib/route';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { getAllAlbums } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  let albums = $state(userInteraction.recentAlbums);

  const refreshAlbums = async () => {
    try {
      const allAlbums = await getAllAlbums({});
      albums = allAlbums.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3);
      userInteraction.recentAlbums = albums;
    } catch (error) {
      handleError(error, $t('failed_to_load_assets'));
    }
  };

  $effect(() => {
    if (!userInteraction.recentAlbums) {
      void refreshAlbums();
    }
  });

  // These rows stay rendered in the rail so it keeps the sidebar's vertical rhythm; collapsed
  // they show only their thumbnail, centred, the way Google Photos' rail does.
  const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.railExpanded);
</script>

{#each albums as album (album.id)}
  <a
    href={Route.viewAlbum(album)}
    title={album.albumName}
    class="flex place-items-center gap-4 rounded-e-full py-3 transition-[padding,margin,width] delay-100 duration-100 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary {collapsed
      ? 'ms-4 w-12 ps-3'
      : 'mx-3 w-[calc(100%-1.5rem)] justify-between ps-12 group-hover:sm:pe-4 md:pe-4'}"
  >
    <div class="shrink-0">
      <div
        class="size-6 rounded-sm bg-gray-200 bg-cover dark:bg-gray-600"
        style={album.albumThumbnailAssetId
          ? `background-image:url('${getAssetMediaUrl({ id: album.albumThumbnailAssetId })}')`
          : ''}
      ></div>
    </div>
    <!-- Kept mounted and collapsed to zero width rather than unmounted, so rail <-> expanded
         stays a CSS transition. `grow` has to go with it or the name would still claim width. -->
    <div class="truncate text-sm font-medium" class:grow={!collapsed} class:w-0={collapsed} class:opacity-0={collapsed}>
      {album.albumName}
    </div>
  </a>
{/each}

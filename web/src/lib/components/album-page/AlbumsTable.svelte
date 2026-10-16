<script lang="ts">
  import AlbumTableHeader from '#lib/components/album-page/AlbumsTableHeader.svelte';
  import LazyAlbumTableBody from '#lib/gallery/components/lazy-album-table-body.svelte';
  import { AlbumGroupBy, albumViewSettings } from '#lib/stores/preferences.store.ts';
  import {
    isAlbumGroupCollapsed,
    sortOptionsMetadata,
    toggleAlbumGroupCollapsing,
    type AlbumGroup,
  } from '#lib/utils/album-utils.ts';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    groupedAlbums: AlbumGroup[];
    albumGroupOption?: string;
  };

  const { groupedAlbums, albumGroupOption = AlbumGroupBy.None }: Props = $props();
</script>

<table class="mt-2 w-full text-start">
  <thead
    class="mb-4 flex h-12 w-full rounded-md border bg-gray-50 text-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
  >
    <tr class="flex w-full place-items-center p-2 md:p-5">
      {#each sortOptionsMetadata as option, index (index)}
        <AlbumTableHeader {option} />
      {/each}
    </tr>
  </thead>
  {#if albumGroupOption === AlbumGroupBy.None}
    <LazyAlbumTableBody albums={groupedAlbums[0].albums} />
  {:else}
    {#each groupedAlbums as albumGroup (albumGroup.id)}
      {const isCollapsed = $derived(isAlbumGroupCollapsed($albumViewSettings, albumGroup.id))}
      {const iconRotation = $derived(isCollapsed ? 'rotate-0' : 'rotate-90')}
      <tbody
        class="mt-4 block w-full overflow-y-auto rounded-md border dark:border-immich-dark-gray dark:text-immich-dark-fg"
      >
        <tr
          class="flex w-full place-items-center p-2 md:py-3 md:ps-5 md:pe-5"
          onclick={() => toggleAlbumGroupCollapsing(albumGroup.id)}
          aria-expanded={!isCollapsed}
        >
          <td class="text-md -mb-1 text-start">
            <Icon
              icon={mdiChevronRight}
              size="20"
              class="-mt-2 inline-block transition-all duration-250 {iconRotation}"
            />
            <span class="text-2xl font-bold">{albumGroup.name}</span>
            <span class="ms-1.5">
              ({$t('albums_count', { values: { count: albumGroup.albums.length } })})
            </span>
          </td>
        </tr>
      </tbody>
      {#if !isCollapsed}
        <LazyAlbumTableBody albums={albumGroup.albums} class="[&:not([data-chunk]+*)]:mt-4" />
      {/if}
    {/each}
  {/if}
</table>

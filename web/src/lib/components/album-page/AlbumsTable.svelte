<script lang="ts">
  import AlbumTableHeader from '$lib/components/album-page/AlbumsTableHeader.svelte';
  import AlbumTableRow from '$lib/components/album-page/AlbumsTableRow.svelte';
  import LazyChunks from '$lib/components/shared-components/lazy-chunks.svelte';
  import { AlbumGroupBy, albumViewSettings } from '$lib/stores/preferences.store';
  import {
    isAlbumGroupCollapsed,
    sortOptionsMetadata,
    toggleAlbumGroupCollapsing,
    type AlbumGroup,
  } from '$lib/utils/album-utils';
  import type { AlbumResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    groupedAlbums: AlbumGroup[];
    albumGroupOption?: string;
  };

  const { groupedAlbums, albumGroupOption = AlbumGroupBy.None }: Props = $props();
</script>

<!-- Rows mount in chunks near the viewport (LazyChunks), one <tbody> per chunk. A run of chunks
     still reads as one bordered box: every chunk draws the side borders, and only the first and
     last chunk of the run add the top/bottom edge and rounded corners. -->
{#snippet albumRows(rowAlbums: AlbumResponseDto[], extraClass = '')}
  <LazyChunks
    items={rowAlbums}
    chunkSize={50}
    estimateHeight={(count) => count * 48}
    tag="tbody"
    class="block w-full border-x dark:border-immich-dark-gray dark:text-immich-dark-fg [&:not(:has(+[data-chunk]))]:rounded-b-md [&:not(:has(+[data-chunk]))]:border-b [&:not([data-chunk]+*)]:rounded-t-md [&:not([data-chunk]+*)]:border-t {extraClass}"
  >
    {#snippet chunk(chunkAlbums)}
      {#each chunkAlbums as album (album.id)}
        <AlbumTableRow {album} />
      {/each}
    {/snippet}
  </LazyChunks>
{/snippet}

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
    {@render albumRows(groupedAlbums[0].albums)}
  {:else}
    {#each groupedAlbums as albumGroup (albumGroup.id)}
      {@const isCollapsed = isAlbumGroupCollapsed($albumViewSettings, albumGroup.id)}
      {@const iconRotation = isCollapsed ? 'rotate-0' : 'rotate-90'}
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
        {@render albumRows(albumGroup.albums, '[&:not([data-chunk]+*)]:mt-4')}
      {/if}
    {/each}
  {/if}
</table>

<script lang="ts">
  import AlbumTableRow from '$lib/components/album-page/AlbumsTableRow.svelte';
  import LazyChunks from '$lib/gallery/components/lazy-chunks.svelte';
  import type { AlbumResponseDto } from '@immich/sdk';

  interface Props {
    albums: AlbumResponseDto[];
    class?: string;
  }

  let { albums, class: extraClass = '' }: Props = $props();
</script>

<!-- The personal albums table body, mounted in chunks near the viewport (LazyChunks), one <tbody> per
     chunk. A run of chunks still reads as one bordered box: every chunk draws the side borders, and only
     the first and last chunk of the run add the top/bottom edge and rounded corners. -->
<LazyChunks
  items={albums}
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

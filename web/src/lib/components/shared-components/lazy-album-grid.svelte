<script lang="ts" generics="T">
  import LazyChunks from '$lib/components/shared-components/lazy-chunks.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    items: T[];
    chunk: Snippet<[T[]]>;
  }

  let { items, chunk }: Props = $props();

  // An album-card grid (grid-auto-fill-56: 14rem tracks, no column gap) mounted in chunks of whole
  // rows, so a chunk never ends in a half-filled row.
  const remPx =
    typeof document === 'undefined'
      ? 16
      : Number(getComputedStyle(document.documentElement).fontSize.replace('px', '')) || 16;
  let width = $state(0);
  // bind:clientWidth reports asynchronously; read the width on mount too so the first chunks are
  // cut for the real column count rather than for one column.
  const measure = (element: HTMLElement) => {
    width = element.clientWidth;
  };
  const columns = $derived(Math.max(1, Math.floor(width / (14 * remPx))));
  // A card is its square cover plus ~6rem of padding, title and details.
  const estimateHeight = (count: number) => Math.ceil(count / columns) * (width / columns + 6 * remPx);
</script>

<div class="flex flex-col gap-y-4" use:measure bind:clientWidth={width}>
  <LazyChunks {items} chunkSize={columns * 8} {estimateHeight} {chunk} class="grid grid-auto-fill-56 gap-y-4" />
</div>

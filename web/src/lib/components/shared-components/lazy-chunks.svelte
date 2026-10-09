<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  interface Props {
    items: T[];
    chunkSize: number;
    /** Placeholder height (px) for a chunk that has never been on screen. */
    estimateHeight: (count: number) => number;
    chunk: Snippet<[T[]]>;
    /** Wrapper element per chunk, e.g. `tbody` inside a table. */
    tag?: string;
    class?: string;
  }

  let { items, chunkSize, estimateHeight, chunk, tag = 'div', class: className }: Props = $props();

  // Mounting thousands of items at once blocks the main thread for seconds. Only chunks within a
  // viewport of the screen are mounted; the rest are empty blocks holding their last measured (or
  // estimated) height, so the scrollbar and scroll position behave as if everything were there.
  const chunks = $derived(
    Array.from({ length: Math.ceil(items.length / chunkSize) }, (_, i) =>
      items.slice(i * chunkSize, (i + 1) * chunkSize),
    ),
  );

  const hasObserver = typeof IntersectionObserver !== 'undefined';
  const visible = new SvelteMap<number, boolean>();
  const heights = new SvelteMap<number, number>();

  $effect(() => {
    // Measured heights belong to a chunk layout; a new chunk size means new chunks.
    void chunkSize;
    heights.clear();
  });

  const observer = hasObserver
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            visible.set(Number((entry.target as HTMLElement).dataset.chunk), entry.isIntersecting);
          }
        },
        { rootMargin: '100% 0px' },
      )
    : undefined;

  $effect(() => () => observer?.disconnect());

  // A chunk decides on mount whether it starts near the screen (same margin as the observer), so the
  // first frame is already filled in and a page of many small groups (albums grouped by year) only
  // mounts the groups on screen. The observer takes over from there as the page scrolls.
  const observe = (element: HTMLElement, index: number) => {
    const { top, bottom } = element.getBoundingClientRect();
    if (bottom >= -innerHeight && top <= 2 * innerHeight) {
      visible.set(index, true);
    }
    observer?.observe(element);
    return { destroy: () => observer?.unobserve(element) };
  };
</script>

{#each chunks as chunkItems, index (index)}
  {@const shown = !hasObserver || visible.get(index)}
  <svelte:element
    this={tag}
    use:observe={index}
    data-chunk={index}
    class={className}
    style:height={shown ? undefined : `${heights.get(index) ?? estimateHeight(chunkItems.length)}px`}
    bind:clientHeight={
      () => heights.get(index) ?? 0,
      (height) => {
        if (shown && height > 0) {
          heights.set(index, height);
        }
      }
    }
  >
    {#if shown}
      {@render chunk(chunkItems)}
    {/if}
  </svelte:element>
{/each}

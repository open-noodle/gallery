<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';

  // Sentinel-only infinite scroll: renders a watched spacer at the foot of a list and calls onLoadMore when it
  // scrolls into view (or is already visible), so paginated surfaces can drop their "Load more" button. It owns
  // NO grid — the caller keeps its own markup/keying and just drops this where the button used to sit. The
  // observe-plus-rAF-fallback shape mirrors people-grid.svelte (the app's existing infinite-scroll grid), which
  // can't be reused directly where items aren't keyed by `id`. The rAF fallback re-fires while the sentinel
  // stays on-screen after a short page, so a list that doesn't fill the viewport keeps loading until it does.

  interface Props {
    /** Whether another page is available to load. When false the sentinel is not rendered and the observer is torn down. */
    hasMore?: boolean;
    /** True while a page is in flight — suppresses re-triggering and shows the loading label. */
    loading?: boolean;
    /** Invoked when the sentinel enters the viewport (or is already visible) and another page is available. */
    onLoadMore: () => void;
    /**
     * Count of items currently loaded. Drives the post-append visibility re-check: after the list grows, if the
     * sentinel is still on-screen (a page that didn't fill the viewport), load the next one too.
     */
    itemCount?: number;
    /** Overrides the sentinel's own layout/spacing so callers can match their surrounding container. */
    class?: string;
  }

  let { hasMore = false, loading = false, onLoadMore, itemCount = 0, class: className }: Props = $props();

  let sentinel: HTMLElement | undefined = $state();
  let intersectionObserver: IntersectionObserver | undefined;
  let cancelVisibilityCheck: (() => void) | undefined;
  let lastVisibilityCheckItemCount: number | undefined;
  let lastVisibilityCheckSentinel: HTMLElement | undefined;

  const cancelScheduledVisibilityCheck = () => {
    cancelVisibilityCheck?.();
    cancelVisibilityCheck = undefined;
  };

  const requestNextPage = () => {
    cancelScheduledVisibilityCheck();
    onLoadMore();
  };

  $effect(() => {
    if (!hasMore || !sentinel || typeof IntersectionObserver === 'undefined') {
      intersectionObserver?.disconnect();
      intersectionObserver = undefined;
      return;
    }

    const observedSentinel = sentinel;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.find((entry) => entry.target === observedSentinel);
      if (entry?.isIntersecting && hasMore && !loading) {
        requestNextPage();
      }
    });

    intersectionObserver?.disconnect();
    intersectionObserver = observer;
    observer.observe(observedSentinel);

    return () => {
      observer.disconnect();
      if (intersectionObserver === observer) {
        intersectionObserver = undefined;
      }
    };
  });

  onDestroy(() => {
    intersectionObserver?.disconnect();
    cancelScheduledVisibilityCheck();
  });

  $effect(() => {
    const count = itemCount;
    const observedSentinel = sentinel;

    if (!hasMore || !observedSentinel) {
      cancelScheduledVisibilityCheck();
      lastVisibilityCheckItemCount = undefined;
      lastVisibilityCheckSentinel = undefined;
      return;
    }

    // Only re-arm when the loaded count or the sentinel element actually changed — otherwise an unrelated
    // reactive tick would reschedule (and re-fire) the check every render.
    if (lastVisibilityCheckItemCount === count && lastVisibilityCheckSentinel === observedSentinel) {
      return;
    }

    cancelScheduledVisibilityCheck();
    lastVisibilityCheckItemCount = count;
    lastVisibilityCheckSentinel = observedSentinel;

    if (loading) {
      return;
    }

    const checkSentinelVisibility = () => {
      cancelVisibilityCheck = undefined;
      if (!hasMore || loading || !observedSentinel) {
        return;
      }
      const rect = observedSentinel.getBoundingClientRect();
      if (rect.top < innerHeight) {
        requestNextPage();
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      const frame = requestAnimationFrame(checkSentinelVisibility);
      cancelVisibilityCheck = () => cancelAnimationFrame(frame);
    } else {
      const timeout = setTimeout(checkSentinelVisibility, 0);
      cancelVisibilityCheck = () => clearTimeout(timeout);
    }
  });
</script>

{#if hasMore}
  <div bind:this={sentinel} class={className ?? 'flex h-10 w-full items-center justify-center'}>
    {#if loading}
      <span class="text-sm text-gray-500 dark:text-gray-400" aria-live="polite">{$t('loading')}</span>
    {/if}
  </div>
{/if}

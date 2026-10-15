<script lang="ts">
  import type { CleanupQueuePager } from '$lib/managers/cleanup-queue-pager.svelte';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    pager: CleanupQueuePager;
    /** True when nothing is left on screen (items or groups, depending on the queue). */
    empty: boolean;
    onLoadMore: () => void;
  };

  let { pager, empty, onLoadMore }: Props = $props();

  let visible = $state(false);

  // Keeps loading while the sentinel stays in view, one page at a time. A failed page stops the
  // loop until the user retries.
  $effect(() => {
    if (visible && !pager.loading && !pager.done && !pager.failed) {
      onLoadMore();
    }
  });

  const observe = (node: HTMLElement) => {
    const observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { rootMargin: '600px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  };
</script>

{#if pager.failed}
  <div class="grid place-items-center py-6">
    <Button size="small" variant="outline" color="secondary" shape="round" onclick={onLoadMore}>
      {$t('load_more')}
    </Button>
  </div>
{:else if !pager.done}
  <div use:observe class="grid place-items-center py-6" data-testid="cleanup-queue-sentinel">
    <span class="h-3 w-40 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></span>
  </div>
{:else if empty}
  <p class="py-16 text-center text-muted" data-testid="cleanup-queue-empty">{$t('cleanup_queue_empty')}</p>
{/if}

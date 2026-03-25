<script lang="ts">
  import { Route } from '$lib/route';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import type { AssetResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    results: AssetResponseDto[];
    spaceId: string;
    isLoading: boolean;
    hasMore: boolean;
    totalLoaded: number;
    onLoadMore: () => void;
  }

  let { results, spaceId, isLoading, hasMore, totalLoaded, onLoadMore }: Props = $props();
</script>

<section class="px-4 py-4">
  {#if isLoading && results.length === 0}
    <div class="flex justify-center py-8" data-testid="search-loading">
      <LoadingSpinner />
    </div>
  {:else if results.length === 0}
    <p class="mt-8 text-center text-gray-500 dark:text-gray-400" data-testid="search-empty">
      {$t('search_no_result')}
    </p>
  {:else}
    <div class="mb-4 flex items-center gap-2">
      <span class="text-sm text-gray-500 dark:text-gray-400" data-testid="result-count">
        {totalLoaded}{hasMore ? '+' : ''} result{totalLoaded === 1 && !hasMore ? '' : 's'}
      </span>
      {#if isLoading}
        <LoadingSpinner size="small" />
      {/if}
    </div>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
      {#each results as asset (asset.id)}
        <a
          href="{Route.viewSpace({ id: spaceId })}/photos/{asset.id}"
          class="aspect-square cursor-pointer overflow-hidden rounded"
        >
          <img src="/api/assets/{asset.id}/thumbnail" alt={asset.originalFileName} class="h-full w-full object-cover" />
        </a>
      {/each}
    </div>
    {#if hasMore}
      <div class="mt-4 flex justify-center">
        <button
          type="button"
          data-testid="load-more-btn"
          disabled={isLoading}
          onclick={onLoadMore}
          class="rounded-lg bg-immich-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-immich-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {$t('spaces_load_more')}
        </button>
      </div>
    {/if}
  {/if}
</section>

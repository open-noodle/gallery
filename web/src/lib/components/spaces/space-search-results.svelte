<script lang="ts">
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { page } from '$app/state';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import Portal from '$lib/elements/Portal.svelte';
  import type { AssetCursor } from '$lib/components/asset-viewer/AssetViewer.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import type { Viewport } from '$lib/managers/timeline-manager/types';
  import { handlePromiseError } from '$lib/utils';
  import { navigate } from '$lib/utils/navigation';
  import { type AssetResponseDto, getAssetInfo } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    results: AssetResponseDto[];
    isLoading: boolean;
    hasMore: boolean;
    totalLoaded: number;
    onLoadMore: () => void;
    spaceId?: string;
    /** Shared-space surface + the caller's write capability on it — see `Timeline` (#889). */
    space?: { id: string; canWrite: boolean };
    isShared: boolean;
    sortMode: 'relevance' | 'asc' | 'desc';
    total?: number;
    /** Re-runs the current search — used to restore results after an undone delete. */
    onReload?: () => void;
    /**
     * Reports the scroll offset of the results grid. This section is the only scrolling element on
     * the surface, so a host that shrinks its chrome as the reader scrolls — the space shell
     * collapsing its cover — has no other way to hear about it (#1028). Mirrors `Timeline`'s prop.
     */
    onScroll?: (scrollTop: number) => void;
  }

  let {
    results = $bindable(),
    isLoading,
    hasMore,
    totalLoaded,
    onLoadMore,
    spaceId,
    space,
    isShared,
    sortMode,
    total,
    onReload,
    onScroll,
  }: Props = $props();

  let isViewerOpen = $state(false);
  let sentinelElement: HTMLElement | undefined = $state();
  let scrollContainer: HTMLElement | undefined = $state();
  let observer: IntersectionObserver | undefined;
  const viewport: Viewport = $state({ width: 0, height: 0 });

  $effect(() => {
    if (!(sentinelElement && scrollContainer)) {
      return;
    }

    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoading) {
          onLoadMore();
        }
      },
      { root: scrollContainer },
    );
    observer.observe(sentinelElement);
    return () => observer?.disconnect();
  });

  const getFullAsset = (id: string): Promise<AssetResponseDto> => {
    return getAssetInfo({ ...authManager.params, id, ...(spaceId && { spaceId }) });
  };

  let cursor = $state<AssetCursor | undefined>();

  const buildCursor = async (assetId: string) => {
    const idx = results.findIndex((a) => a.id === assetId);
    if (idx === -1) {
      return;
    }
    const [current, prev, next] = await Promise.all([
      getFullAsset(assetId),
      idx > 0 ? getFullAsset(results[idx - 1].id) : Promise.resolve(undefined),
      idx < results.length - 1 ? getFullAsset(results[idx + 1].id) : Promise.resolve(undefined),
    ]);
    cursor = { current, previousAsset: prev, nextAsset: next };
  };

  const openAsset = async (asset: AssetResponseDto) => {
    isViewerOpen = true;
    await buildCursor(asset.id);
  };

  // React to URL changes from AssetViewer's next/prev navigation
  $effect(() => {
    const assetId = page.params?.assetId;
    if (isViewerOpen && assetId) {
      handlePromiseError(buildCursor(assetId));
    }
  });

  const handleClose = async () => {
    isViewerOpen = false;
    cursor = undefined;
    await navigate({ targetRoute: 'current', assetId: null });
  };

  const resultCount = $derived(total ?? totalLoaded);
  const hasExactTotal = $derived(total !== undefined);

  // Mounting the viewer through `{#await}` leaves it permanently unreactive on reopen.
  // See lazyComponent().
  const LazyAssetViewer = lazyComponent(() => import('$lib/components/asset-viewer/AssetViewer.svelte'));
</script>

<!-- `viewport.height` is the *visible* height of the scroll container (what GalleryViewer
     virtualizes against), while `viewport.width` is measured on the inner content div so it
     excludes this section's padding. -->
<section
  bind:this={scrollContainer}
  bind:clientHeight={viewport.height}
  class="flex-1 immich-scrollbar overflow-y-auto p-4"
  data-testid="search-results-scroller"
  onscroll={() => onScroll?.(scrollContainer?.scrollTop ?? 0)}
>
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
        {#if hasExactTotal}
          {$t('spaces_search_result_count', { values: { count: resultCount } })}
        {:else if sortMode === 'relevance'}
          {#if hasMore}
            {$t('spaces_search_result_count_more', { values: { count: totalLoaded } })}
          {:else}
            {$t('spaces_search_result_count', { values: { count: totalLoaded } })}
          {/if}
        {:else if hasMore}
          {$t('spaces_search_result_count_capped', { values: { count: totalLoaded, total: 500 } })}
        {:else}
          {$t('spaces_search_result_count', { values: { count: totalLoaded } })}
        {/if}
      </span>
      {#if isLoading}
        <LoadingSpinner size="small" />
      {/if}
    </div>

    <!-- Justified (aspect-ratio preserving) layout with hover selection, matching the
         timeline and the legacy /search page. See discussion #908. -->
    <div bind:clientWidth={viewport.width}>
      <GalleryViewer
        bind:assets={results}
        assetInteraction={assetMultiSelectManager}
        scrollElement={scrollContainer}
        onAssetOpen={(asset) => handlePromiseError(openAsset(asset))}
        withAssetViewer={false}
        showArchiveIcon={true}
        {viewport}
        {onReload}
      />
    </div>

    {#if hasMore}
      <div bind:this={sentinelElement} data-testid="scroll-sentinel" class="flex justify-center py-4">
        {#if isLoading}
          <LoadingSpinner size="small" />
        {/if}
      </div>
    {/if}
  {/if}
</section>

<Portal target="body">
  {#if isViewerOpen && cursor}
    {#if LazyAssetViewer.current}
      {@const AssetViewer = LazyAssetViewer.current}
      <AssetViewer {cursor} {isShared} {spaceId} {space} onClose={() => handlePromiseError(handleClose())} />
    {/if}
  {/if}
</Portal>

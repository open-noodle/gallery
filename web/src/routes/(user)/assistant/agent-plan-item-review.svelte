<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { t, type Translations } from 'svelte-i18n';
  import {
    buildAgentPlanItemVirtualWindow,
    buildAgentPlanReviewAssets,
    filterAgentPlanReviewAssets,
    getAgentPlanAvailableFilterFacets,
    type AgentPlanItemFilterState,
    type AgentPlanReviewAssetMetadata,
  } from './agent-plan-large-item-review-ui';
  import { isAssetSelectedForOperation, type OperationReviewItem } from './agent-operation-plan-ui';

  const DEFAULT_VIEWPORT_HEIGHT = 420;
  const DEFAULT_ITEM_SIZE = 104;
  const MODAL_ITEM_SIZE = 168;
  const DEFAULT_COLUMN_COUNT = 6;
  const GRID_GAP = 8;
  const DEFAULT_OVERSCAN_ROWS = 2;
  const mediaKindOptions: { kind: AgentPlanItemFilterState['kind']; labelKey: Translations }[] = [
    { kind: 'all', labelKey: 'assistant_operation_item_media_all' as Translations },
    { kind: 'image', labelKey: 'assistant_operation_item_media_photos' as Translations },
    { kind: 'video', labelKey: 'assistant_operation_item_media_videos' as Translations },
  ];

  interface Props {
    item: OperationReviewItem;
    canChangeSelection: boolean;
    onToggleItem: (operationId: string, assetId: string, selected: boolean) => void;
    onBulkSetItems: (operationId: string, assetIds: string[], selected: boolean) => void;
    onSetOnlyItems: (operationId: string, assetIds: string[]) => void;
    onResetSelection: (operationId: string) => void;
    metadataByAssetId?: Record<string, AgentPlanReviewAssetMetadata>;
    viewportHeight?: number;
    itemSize?: number;
    columnCount?: number;
    overscanRows?: number;
    variant?: 'inline' | 'modal';
  }

  let {
    item,
    canChangeSelection,
    onToggleItem,
    onBulkSetItems = () => undefined,
    onSetOnlyItems = () => undefined,
    onResetSelection,
    metadataByAssetId = {},
    viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
    itemSize,
    columnCount,
    overscanRows = DEFAULT_OVERSCAN_ROWS,
    variant = 'inline',
  }: Props = $props();

  let failedAssetIds = $state(new Set<string>());
  let filter = $state<AgentPlanItemFilterState>({ query: '', kind: 'all' });
  let scrollTop = $state(0);
  let measuredGridWidth = $state(0);
  let scrollElement: HTMLDivElement | undefined = $state();

  const reviewAssets = $derived(buildAgentPlanReviewAssets(item.operation.assetIds, metadataByAssetId));
  const reviewAssetById = $derived(new Map(reviewAssets.map((asset) => [asset.id, asset])));
  const filteredAssets = $derived(filterAgentPlanReviewAssets(reviewAssets, filter));
  const filteredAssetIds = $derived(filteredAssets.map((asset) => asset.id));
  const facets = $derived(getAgentPlanAvailableFilterFacets(reviewAssets));
  const videoAssetIds = $derived(reviewAssets.filter((asset) => asset.kind === 'video').map((asset) => asset.id));
  const hasSelectionOverride = $derived(item.review.selection.mode !== 'all');
  const effectiveItemSize = $derived(itemSize ?? (variant === 'modal' ? MODAL_ITEM_SIZE : DEFAULT_ITEM_SIZE));
  const configuredColumnCount = $derived(columnCount === undefined ? undefined : Math.max(1, Math.floor(columnCount)));
  const measuredColumnCount = $derived(
    measuredGridWidth > 0
      ? Math.max(1, Math.floor((measuredGridWidth + GRID_GAP) / (effectiveItemSize + GRID_GAP)))
      : DEFAULT_COLUMN_COUNT,
  );
  const virtualColumnCount = $derived(configuredColumnCount ?? measuredColumnCount);
  const virtualWindow = $derived(
    buildAgentPlanItemVirtualWindow({
      assetIds: filteredAssetIds,
      scrollTop,
      viewportHeight,
      itemSize: effectiveItemSize,
      columnCount: virtualColumnCount,
      overscanRows,
    }),
  );
  const gridContentWidth = $derived(
    virtualColumnCount * effectiveItemSize + Math.max(0, virtualColumnCount - 1) * GRID_GAP,
  );

  const resetGridScroll = () => {
    scrollTop = 0;
    if (scrollElement) {
      scrollElement.scrollTop = 0;
    }
  };

  const setFilter = (nextFilter: AgentPlanItemFilterState) => {
    filter = nextFilter;
    resetGridScroll();
  };

  const setQuery = (query: string) => setFilter({ ...filter, query });
  const setKind = (kind: AgentPlanItemFilterState['kind']) => setFilter({ ...filter, kind });

  const measureGrid = (node: HTMLDivElement) => {
    const setMeasuredWidth = (width: number) => {
      measuredGridWidth = Math.max(0, Math.floor(width));
    };

    setMeasuredWidth(node.clientWidth);

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setMeasuredWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);

    return {
      destroy: () => observer.disconnect(),
    };
  };

  const toggleQuickFilter = (quickFilter: NonNullable<AgentPlanItemFilterState['quickFilter']>) =>
    setFilter({ ...filter, quickFilter: filter.quickFilter === quickFilter ? undefined : quickFilter });

  const markFailed = (assetId: string) => {
    if (failedAssetIds.has(assetId)) {
      return;
    }

    failedAssetIds = new Set([...failedAssetIds, assetId]);
  };

  const getAssetAlt = (assetId: string) => {
    const asset = reviewAssetById.get(assetId);
    return asset?.filename ?? asset?.label ?? assetId;
  };

  const sectionClass = $derived(
    variant === 'modal'
      ? 'rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950'
      : 'mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40',
  );
  const gridClass = $derived(
    variant === 'modal'
      ? 'max-h-[min(76vh,42rem)] overflow-y-auto rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900'
      : 'max-h-[min(65vh,28rem)] overflow-y-auto rounded-md border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800',
  );
</script>

{#if item.review.selection.supportsItemSelection}
  <section
    class={sectionClass}
    role="group"
    aria-label={$t('assistant_operation_item_review_label', { values: { summary: item.review.summary } })}
  >
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-300">
      <div class="flex flex-wrap gap-2">
        <span>
          {$t('assistant_operation_item_selected_count', {
            values: { selected: item.review.selection.selectedCount, total: item.review.selection.totalCount },
          })}
        </span>
        {#if item.excludedAssetCount > 0}
          <span>
            {$t('assistant_operation_item_excluded_count', { values: { count: item.excludedAssetCount } })}
          </span>
        {/if}
      </div>

      <button
        type="button"
        class={[
          'rounded-md px-2 py-1 text-sm font-medium text-immich-primary hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-immich-dark-primary dark:hover:bg-gray-800',
          hasSelectionOverride ? '' : 'invisible pointer-events-none',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={!canChangeSelection || !hasSelectionOverride}
        aria-hidden={!hasSelectionOverride}
        tabindex={hasSelectionOverride ? undefined : -1}
        onclick={() => onResetSelection(item.id)}
      >
        {$t('assistant_operation_item_reset')}
      </button>
    </div>

    <div
      class="mt-3 flex flex-wrap items-start gap-2"
      data-testid="agent-plan-item-review-toolbar"
      role="toolbar"
      aria-label={$t('assistant_operation_item_toolbar_label')}
    >
      <input
        class="min-w-0 flex-1 basis-48 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 placeholder:text-gray-400 focus:border-immich-primary focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        type="search"
        aria-label={$t('assistant_operation_item_filter_label')}
        placeholder={$t('assistant_operation_item_filter_placeholder')}
        value={filter.query}
        oninput={(event) => setQuery(event.currentTarget.value)}
      />

      {#if facets.hasKind}
        <div class="flex rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
          {#each mediaKindOptions as { kind, labelKey } (kind)}
            <button
              type="button"
              class="rounded px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 aria-pressed:bg-immich-primary/10 aria-pressed:text-immich-primary dark:text-gray-300 dark:hover:bg-gray-800 dark:aria-pressed:bg-immich-dark-primary/10 dark:aria-pressed:text-immich-dark-primary"
              aria-pressed={filter.kind === kind}
              onclick={() => setKind(kind)}
            >
              {$t(labelKey)}
            </button>
          {/each}
        </div>
      {/if}

      {#if facets.hasScreenshots}
        <button
          type="button"
          class="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 aria-pressed:border-immich-primary aria-pressed:text-immich-primary dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:aria-pressed:border-immich-dark-primary dark:aria-pressed:text-immich-dark-primary"
          aria-pressed={filter.quickFilter === 'screenshots'}
          onclick={() => toggleQuickFilter('screenshots')}
        >
          {$t('assistant_operation_item_quick_screenshots')}
        </button>
      {/if}

      {#if facets.hasDuplicates}
        <button
          type="button"
          class="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 aria-pressed:border-immich-primary aria-pressed:text-immich-primary dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:aria-pressed:border-immich-dark-primary dark:aria-pressed:text-immich-dark-primary"
          aria-pressed={filter.quickFilter === 'duplicates'}
          onclick={() => toggleQuickFilter('duplicates')}
        >
          {$t('assistant_operation_item_quick_duplicates')}
        </button>
      {/if}

      <div class="flex min-w-0 flex-wrap gap-2">
        {#if facets.hasKind && videoAssetIds.length > 0}
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
            disabled={!canChangeSelection || videoAssetIds.length === 0}
            onclick={() => onBulkSetItems(item.id, videoAssetIds, false)}
          >
            {$t('assistant_operation_item_exclude_videos')}
          </button>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
            disabled={!canChangeSelection || videoAssetIds.length === 0}
            onclick={() => onSetOnlyItems(item.id, videoAssetIds)}
          >
            {$t('assistant_operation_item_include_only_videos')}
          </button>
        {/if}

        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
          disabled={!canChangeSelection || virtualWindow.visibleAssetIds.length === 0}
          onclick={() => onBulkSetItems(item.id, virtualWindow.visibleAssetIds, false)}
        >
          {$t('assistant_operation_item_exclude_visible')}
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
          disabled={!canChangeSelection || virtualWindow.visibleAssetIds.length === 0}
          onclick={() => onBulkSetItems(item.id, virtualWindow.visibleAssetIds, true)}
        >
          {$t('assistant_operation_item_include_visible')}
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
          disabled={!canChangeSelection || filteredAssetIds.length === 0}
          onclick={() => onSetOnlyItems(item.id, filteredAssetIds)}
        >
          {$t('assistant_operation_item_select_all_filtered')}
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
          disabled={!canChangeSelection || filteredAssetIds.length === 0}
          onclick={() => onBulkSetItems(item.id, filteredAssetIds, false)}
        >
          {$t('assistant_operation_item_deselect_all_filtered')}
        </button>
      </div>
    </div>

    <div class="mt-3 text-sm text-gray-600 dark:text-gray-300">
      {$t('assistant_operation_item_virtual_summary', {
        values: { visible: virtualWindow.visibleAssetIds.length, total: filteredAssetIds.length },
      })}
    </div>

    <div class="mt-2 w-full overflow-x-auto" use:measureGrid data-testid="agent-plan-item-review-grid-shell">
      <div
        bind:this={scrollElement}
        class={gridClass}
        data-testid="agent-plan-item-review-grid"
        style={[
          `width: ${gridContentWidth}px; max-width: 100%;`,
          viewportHeight === DEFAULT_VIEWPORT_HEIGHT ? undefined : `max-height: ${viewportHeight}px;`,
        ]
          .filter(Boolean)
          .join(' ')}
        onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
      >
        {#if filteredAssetIds.length === 0}
          <div class="flex min-h-32 items-center justify-center px-3 text-sm text-gray-500 dark:text-gray-400">
            {$t('assistant_operation_item_empty_filter')}
          </div>
        {/if}
        <div style={`height: ${virtualWindow.beforeHeight}px;`}></div>
        <div
          class="grid gap-2"
          data-testid="agent-plan-item-review-tile-grid"
          style={`grid-template-columns: repeat(${virtualColumnCount}, ${effectiveItemSize}px); grid-auto-rows: ${effectiveItemSize}px;`}
        >
          {#each virtualWindow.visibleAssetIds as assetId, visibleIndex (assetId)}
            {@const selected = isAssetSelectedForOperation(item, assetId)}
            {@const absoluteIndex = virtualWindow.startIndex + visibleIndex + 1}
            <label
              class={[
                'group relative aspect-square overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800',
                variant === 'modal' && selected
                  ? 'ring-2 ring-immich-primary ring-offset-2 dark:ring-immich-dark-primary dark:ring-offset-gray-950'
                  : '',
                variant === 'modal' && !selected ? 'opacity-60' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-testid="agent-plan-item-thumbnail"
              data-selected={String(selected)}
            >
              <img
                class="size-full object-cover opacity-100"
                class:opacity-40={!selected}
                data-testid="agent-plan-item-review-image"
                src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Thumbnail })}
                alt={getAssetAlt(assetId)}
                loading="lazy"
                draggable="false"
                onerror={() => markFailed(assetId)}
              />
              {#if failedAssetIds.has(assetId)}
                <span
                  class="absolute inset-0 flex items-center justify-center bg-gray-200 px-1 text-center text-[10px] leading-tight text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  {$t('assistant_operation_item_thumbnail_unavailable')}
                </span>
              {/if}
              <input
                class="absolute left-1.5 top-1.5 size-4"
                type="checkbox"
                aria-label={$t('assistant_operation_item_toggle', { values: { index: absoluteIndex } })}
                checked={selected}
                disabled={!canChangeSelection}
                onchange={(event) => onToggleItem(item.id, assetId, event.currentTarget.checked)}
              />
            </label>
          {/each}
        </div>
        <div style={`height: ${virtualWindow.afterHeight}px;`}></div>
      </div>
    </div>
  </section>
{/if}

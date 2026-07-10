<script lang="ts">
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';
  import SearchAddAllButton from '$lib/components/search/SearchAddAllButton.svelte';
  import { buildFilterContext, createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import { twMerge } from 'tailwind-merge';

  interface Props {
    grouping: TimelineGrouping;
    filters?: FilterState;
    resultCount?: number;
    hidden?: boolean;
    class?: string;
    onGroupingChange: (grouping: TimelineGrouping) => void;
    onClearTemporalFilter?: () => void;
    /**
     * These surfaces (favorites, archive, a person's photos) are themselves an implicit filter, so
     * when a handler is supplied the "Add all N to…" action shows whenever there are results.
     */
    onAddAllToCollection?: () => void;
  }

  let {
    grouping,
    filters,
    resultCount,
    hidden = false,
    class: className = '',
    onGroupingChange,
    onClearTemporalFilter,
    onAddAllToCollection,
  }: Props = $props();

  let temporalFilters = $derived.by(() => ({
    ...createFilterState(),
    dateAfter: filters?.dateAfter,
    dateBefore: filters?.dateBefore,
    selectedYear: filters?.selectedYear,
    selectedMonth: filters?.selectedMonth,
  }));

  let hasActiveTemporalFilters = $derived(buildFilterContext(temporalFilters) !== undefined);
  let showAddAll = $derived(!!onAddAllToCollection && (resultCount ?? 0) > 0);

  const removeTemporalFilter = (type: string) => {
    if (type === 'timeline') {
      onClearTemporalFilter?.();
    }
  };
</script>

{#if !hidden}
  <FilterToolbar
    {grouping}
    {onGroupingChange}
    showFilters={hasActiveTemporalFilters || showAddAll}
    class={twMerge('hidden md:flex', className)}
  >
    {#snippet filters()}
      {#if hasActiveTemporalFilters}
        <ActiveFiltersBar
          embedded
          filters={temporalFilters}
          {resultCount}
          onRemoveFilter={removeTemporalFilter}
          onClearAll={() => onClearTemporalFilter?.()}
        />
      {/if}
      {#if showAddAll}
        <SearchAddAllButton total={resultCount ?? 0} onclick={() => onAddAllToCollection?.()} />
      {/if}
    {/snippet}
  </FilterToolbar>
{/if}

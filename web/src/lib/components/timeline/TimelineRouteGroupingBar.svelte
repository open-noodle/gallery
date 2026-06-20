<script lang="ts">
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';
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
  }

  let {
    grouping,
    filters,
    resultCount,
    hidden = false,
    class: className = '',
    onGroupingChange,
    onClearTemporalFilter,
  }: Props = $props();

  let temporalFilters = $derived.by(() => ({
    ...createFilterState(),
    dateAfter: filters?.dateAfter,
    dateBefore: filters?.dateBefore,
    selectedYear: filters?.selectedYear,
    selectedMonth: filters?.selectedMonth,
  }));

  let hasActiveTemporalFilters = $derived(buildFilterContext(temporalFilters) !== undefined);

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
    showFilters={hasActiveTemporalFilters}
    class={twMerge('hidden md:flex', className)}
  >
    {#snippet filters()}
      <ActiveFiltersBar
        embedded
        filters={temporalFilters}
        {resultCount}
        onRemoveFilter={removeTemporalFilter}
        onClearAll={() => onClearTemporalFilter?.()}
      />
    {/snippet}
  </FilterToolbar>
{/if}

<script lang="ts">
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import { buildFilterContext, createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import { twMerge } from 'tailwind-merge';

  import TimelineGroupingControl from './TimelineGroupingControl.svelte';

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
  <div class={twMerge('hidden flex-col gap-2 bg-transparent px-4 py-2 dark:bg-transparent md:flex', className)}>
    <div class="flex items-center justify-end" data-testid="timeline-desktop-grouping-control">
      <TimelineGroupingControl {grouping} {onGroupingChange} />
    </div>

    {#if hasActiveTemporalFilters}
      <ActiveFiltersBar
        filters={temporalFilters}
        {resultCount}
        onRemoveFilter={removeTemporalFilter}
        onClearAll={() => onClearTemporalFilter?.()}
      />
    {/if}
  </div>
{/if}

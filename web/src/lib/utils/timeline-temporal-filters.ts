import type { FilterState } from '#lib/components/filter-panel/filter-panel.ts';

export function clearTimelineTemporalFilter(filters: FilterState): FilterState {
  return {
    ...filters,
    dateAfter: undefined,
    dateBefore: undefined,
    selectedYear: undefined,
    selectedMonth: undefined,
  };
}

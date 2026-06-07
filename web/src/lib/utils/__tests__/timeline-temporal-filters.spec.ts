import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { clearTimelineTemporalFilter } from '../timeline-temporal-filters';

describe('timeline temporal filter helpers', () => {
  it('clears only temporal filter state', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      rating: 4,
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
      selectedYear: 2015,
      selectedMonth: 8,
      sortOrder: 'asc' as const,
    };

    expect(clearTimelineTemporalFilter(filters)).toEqual({
      ...filters,
      dateAfter: undefined,
      dateBefore: undefined,
      selectedYear: undefined,
      selectedMonth: undefined,
    });
  });
});

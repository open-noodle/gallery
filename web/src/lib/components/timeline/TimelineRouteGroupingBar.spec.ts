import { fireEvent, render, screen } from '@testing-library/svelte';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import TimelineRouteGroupingBar from './TimelineRouteGroupingBar.svelte';

describe('TimelineRouteGroupingBar', () => {
  it('renders a desktop grouping control with the active grouping', () => {
    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'month',
        onGroupingChange: () => {},
      },
    });

    expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-control')).toHaveAttribute('data-variant', 'inline');
    expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('timeline-grouping-day')).toHaveTextContent('All');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the route grouping surface transparent instead of drawing a full-width toolbar', () => {
    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'year',
        onGroupingChange: () => {},
      },
    });

    const bar = screen.getByTestId('timeline-desktop-grouping-control').parentElement;
    expect(bar).toHaveClass('bg-transparent', 'dark:bg-transparent');
    expect(bar).not.toHaveClass('bg-gray-50', 'dark:bg-gray-900', 'border-b');
  });

  it('emits grouping changes without mutating temporal filters', async () => {
    const changes: TimelineGrouping[] = [];
    const filters: FilterState = { ...createFilterState(), selectedYear: 2024, selectedMonth: 3 };

    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'day',
        filters,
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-grouping-month'));

    expect(changes).toEqual(['month']);
    expect(filters).toEqual({ ...createFilterState(), selectedYear: 2024, selectedMonth: 3 });
  });

  it('renders a clearable temporal chip when temporal filters are active, including result count', async () => {
    const cleared: string[] = [];
    const filters: FilterState = { ...createFilterState(), selectedYear: 2024 };

    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'day',
        filters,
        resultCount: 12,
        onGroupingChange: () => {},
        onClearTemporalFilter: () => cleared.push('timeline'),
      },
    });

    expect(screen.getByTestId('result-count')).toHaveTextContent('12 results');
    expect(screen.getByTestId('active-chip')).toHaveTextContent('2024');

    await fireEvent.click(screen.getByTestId('chip-close'));

    expect(cleared).toEqual(['timeline']);
  });

  it('does not render non-temporal chips in the route grouping bar', () => {
    const filters: FilterState = {
      ...createFilterState(),
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      rating: 4,
      mediaType: 'image',
    };

    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'day',
        filters,
        resultCount: 3,
        onGroupingChange: () => {},
      },
    });

    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('active-chip')).not.toBeInTheDocument();
  });

  it('hides both grouping control and chip row when hidden', () => {
    const filters: FilterState = { ...createFilterState(), dateAfter: '2024-01-01' };

    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'year',
        filters,
        hidden: true,
        resultCount: 5,
        onGroupingChange: () => {},
      },
    });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });
});

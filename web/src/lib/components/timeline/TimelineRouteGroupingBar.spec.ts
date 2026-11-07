import { createFilterState, type FilterState } from '#lib/components/filter-panel/filter-panel.ts';
import type { TimelineGrouping } from '#lib/managers/timeline-manager/types.ts';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TimelineRouteGroupingBar from './TimelineRouteGroupingBar.svelte';

describe('TimelineRouteGroupingBar', () => {
  it('renders a desktop grouping control with the active grouping', async () => {
    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'month',
        onGroupingChange: () => {},
      },
    });

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-grouping-control')).toHaveAttribute('data-variant', 'inline');
    await expect.element(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByTestId('timeline-grouping-day')).toHaveTextContent('timeline_grouping_all');
    await expect
      .element(page.getByRole('button', { name: 'timeline_grouping_all' }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the toolbar surface transparent (no gray band)', async () => {
    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'year',
        onGroupingChange: () => {},
      },
    });

    const bar = page.getByTestId('timeline-desktop-grouping-control').element().parentElement!;
    await expect.element(page.elementLocator(bar)).toHaveClass('bg-transparent', 'dark:bg-transparent');
    await expect.element(page.elementLocator(bar)).not.toHaveClass('bg-gray-50', 'dark:bg-gray-900', 'border-b');
  });

  it('emits grouping changes without mutating temporal filters', async () => {
    const changes: TimelineGrouping[] = [];
    const filters: FilterState = { ...createFilterState(), selectedYear: 2024, selectedMonth: 3 };

    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'day',
        filters,
        onGroupingChange: (grouping: TimelineGrouping) => {
          changes.push(grouping);
        },
      },
    });

    await page.getByTestId('timeline-grouping-month').click();

    expect(changes).toEqual(['month']);
    expect(filters).toEqual({ ...createFilterState(), selectedYear: 2024, selectedMonth: 3 });
  });

  it('renders a clearable temporal chip when temporal filters are active, including result count', async () => {
    const cleared: string[] = [];
    const filters: FilterState = { ...createFilterState(), selectedYear: 2024 };

    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'day',
        filters,
        resultCount: 12,
        onGroupingChange: () => {},
        onClearTemporalFilter: () => {
          cleared.push('timeline');
        },
      },
    });

    await expect.element(page.getByTestId('result-count')).toHaveTextContent('filter_result_count');
    await expect.element(page.getByTestId('active-chip')).toHaveTextContent('2024');

    await page.getByTestId('chip-close').click();

    expect(cleared).toEqual(['timeline']);
  });

  it('does not render non-temporal chips in the route grouping bar', async () => {
    const filters: FilterState = {
      ...createFilterState(),
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      rating: 4,
      mediaType: 'image',
    };

    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'day',
        filters,
        resultCount: 3,
        onGroupingChange: () => {},
      },
    });

    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('active-chip')).not.toBeInTheDocument();
  });

  it('hides both grouping control and chip row when hidden', async () => {
    const filters: FilterState = { ...createFilterState(), dateAfter: '2024-01-01' };

    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'year',
        filters,
        hidden: true,
        resultCount: 5,
        onGroupingChange: () => {},
      },
    });

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('surfaces the add-all-to-collection action when a handler and results are provided (no temporal filter)', async () => {
    const onAddAllToCollection = vi.fn();
    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'month',
        resultCount: 42,
        onGroupingChange: () => {},
        onAddAllToCollection,
      },
    });

    const button = page.getByTestId('add-all-to-collection');
    await expect.element(button).toBeInTheDocument();
    await button.click();
    expect(onAddAllToCollection).toHaveBeenCalled();
  });

  it('does not surface the add-all action without a handler', async () => {
    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'month',
        resultCount: 42,
        onGroupingChange: () => {},
      },
    });

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  it('does not surface the add-all action when there are no results', async () => {
    await render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'month',
        resultCount: 0,
        onGroupingChange: () => {},
        onAddAllToCollection: vi.fn(),
      },
    });

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });
});

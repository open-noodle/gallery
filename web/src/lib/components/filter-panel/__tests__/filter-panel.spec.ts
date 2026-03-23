import { fireEvent, render } from '@testing-library/svelte';
import { vi } from 'vitest';
import FilterPanel from '../filter-panel.svelte';

describe('FilterPanel', () => {
  it('should render configured sections only', () => {
    const { queryByTestId } = render(FilterPanel, {
      props: {
        config: {
          sections: ['people', 'rating'],
          providers: {},
        },
        timeBuckets: [],
        onFilterChange: () => {},
      },
    });
    expect(queryByTestId('filter-section-people')).toBeTruthy();
    expect(queryByTestId('filter-section-rating')).toBeTruthy();
    expect(queryByTestId('filter-section-location')).toBeNull();
    expect(queryByTestId('filter-section-camera')).toBeNull();
  });

  it('should hide sections not in config', () => {
    const { queryByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
        onFilterChange: () => {},
      },
    });
    expect(queryByTestId('filter-section-people')).toBeNull();
    expect(queryByTestId('filter-section-location')).toBeNull();
    expect(queryByTestId('filter-section-camera')).toBeNull();
    expect(queryByTestId('filter-section-tags')).toBeNull();
    expect(queryByTestId('filter-section-media')).toBeNull();
    expect(queryByTestId('filter-section-rating')).toBeTruthy();
  });

  it('should collapse to icon strip', async () => {
    const { getByTestId, queryByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['people', 'location'], providers: {} },
        timeBuckets: [],
        onFilterChange: () => {},
      },
    });
    const collapseBtn = getByTestId('collapse-panel-btn');
    await fireEvent.click(collapseBtn);
    expect(queryByTestId('collapsed-icon-strip')).toBeTruthy();
    expect(queryByTestId('discovery-panel')).toBeNull();
  });

  it('should expand from collapsed state', async () => {
    const { getByTestId, queryByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['people'], providers: {} },
        timeBuckets: [],
        onFilterChange: () => {},
      },
    });
    // Collapse first
    await fireEvent.click(getByTestId('collapse-panel-btn'));
    expect(queryByTestId('collapsed-icon-strip')).toBeTruthy();
    // Expand
    await fireEvent.click(getByTestId('expand-panel-btn'));
    expect(queryByTestId('discovery-panel')).toBeTruthy();
    expect(queryByTestId('collapsed-icon-strip')).toBeNull();
  });

  it('should emit onMonthSelect when temporal picker month is clicked', async () => {
    const monthSelectSpy = vi.fn();
    const { getByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['timeline'], providers: {} },
        timeBuckets: [
          { timeBucket: '2023-06-01', count: 100 },
          { timeBucket: '2023-08-01', count: 200 },
        ],
        onFilterChange: () => {},
        onMonthSelect: monthSelectSpy,
      },
    });
    // Click a year to drill into months
    await fireEvent.click(getByTestId('year-btn-2023'));
    // Then click a month
    await fireEvent.click(getByTestId('month-btn-6'));
    expect(monthSelectSpy).toHaveBeenCalledWith(2023, 6);
  });

  it('should emit onYearSelect when temporal picker year is clicked', async () => {
    const yearSelectSpy = vi.fn();
    const { getByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['timeline'], providers: {} },
        timeBuckets: [
          { timeBucket: '2023-06-01', count: 100 },
          { timeBucket: '2023-08-01', count: 200 },
        ],
        onFilterChange: () => {},
        onYearSelect: yearSelectSpy,
      },
    });
    await fireEvent.click(getByTestId('year-btn-2023'));
    expect(yearSelectSpy).toHaveBeenCalledWith(2023);
  });
});

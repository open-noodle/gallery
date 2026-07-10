import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';

describe('ActiveFiltersBar search chip', () => {
  it('should render search chip when searchQuery is set', () => {
    render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        searchQuery: 'sunset',
        onClearSearch: vi.fn(),
      },
    });
    expect(screen.getByTestId('search-chip')).toHaveTextContent('sunset');
  });

  it('should call onClearSearch when search chip is removed', async () => {
    const onClearSearch = vi.fn();
    render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        searchQuery: 'sunset',
        onClearSearch,
      },
    });
    await userEvent.click(screen.getByTestId('search-chip-close'));
    expect(onClearSearch).toHaveBeenCalled();
  });

  it('should be visible when only search query is active (no structured filters)', () => {
    render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        searchQuery: 'sunset',
        onClearSearch: vi.fn(),
      },
    });
    expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
  });

  it('should not render search chip when searchQuery is empty', () => {
    render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        searchQuery: '',
        onClearSearch: vi.fn(),
      },
    });
    expect(screen.queryByTestId('search-chip')).not.toBeInTheDocument();
  });
});

describe('ActiveFiltersBar add-all-to-collection button', () => {
  const activeFilters = () => ({ ...createFilterState(), description: 'beach' });

  it('renders when a filter is active, results exist, and a handler is provided', () => {
    render(ActiveFiltersBar, {
      props: {
        filters: activeFilters(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 42,
        onAddAllToCollection: vi.fn(),
      },
    });
    expect(screen.getByTestId('add-all-to-collection')).toBeInTheDocument();
  });

  it('does not render when there are no results', () => {
    render(ActiveFiltersBar, {
      props: {
        filters: activeFilters(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 0,
        onAddAllToCollection: vi.fn(),
      },
    });
    expect(screen.queryByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  it('does not render on surfaces that pass no handler', () => {
    render(ActiveFiltersBar, {
      props: {
        filters: activeFilters(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 42,
      },
    });
    expect(screen.queryByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  it('does not render when no filter is active', () => {
    render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 42,
        onAddAllToCollection: vi.fn(),
      },
    });
    expect(screen.queryByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  it('calls onAddAllToCollection when clicked', async () => {
    const onAddAllToCollection = vi.fn();
    render(ActiveFiltersBar, {
      props: {
        filters: activeFilters(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 42,
        onAddAllToCollection,
      },
    });
    await userEvent.click(screen.getByTestId('add-all-to-collection'));
    expect(onAddAllToCollection).toHaveBeenCalled();
  });
});

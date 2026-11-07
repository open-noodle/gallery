import ActiveFiltersBar from '#lib/components/filter-panel/active-filters-bar.svelte';
import { createFilterState } from '#lib/components/filter-panel/filter-panel.ts';
import { render } from 'vitest-browser-svelte';

describe('ActiveFiltersBar search chip', () => {
  it('should render search chip when searchQuery is set', async () => {
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        searchQuery: 'sunset',
        onClearSearch: vi.fn(),
      },
    });
    await expect.element(screen.getByTestId('search-chip')).toHaveTextContent('sunset');
  });

  it('should call onClearSearch when search chip is removed', async () => {
    const onClearSearch = vi.fn();
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        searchQuery: 'sunset',
        onClearSearch,
      },
    });
    await screen.getByTestId('search-chip-close').click();
    expect(onClearSearch).toHaveBeenCalled();
  });

  it('should be visible when only search query is active (no structured filters)', async () => {
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        searchQuery: 'sunset',
        onClearSearch: vi.fn(),
      },
    });
    await expect.element(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
  });

  it('should not render search chip when searchQuery is empty', async () => {
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        searchQuery: '',
        onClearSearch: vi.fn(),
      },
    });
    await expect.element(screen.getByTestId('search-chip')).not.toBeInTheDocument();
  });
});

describe('ActiveFiltersBar add-all-to-collection button', () => {
  const activeFilters = () => ({ ...createFilterState(), description: 'beach' });

  it('renders when a filter is active, results exist, and a handler is provided', async () => {
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: activeFilters(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 42,
        onAddAllToCollection: vi.fn(),
      },
    });
    await expect.element(screen.getByTestId('add-all-to-collection')).toBeInTheDocument();
  });

  it('does not render when there are no results', async () => {
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: activeFilters(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 0,
        onAddAllToCollection: vi.fn(),
      },
    });
    await expect.element(screen.getByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  it('does not render on surfaces that pass no handler', async () => {
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: activeFilters(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 42,
      },
    });
    await expect.element(screen.getByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  it('does not render when no filter is active', async () => {
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: createFilterState(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 42,
        onAddAllToCollection: vi.fn(),
      },
    });
    await expect.element(screen.getByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  it('calls onAddAllToCollection when clicked', async () => {
    const onAddAllToCollection = vi.fn();
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters: activeFilters(),
        onRemoveFilter: vi.fn(),
        onClearAll: vi.fn(),
        resultCount: 42,
        onAddAllToCollection,
      },
    });
    await screen.getByTestId('add-all-to-collection').click();
    expect(onAddAllToCollection).toHaveBeenCalled();
  });
});

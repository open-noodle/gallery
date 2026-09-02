import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import FilterToolbar from '../filter-toolbar.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const filtersSnippet = createRawSnippet(() => ({
  render: () => `<div data-testid="bar-content">chips</div>`,
}));

describe('FilterToolbar', () => {
  it('renders the grouping control (desktop wrapper) and no filters by default', () => {
    const { getByTestId, queryByTestId } = render(FilterToolbar, {
      props: { grouping: 'day', onGroupingChange: () => {} },
    });
    expect(getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(getByTestId('timeline-grouping-control')).toBeInTheDocument();
    expect(queryByTestId('filter-toolbar-separator')).toBeNull();
  });

  it('renders the filters snippet and separator when showFilters is set', () => {
    const { getByTestId } = render(FilterToolbar, {
      props: {
        grouping: 'day',
        onGroupingChange: () => {},
        showGrouping: true,
        showFilters: true,
        filters: filtersSnippet,
      },
    });
    expect(getByTestId('bar-content')).toBeInTheDocument();
    expect(getByTestId('filter-toolbar-separator')).toBeInTheDocument();
  });

  it('omits the grouping wrapper (and separator) when showGrouping is false', () => {
    const { queryByTestId, getByTestId } = render(FilterToolbar, {
      props: {
        grouping: 'day',
        onGroupingChange: () => {},
        showGrouping: false,
        showFilters: true,
        filters: filtersSnippet,
      },
    });
    expect(queryByTestId('timeline-desktop-grouping-control')).toBeNull();
    expect(queryByTestId('filter-toolbar-separator')).toBeNull();
    expect(getByTestId('bar-content')).toBeInTheDocument();
  });

  it('renders nothing when neither grouping nor filters are shown', () => {
    const { container } = render(FilterToolbar, {
      props: { grouping: 'day', onGroupingChange: () => {}, showGrouping: false, showFilters: false },
    });
    expect(container.querySelector('[data-testid="timeline-grouping-control"]')).toBeNull();
  });

  // --- responsive contract (the riskiest part of the merge) ---

  it('is visible on mobile (flex, never hidden) when filters are shown', () => {
    const { getByTestId } = render(FilterToolbar, {
      props: {
        grouping: 'day',
        onGroupingChange: () => {},
        showGrouping: true,
        showFilters: true,
        filters: filtersSnippet,
      },
    });
    // the grouping wrapper's parent IS the toolbar root
    const root = getByTestId('timeline-desktop-grouping-control').parentElement!;
    expect(root.className).toContain('flex');
    expect(root.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('is desktop-only (hidden md:flex) when only grouping is shown', () => {
    const { getByTestId } = render(FilterToolbar, {
      props: { grouping: 'day', onGroupingChange: () => {}, showGrouping: true, showFilters: false },
    });
    const root = getByTestId('timeline-desktop-grouping-control').parentElement!;
    expect(root.className).toContain('hidden');
    expect(root.className).toContain('md:flex');
  });

  describe('collapsed-panel reopen button', () => {
    it('renders the reopen button without responsive hiding so phones can reopen the panel', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showFilterButton: true,
        filterActive: false,
        onExpandFilters: vi.fn(),
      });

      const root = screen.getByTestId('filter-toolbar-root');
      expect(root.className).toContain('flex');
      expect(root.className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);

      const wrapper = screen.getByTestId('filter-toolbar-reopen');
      expect(wrapper.className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);
    });

    it('keeps the grouping control desktop-only', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showFilterButton: true,
        filterActive: false,
        onExpandFilters: vi.fn(),
      });

      expect(screen.getByTestId('timeline-desktop-grouping-control').className).toContain('hidden');
    });
  });

  // --- scoped search button (#1051) ---
  //
  // The scoped search already worked from the nav bar; what it lacked was an affordance ON the
  // surface being searched. The button sits with the grouping pill, YouTube-channel style.
  describe('scoped search button', () => {
    it('is absent unless the host opts in', () => {
      render(FilterToolbar, { grouping: 'day', onGroupingChange: vi.fn(), showGrouping: true });

      expect(screen.queryByTestId('scoped-search-button')).toBeNull();
    });

    it('renders and calls onSearch when the host opts in', async () => {
      const onSearch = vi.fn();
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: true,
        showSearchButton: true,
        onSearch,
      });

      await fireEvent.click(screen.getByTestId('scoped-search-button'));

      expect(onSearch).toHaveBeenCalledOnce();
    });

    it('stays hidden when showSearchButton is set but no handler is wired', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: true,
        showSearchButton: true,
      });

      expect(screen.queryByTestId('scoped-search-button')).toBeNull();
    });

    it('sits after the grouping pill, matching the requested layout', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: true,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      const grouping = screen.getByTestId('timeline-desktop-grouping-control');
      const search = screen.getByTestId('filter-toolbar-search');
      expect(grouping.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is desktop-only, matching the grouping control it sits beside', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: true,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      const wrapper = screen.getByTestId('filter-toolbar-search');
      expect(wrapper.className).toContain('hidden');
      expect(wrapper.className).toContain('md:flex');
    });

    it('renders the toolbar for the search button alone — browsing an unfiltered album is the main case', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: false,
        showFilters: false,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      expect(screen.getByTestId('filter-toolbar-root')).toBeInTheDocument();
      expect(screen.getByTestId('scoped-search-button')).toBeInTheDocument();
    });

    it('survives search mode, where the grouping pill is swapped out for the chip bar', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: false,
        showFilters: true,
        filters: filtersSnippet,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      expect(screen.getByTestId('scoped-search-button')).toBeInTheDocument();
      expect(screen.getByTestId('bar-content')).toBeInTheDocument();
    });

    it('keeps a separator before the chip bar in search mode, where the grouping pill is gone', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: false,
        showFilters: true,
        filters: filtersSnippet,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      expect(screen.getByTestId('filter-toolbar-separator')).toBeInTheDocument();
    });

    it('still omits the separator when neither the pill nor the button is there', () => {
      render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: false,
        showFilters: true,
        filters: filtersSnippet,
      });

      expect(screen.queryByTestId('filter-toolbar-separator')).toBeNull();
    });
  });
});

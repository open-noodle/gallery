import { createRawSnippet } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import FilterToolbar from '../filter-toolbar.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const filtersSnippet = createRawSnippet(() => ({
  render: () => `<div data-testid="bar-content">chips</div>`,
}));

describe('FilterToolbar', () => {
  it('renders the grouping control (desktop wrapper) and no filters by default', async () => {
    await render(FilterToolbar, { grouping: 'day', onGroupingChange: () => {} });
    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-grouping-control')).toBeInTheDocument();
    expect(page.getByTestId('filter-toolbar-separator').query()).toBeNull();
  });

  it('renders the filters snippet and separator when showFilters is set', async () => {
    await render(FilterToolbar, {
      grouping: 'day',
      onGroupingChange: () => {},
      showGrouping: true,
      showFilters: true,
      filters: filtersSnippet,
    });
    await expect.element(page.getByTestId('bar-content')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-toolbar-separator')).toBeInTheDocument();
  });

  it('omits the grouping wrapper (and separator) when showGrouping is false', async () => {
    await render(FilterToolbar, {
      grouping: 'day',
      onGroupingChange: () => {},
      showGrouping: false,
      showFilters: true,
      filters: filtersSnippet,
    });
    expect(page.getByTestId('timeline-desktop-grouping-control').query()).toBeNull();
    expect(page.getByTestId('filter-toolbar-separator').query()).toBeNull();
    await expect.element(page.getByTestId('bar-content')).toBeInTheDocument();
  });

  it('renders nothing when neither grouping nor filters are shown', async () => {
    const { container } = await render(FilterToolbar, {
      grouping: 'day',
      onGroupingChange: () => {},
      showGrouping: false,
      showFilters: false,
    });
    expect(container.querySelector('[data-testid="timeline-grouping-control"]')).toBeNull();
  });

  // --- responsive contract (the riskiest part of the merge) ---

  it('is visible on mobile (flex, never hidden) when filters are shown', async () => {
    await render(FilterToolbar, {
      grouping: 'day',
      onGroupingChange: () => {},
      showGrouping: true,
      showFilters: true,
      filters: filtersSnippet,
    });
    // the grouping wrapper's parent IS the toolbar root
    const root = page.getByTestId('timeline-desktop-grouping-control').element().parentElement!;
    expect(root.className).toContain('flex');
    expect(root.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('is desktop-only (hidden md:flex) when only grouping is shown', async () => {
    await render(FilterToolbar, {
      grouping: 'day',
      onGroupingChange: () => {},
      showGrouping: true,
      showFilters: false,
    });
    const root = page.getByTestId('timeline-desktop-grouping-control').element().parentElement!;
    expect(root.className).toContain('hidden');
    expect(root.className).toContain('md:flex');
  });

  describe('collapsed-panel reopen button', () => {
    it('renders the reopen button without responsive hiding so phones can reopen the panel', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showFilterButton: true,
        filterActive: false,
        onExpandFilters: vi.fn(),
      });

      const root = page.getByTestId('filter-toolbar-root').element();
      expect(root.className).toContain('flex');
      expect(root.className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);

      const wrapper = page.getByTestId('filter-toolbar-reopen').element();
      expect(wrapper.className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);
    });

    it('keeps the grouping control desktop-only', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showFilterButton: true,
        filterActive: false,
        onExpandFilters: vi.fn(),
      });

      expect(page.getByTestId('timeline-desktop-grouping-control').element().className).toContain('hidden');
    });
  });

  // --- scoped search button (#1051) ---
  //
  // The scoped search already worked from the nav bar; what it lacked was an affordance ON the
  // surface being searched. The button sits with the grouping pill, YouTube-channel style.
  describe('scoped search button', () => {
    it('is absent unless the host opts in', async () => {
      await render(FilterToolbar, { grouping: 'day', onGroupingChange: vi.fn(), showGrouping: true });

      expect(page.getByTestId('scoped-search-button').query()).toBeNull();
    });

    it('renders and calls onSearch when the host opts in', async () => {
      const onSearch = vi.fn();
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: true,
        showSearchButton: true,
        onSearch,
      });

      await page.getByTestId('scoped-search-button').click();

      expect(onSearch).toHaveBeenCalledOnce();
    });

    it('stays hidden when showSearchButton is set but no handler is wired', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: true,
        showSearchButton: true,
      });

      expect(page.getByTestId('scoped-search-button').query()).toBeNull();
    });

    it('sits after the grouping pill, matching the requested layout', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: true,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      const grouping = page.getByTestId('timeline-desktop-grouping-control').element();
      const search = page.getByTestId('filter-toolbar-search').element();
      expect(grouping.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is desktop-only, matching the grouping control it sits beside', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: true,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      const wrapper = page.getByTestId('filter-toolbar-search').element();
      expect(wrapper.className).toContain('hidden');
      expect(wrapper.className).toContain('md:flex');
    });

    it('renders the toolbar for the search button alone — browsing an unfiltered album is the main case', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: false,
        showFilters: false,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      await expect.element(page.getByTestId('filter-toolbar-root')).toBeInTheDocument();
      await expect.element(page.getByTestId('scoped-search-button')).toBeInTheDocument();
    });

    it('survives search mode, where the grouping pill is swapped out for the chip bar', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: false,
        showFilters: true,
        filters: filtersSnippet,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      await expect.element(page.getByTestId('scoped-search-button')).toBeInTheDocument();
      await expect.element(page.getByTestId('bar-content')).toBeInTheDocument();
    });

    it('keeps a separator before the chip bar in search mode, where the grouping pill is gone', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: false,
        showFilters: true,
        filters: filtersSnippet,
        showSearchButton: true,
        onSearch: vi.fn(),
      });

      await expect.element(page.getByTestId('filter-toolbar-separator')).toBeInTheDocument();
    });

    it('still omits the separator when neither the pill nor the button is there', async () => {
      await render(FilterToolbar, {
        grouping: 'day',
        onGroupingChange: vi.fn(),
        showGrouping: false,
        showFilters: true,
        filters: filtersSnippet,
      });

      expect(page.getByTestId('filter-toolbar-separator').query()).toBeNull();
    });
  });
});

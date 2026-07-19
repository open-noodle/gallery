import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
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
});

import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { userEvent, type Locator } from 'vitest/browser';
import type { TagOption } from '../filter-panel';
import TagsFilter from '../tags-filter.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

function makeTags(count: number): TagOption[] {
  return Array.from({ length: count }, (_, i) => ({ id: `t${i + 1}`, name: `Tag ${i + 1}` }));
}

describe('TagsFilter', () => {
  it('should render tags with checkboxes', async () => {
    const tags = makeTags(3);
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });
    await expect.element(screen.getByTestId('tags-item-t1')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t2')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t3')).toBeInTheDocument();
  });

  it('should show empty message when no tags', async () => {
    const screen = await render(TagsFilter, { tags: [], selectedIds: [], onSelectionChange: () => {} });
    expect(screen.getByTestId('tags-empty').element().textContent).toBe('No tags available');
  });

  it('should not show search input when no tags', async () => {
    const screen = await render(TagsFilter, { tags: [], selectedIds: [], onSelectionChange: () => {} });
    expect(screen.getByTestId('tags-search-input').query()).toBeNull();
  });

  it('should show search input when tags exist', async () => {
    const tags = makeTags(3);
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });
    await expect.element(screen.getByTestId('tags-search-input')).toBeInTheDocument();
  });

  it('should filter tags via search input', async () => {
    const tags = [
      { id: 't1', name: 'Vacation' },
      { id: 't2', name: 'Family' },
      { id: 't3', name: 'Travel' },
      { id: 't4', name: 'Nature' },
      { id: 't5', name: 'Vacation 2024' },
    ];
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

    const searchInput = screen.getByTestId('tags-search-input');
    await userEvent.fill(searchInput, 'vac');

    await expect.element(screen.getByTestId('tags-item-t1')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t5')).toBeInTheDocument();
    expect(screen.getByTestId('tags-item-t2').query()).toBeNull();
    expect(screen.getByTestId('tags-item-t3').query()).toBeNull();
    expect(screen.getByTestId('tags-item-t4').query()).toBeNull();
  });

  it('should show every search match when they fit on one page', async () => {
    const tags = makeTags(15);
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

    // Without search, only first 10 visible
    await expect.element(screen.getByTestId('tags-item-t10')).toBeInTheDocument();
    expect(screen.getByTestId('tags-item-t11').query()).toBeNull();

    // Search for "Tag 1" — matches Tag 1, Tag 10..15 (6 items)
    await userEvent.fill(screen.getByTestId('tags-search-input'), 'Tag 1');

    // All 6 matches should be visible (no truncation during search)
    await expect.element(screen.getByTestId('tags-item-t1')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t10')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t11')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t12')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t13')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t14')).toBeInTheDocument();
    await expect.element(screen.getByTestId('tags-item-t15')).toBeInTheDocument();
  });

  it('should show "No matching tags" when search yields zero results', async () => {
    const tags = makeTags(3);
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

    await userEvent.fill(screen.getByTestId('tags-search-input'), 'zzzzz');

    await expect.element(screen.getByTestId('tags-no-results')).toBeInTheDocument();
    expect(screen.getByTestId('tags-no-results').element().textContent).toBe('No matching tags');
  });

  it('should truncate to INITIAL_SHOW_COUNT=10 and show "Show N more"', async () => {
    const tags = makeTags(15);
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

    // First 10 visible
    await expect.element(screen.getByTestId('tags-item-t10')).toBeInTheDocument();
    // 11th hidden
    expect(screen.getByTestId('tags-item-t11').query()).toBeNull();

    const showMore = screen.getByTestId('tags-show-more').element();
    expect(showMore.textContent).toContain('Show 5 more');
  });

  it('should expand list when "Show more" is clicked', async () => {
    const tags = makeTags(15);
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

    await screen.getByTestId('tags-show-more').click();

    await expect.element(screen.getByTestId('tags-item-t15')).toBeInTheDocument();
  });

  // #1125: a one-letter search used to render every match at once. Each row mounts a tooltip and
  // measures its own layout, so a few thousand rows froze iOS Safari for ~15s. Results now page in.
  describe('paging (#1125)', () => {
    const rows = (screen: Pick<Locator, 'getByTestId'>) => screen.getByTestId(/^tags-item-/).elements().length;

    it('P1: renders only the first page of search matches', async () => {
      const tags = makeTags(120);
      const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

      await userEvent.fill(screen.getByTestId('tags-search-input'), 'Tag');

      expect(rows(screen)).toBe(50);
      expect(screen.getByTestId('tags-show-more').element().textContent).toContain('Show 50 more');
    });

    it('P2: pages through search matches and stops at the last one', async () => {
      const tags = makeTags(120);
      const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });
      await userEvent.fill(screen.getByTestId('tags-search-input'), 'Tag');

      await screen.getByTestId('tags-show-more').click();
      expect(rows(screen)).toBe(100);
      expect(screen.getByTestId('tags-show-more').element().textContent).toContain('Show 20 more');

      await screen.getByTestId('tags-show-more').click();
      expect(rows(screen)).toBe(120);
      expect(screen.getByTestId('tags-show-more').query()).toBeNull();
    });

    it('P3: "Show more" without a search reveals one page, not every remaining tag', async () => {
      const tags = makeTags(100);
      const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });
      expect(screen.getByTestId('tags-show-more').element().textContent).toContain('Show 50 more');

      await screen.getByTestId('tags-show-more').click();

      expect(rows(screen)).toBe(60);
      expect(screen.getByTestId('tags-show-more').element().textContent).toContain('Show 40 more');
    });

    it('P4: keeps a selected match visible when it falls beyond the first page', async () => {
      const tags = makeTags(120);
      const screen = await render(TagsFilter, { tags, selectedIds: ['t110'], onSelectionChange: () => {} });

      await userEvent.fill(screen.getByTestId('tags-search-input'), 'Tag');

      expect(screen.getByTestId('tags-item-t110').element().getAttribute('aria-pressed')).toBe('true');
      expect(rows(screen)).toBe(50);
    });

    it('P5: a new search starts again from the first page', async () => {
      const tags = makeTags(120);
      const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });
      await userEvent.fill(screen.getByTestId('tags-search-input'), 'Tag');
      await screen.getByTestId('tags-show-more').click();
      expect(rows(screen)).toBe(100);

      // Still matches all 120 (search is case-insensitive), so only the reset can bring it back to 50.
      await userEvent.fill(screen.getByTestId('tags-search-input'), 'tag');

      expect(rows(screen)).toBe(50);
    });
  });

  it('should not show "Show more" when list fits within initial count', async () => {
    const tags = makeTags(8);
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

    expect(screen.getByTestId('tags-show-more').query()).toBeNull();
  });

  it('should show orphaned tags (selected but not in current results) at reduced opacity', async () => {
    const tags = [{ id: 't1', name: 'Vacation' }];
    const screen = await render(TagsFilter, { tags, selectedIds: ['t1', 't-orphan'], onSelectionChange: () => {} });

    const orphanItem = screen.getByTestId('tags-item-t-orphan').element();
    expect(orphanItem).toBeTruthy();
    expect(orphanItem.className).toContain('opacity-50');
  });

  it('should display orphaned tag name from cache when previously seen', async () => {
    const tags = [
      { id: 't1', name: 'Vacation' },
      { id: 't2', name: 'Family' },
    ];
    const screen = await render(TagsFilter, { tags, selectedIds: ['t2'], onSelectionChange: () => {} });

    // Now rerender with t2 removed from tags list — it should appear as orphan with cached name
    await screen.rerender({ tags: [tags[0]], selectedIds: ['t2'], onSelectionChange: () => {} });

    const orphanItem = screen.getByTestId('tags-item-t2').element();
    expect(orphanItem.textContent).toContain('Family');
  });

  it('should display raw ID for orphaned tag never seen before', async () => {
    const tags = [{ id: 't1', name: 'Vacation' }];
    const screen = await render(TagsFilter, { tags, selectedIds: ['t-never-seen'], onSelectionChange: () => {} });

    const orphanItem = screen.getByTestId('tags-item-t-never-seen').element();
    expect(orphanItem.textContent).toContain('t-never-seen');
  });

  it('should display orphaned selected tag name from typed search cache', async () => {
    const tags = [{ id: 't1', name: 'Vacation' }];
    const screen = await render(TagsFilter, {
      tags,
      selectedIds: ['t-nature'],
      selectedNames: new Map([['t-nature', 'nature']]),
      onSelectionChange: () => {},
    });

    const orphanItem = screen.getByTestId('tags-item-t-nature').element();
    expect(orphanItem.textContent).toContain('nature');
    expect(orphanItem.textContent).not.toContain('t-nature');
  });

  it('should show typed selected tag even when suggestions are empty', async () => {
    const screen = await render(TagsFilter, {
      tags: [],
      selectedIds: ['t-nature'],
      selectedNames: new Map([['t-nature', 'nature']]),
      onSelectionChange: () => {},
    });

    expect(screen.getByTestId('tags-empty').query()).toBeNull();
    expect(screen.getByTestId('tags-item-t-nature').element().textContent).toContain('nature');
  });

  it('should set aria-pressed on tag buttons', async () => {
    const tags = makeTags(3);
    const screen = await render(TagsFilter, { tags, selectedIds: ['t1'], onSelectionChange: () => {} });

    expect(screen.getByTestId('tags-item-t1').element().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tags-item-t2').element().getAttribute('aria-pressed')).toBe('false');
  });

  it('should toggle selection on click', async () => {
    let selected: string[] = [];
    const tags = makeTags(3);
    const screen = await render(TagsFilter, {
      tags,
      selectedIds: [],
      onSelectionChange: (ids: string[]) => (selected = ids),
    });

    await screen.getByTestId('tags-item-t1').click();
    expect(selected).toEqual(['t1']);
  });

  it('should deselect on second click', async () => {
    let selected: string[] = [];
    const tags = makeTags(3);
    const screen = await render(TagsFilter, {
      tags,
      selectedIds: ['t1'],
      onSelectionChange: (ids: string[]) => (selected = ids),
    });

    await screen.getByTestId('tags-item-t1').click();
    expect(selected).toEqual([]);
  });

  it('T1: clamps normal rows instead of truncating them', async () => {
    const tags = [{ id: 't1', name: 'Events/2024/Italy Summer Trip Rome' }];
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

    const label = screen.getByTestId('tags-item-t1').element().querySelector('span');
    expect(label?.className).toContain('line-clamp-2');
    expect(label?.className).not.toContain('truncate');
  });

  it('T2: clamps orphaned rows too', async () => {
    const screen = await render(TagsFilter, {
      tags: [{ id: 't1', name: 'Kept' }],
      selectedIds: ['gone'],
      selectedNames: new Map([['gone', 'Events/2024/Removed But Still Selected']]),
      onSelectionChange: () => {},
    });

    const label = screen.getByTestId('tags-item-gone').element().querySelector('span');
    expect(label?.className).toContain('line-clamp-2');
  });

  it('T3: keeps orphaned-row styling on the row element', async () => {
    const screen = await render(TagsFilter, {
      tags: [{ id: 't1', name: 'Kept' }],
      selectedIds: ['gone'],
      selectedNames: new Map([['gone', 'Removed']]),
      onSelectionChange: () => {},
    });

    const row = screen.getByTestId('tags-item-gone').element();
    expect(row.className).toContain('opacity-50');
    expect(row.className).toContain('font-medium');
    expect(row.getAttribute('aria-pressed')).toBe('true');
  });

  it('T4: still reports selection through the row component', async () => {
    const onSelectionChange = vi.fn();
    const screen = await render(TagsFilter, {
      tags: [{ id: 't1', name: 'Vacation' }],
      selectedIds: [],
      onSelectionChange,
    });

    await screen.getByTestId('tags-item-t1').click();

    expect(onSelectionChange).toHaveBeenCalledWith(['t1']);
  });

  it('T5: still filters by search, with clamped rows', async () => {
    const tags = [
      { id: 't1', name: 'Vacation' },
      { id: 't2', name: 'Family' },
    ];
    const screen = await render(TagsFilter, { tags, selectedIds: [], onSelectionChange: () => {} });

    await userEvent.fill(screen.getByTestId('tags-search-input'), 'vac');

    expect(screen.getByTestId('tags-item-t2').query()).toBeNull();
    expect(screen.getByTestId('tags-item-t1').element().querySelector('span')?.className).toContain('line-clamp-2');
  });
});

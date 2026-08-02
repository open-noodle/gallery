import { fireEvent, render } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import type { TagOption } from '../filter-panel';
import TagsFilter from '../tags-filter.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', getResizeObserverMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeTags(count: number): TagOption[] {
  return Array.from({ length: count }, (_, i) => ({ id: `t${i + 1}`, name: `Tag ${i + 1}` }));
}

describe('TagsFilter', () => {
  it('should render tags with checkboxes', () => {
    const tags = makeTags(3);
    const { getByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });
    expect(getByTestId('tags-item-t1')).toBeTruthy();
    expect(getByTestId('tags-item-t2')).toBeTruthy();
    expect(getByTestId('tags-item-t3')).toBeTruthy();
  });

  it('should show empty message when no tags', () => {
    const { getByTestId } = render(TagsFilter, {
      props: { tags: [], selectedIds: [], onSelectionChange: () => {} },
    });
    expect(getByTestId('tags-empty').textContent).toBe('No tags available');
  });

  it('should not show search input when no tags', () => {
    const { queryByTestId } = render(TagsFilter, {
      props: { tags: [], selectedIds: [], onSelectionChange: () => {} },
    });
    expect(queryByTestId('tags-search-input')).toBeNull();
  });

  it('should show search input when tags exist', () => {
    const tags = makeTags(3);
    const { getByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });
    expect(getByTestId('tags-search-input')).toBeTruthy();
  });

  it('should filter tags via search input', async () => {
    const tags = [
      { id: 't1', name: 'Vacation' },
      { id: 't2', name: 'Family' },
      { id: 't3', name: 'Travel' },
      { id: 't4', name: 'Nature' },
      { id: 't5', name: 'Vacation 2024' },
    ];
    const { getByTestId, queryByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });

    const searchInput = getByTestId('tags-search-input');
    await fireEvent.input(searchInput, { target: { value: 'vac' } });

    expect(queryByTestId('tags-item-t1')).toBeTruthy();
    expect(queryByTestId('tags-item-t5')).toBeTruthy();
    expect(queryByTestId('tags-item-t2')).toBeNull();
    expect(queryByTestId('tags-item-t3')).toBeNull();
    expect(queryByTestId('tags-item-t4')).toBeNull();
  });

  it('should show all search results without truncation', async () => {
    const tags = makeTags(15);
    const { getByTestId, queryByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });

    // Without search, only first 10 visible
    expect(queryByTestId('tags-item-t10')).toBeTruthy();
    expect(queryByTestId('tags-item-t11')).toBeNull();

    // Search for "Tag 1" — matches Tag 1, Tag 10..15 (6 items)
    await fireEvent.input(getByTestId('tags-search-input'), { target: { value: 'Tag 1' } });

    // All 6 matches should be visible (no truncation during search)
    expect(queryByTestId('tags-item-t1')).toBeTruthy();
    expect(queryByTestId('tags-item-t10')).toBeTruthy();
    expect(queryByTestId('tags-item-t11')).toBeTruthy();
    expect(queryByTestId('tags-item-t12')).toBeTruthy();
    expect(queryByTestId('tags-item-t13')).toBeTruthy();
    expect(queryByTestId('tags-item-t14')).toBeTruthy();
    expect(queryByTestId('tags-item-t15')).toBeTruthy();
  });

  it('should show "No matching tags" when search yields zero results', async () => {
    const tags = makeTags(3);
    const { getByTestId, queryByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });

    await fireEvent.input(getByTestId('tags-search-input'), { target: { value: 'zzzzz' } });

    expect(queryByTestId('tags-no-results')).toBeTruthy();
    expect(queryByTestId('tags-no-results')!.textContent).toBe('No matching tags');
  });

  it('should truncate to INITIAL_SHOW_COUNT=10 and show "Show N more"', () => {
    const tags = makeTags(15);
    const { getByTestId, queryByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });

    // First 10 visible
    expect(queryByTestId('tags-item-t10')).toBeTruthy();
    // 11th hidden
    expect(queryByTestId('tags-item-t11')).toBeNull();

    const showMore = getByTestId('tags-show-more');
    expect(showMore.textContent).toContain('Show 5 more');
  });

  it('should expand list when "Show more" is clicked', async () => {
    const tags = makeTags(15);
    const { getByTestId, queryByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });

    await fireEvent.click(getByTestId('tags-show-more'));

    expect(queryByTestId('tags-item-t15')).toBeTruthy();
  });

  it('should not show "Show more" when list fits within initial count', () => {
    const tags = makeTags(8);
    const { queryByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });

    expect(queryByTestId('tags-show-more')).toBeNull();
  });

  it('should show orphaned tags (selected but not in current results) at reduced opacity', () => {
    const tags = [{ id: 't1', name: 'Vacation' }];
    const { getByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: ['t1', 't-orphan'], onSelectionChange: () => {} },
    });

    const orphanItem = getByTestId('tags-item-t-orphan');
    expect(orphanItem).toBeTruthy();
    expect(orphanItem.className).toContain('opacity-50');
  });

  it('should display orphaned tag name from cache when previously seen', async () => {
    const tags = [
      { id: 't1', name: 'Vacation' },
      { id: 't2', name: 'Family' },
    ];
    const { getByTestId, rerender } = render(TagsFilter, {
      props: { tags, selectedIds: ['t2'], onSelectionChange: () => {} },
    });

    // Now rerender with t2 removed from tags list — it should appear as orphan with cached name
    await rerender({ tags: [tags[0]], selectedIds: ['t2'], onSelectionChange: () => {} });

    const orphanItem = getByTestId('tags-item-t2');
    expect(orphanItem.textContent).toContain('Family');
  });

  it('should display raw ID for orphaned tag never seen before', () => {
    const tags = [{ id: 't1', name: 'Vacation' }];
    const { getByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: ['t-never-seen'], onSelectionChange: () => {} },
    });

    const orphanItem = getByTestId('tags-item-t-never-seen');
    expect(orphanItem.textContent).toContain('t-never-seen');
  });

  it('should display orphaned selected tag name from typed search cache', () => {
    const tags = [{ id: 't1', name: 'Vacation' }];
    const { getByTestId } = render(TagsFilter, {
      props: {
        tags,
        selectedIds: ['t-nature'],
        selectedNames: new Map([['t-nature', 'nature']]),
        onSelectionChange: () => {},
      },
    });

    const orphanItem = getByTestId('tags-item-t-nature');
    expect(orphanItem.textContent).toContain('nature');
    expect(orphanItem.textContent).not.toContain('t-nature');
  });

  it('should show typed selected tag even when suggestions are empty', () => {
    const { getByTestId, queryByTestId } = render(TagsFilter, {
      props: {
        tags: [],
        selectedIds: ['t-nature'],
        selectedNames: new Map([['t-nature', 'nature']]),
        onSelectionChange: () => {},
      },
    });

    expect(queryByTestId('tags-empty')).toBeNull();
    expect(getByTestId('tags-item-t-nature').textContent).toContain('nature');
  });

  it('should set aria-pressed on tag buttons', () => {
    const tags = makeTags(3);
    const { getByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: ['t1'], onSelectionChange: () => {} },
    });

    expect(getByTestId('tags-item-t1').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('tags-item-t2').getAttribute('aria-pressed')).toBe('false');
  });

  it('should toggle selection on click', async () => {
    let selected: string[] = [];
    const tags = makeTags(3);
    const { getByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: (ids: string[]) => (selected = ids) },
    });

    await fireEvent.click(getByTestId('tags-item-t1'));
    expect(selected).toEqual(['t1']);
  });

  it('should deselect on second click', async () => {
    let selected: string[] = [];
    const tags = makeTags(3);
    const { getByTestId } = render(TagsFilter, {
      props: {
        tags,
        selectedIds: ['t1'],
        onSelectionChange: (ids: string[]) => (selected = ids),
      },
    });

    await fireEvent.click(getByTestId('tags-item-t1'));
    expect(selected).toEqual([]);
  });

  it('T1: clamps normal rows instead of truncating them', () => {
    const tags = [{ id: 't1', name: 'Events/2024/Italy Summer Trip Rome' }];
    const { getByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });

    const label = getByTestId('tags-item-t1').querySelector('span');
    expect(label?.className).toContain('line-clamp-2');
    expect(label?.className).not.toContain('truncate');
  });

  it('T2: clamps orphaned rows too', () => {
    const { getByTestId } = render(TagsFilter, {
      props: {
        tags: [{ id: 't1', name: 'Kept' }],
        selectedIds: ['gone'],
        selectedNames: new Map([['gone', 'Events/2024/Removed But Still Selected']]),
        onSelectionChange: () => {},
      },
    });

    const label = getByTestId('tags-item-gone').querySelector('span');
    expect(label?.className).toContain('line-clamp-2');
  });

  it('T3: keeps orphaned-row styling on the row element', () => {
    const { getByTestId } = render(TagsFilter, {
      props: {
        tags: [{ id: 't1', name: 'Kept' }],
        selectedIds: ['gone'],
        selectedNames: new Map([['gone', 'Removed']]),
        onSelectionChange: () => {},
      },
    });

    const row = getByTestId('tags-item-gone');
    expect(row.className).toContain('opacity-50');
    expect(row.className).toContain('font-medium');
    expect(row.getAttribute('aria-pressed')).toBe('true');
  });

  it('T4: still reports selection through the row component', async () => {
    const onSelectionChange = vi.fn();
    const { getByTestId } = render(TagsFilter, {
      props: { tags: [{ id: 't1', name: 'Vacation' }], selectedIds: [], onSelectionChange },
    });

    await fireEvent.click(getByTestId('tags-item-t1'));

    expect(onSelectionChange).toHaveBeenCalledWith(['t1']);
  });

  it('T5: still filters by search, with clamped rows', async () => {
    const tags = [
      { id: 't1', name: 'Vacation' },
      { id: 't2', name: 'Family' },
    ];
    const { getByTestId, queryByTestId } = render(TagsFilter, {
      props: { tags, selectedIds: [], onSelectionChange: () => {} },
    });

    await fireEvent.input(getByTestId('tags-search-input'), { target: { value: 'vac' } });

    expect(queryByTestId('tags-item-t2')).toBeNull();
    expect(getByTestId('tags-item-t1').querySelector('span')?.className).toContain('line-clamp-2');
  });
});

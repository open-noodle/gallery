import SpaceAlbumsControls from '#lib/components/spaces/space-albums-controls.svelte';
import SpaceAlbumsControlsWrapper from '#lib/components/spaces/space-albums-controls.test-wrapper.svelte';
import { AlbumSortBy, AlbumViewMode, SortOrder, albumViewSettings } from '#lib/stores/preferences.store.ts';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '#lib/stores/space-album-view-settings.store.ts';
import { SpaceAlbumSortBy } from '#lib/utils/space-album-sort.ts';
import { init, register, waitLocale } from 'svelte-i18n';
import { get } from 'svelte/store';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// The persisted store's reset() re-uses its initial object by reference, and in-place field
// writes (groupBy/collapsedGroups) can leak across tests. Set a fresh object each time.
const freshSpaceSettings = () => ({
  view: AlbumViewMode.Cover,
  sortBy: SpaceAlbumSortBy.RecentlyLinked,
  sortOrder: SortOrder.Desc,
  groupBy: SpaceAlbumGroupBy.None,
  groupOrder: SortOrder.Desc,
  collapsedGroups: {},
});

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: { primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
  await waitLocale('en-US');
});

beforeEach(() => {
  localStorage.clear();
  spaceAlbumViewSettings.set(freshSpaceSettings());
  albumViewSettings.reset();
});

describe('SpaceAlbumsControls search input', () => {
  it('renders a search input with data-testid="space-albums-search"', async () => {
    await render(SpaceAlbumsControls);
    expect(page.getByTestId('space-albums-search').element()).toBeInTheDocument();
  });

  it('reflects the passed searchQuery prop value', async () => {
    await render(SpaceAlbumsControls, { searchQuery: 'hello' });
    const input = page.getByTestId('space-albums-search').element() as HTMLInputElement;
    expect(input.value).toBe('hello');
  });

  it('propagates typed text upward through bind:searchQuery to the parent state', async () => {
    // Render via a wrapper that holds its own $state and passes bind:searchQuery.
    // The wrapper renders a <span data-testid="wrapper-search-query"> with the current state value.
    // If bind:value={searchQuery} were removed from the input, the span would stay empty
    // while the input shows the typed text — proving this test catches missing binding.
    await render(SpaceAlbumsControlsWrapper);
    const input = page.getByTestId('space-albums-search').element() as HTMLInputElement;
    const wrapperState = page.getByTestId('wrapper-search-query').element();

    await userEvent.type(input, 'beach');

    expect(wrapperState).toMatchTextContent('beach');
  });
});

describe('SpaceAlbumsControls sort dropdown', () => {
  it('renders a sort dropdown trigger button', async () => {
    await render(SpaceAlbumsControls);
    expect(page.getByTestId('space-albums-sort-btn').element()).toBeInTheDocument();
  });

  it('renders all seven sort option labels when dropdown is opened', async () => {
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-sort-btn'));
    const menu = page.getByTestId('space-albums-sort-menu').element();
    expect(page.elementLocator(menu).getByText('Title', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Number of items', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Date modified', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Date created', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Most recent photo', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Oldest photo', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Recently linked', { exact: true }).element()).toBeInTheDocument();
  });

  it('writes RecentlyLinked to the space store when "Recently linked" is selected', async () => {
    spaceAlbumViewSettings.set({ ...freshSpaceSettings(), sortBy: AlbumSortBy.Title, sortOrder: SortOrder.Asc });
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-sort-btn'));
    await userEvent.click(page.getByTestId('space-albums-sort-option-RecentlyLinked'));
    expect(get(spaceAlbumViewSettings).sortBy).toBe(SpaceAlbumSortBy.RecentlyLinked);
    // S3 — a newly selected option applies its own default direction
    expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Desc);
  });

  // The trigger previously resolved its label through upstream's
  // findSortOptionMetadata, which falls back to MostRecentPhoto for any id it
  // does not know — so RecentlyLinked rendered as "Most recent photo".
  it('shows the Recently linked label on the trigger when that option is active', async () => {
    spaceAlbumViewSettings.set({ ...freshSpaceSettings(), sortBy: SpaceAlbumSortBy.RecentlyLinked });
    await render(SpaceAlbumsControls);
    expect(page.getByTestId('space-albums-sort-btn').element()).toMatchTextContent('Recently linked');
  });

  // S2
  it('toggles sort order when Recently linked is re-selected', async () => {
    spaceAlbumViewSettings.set({
      ...freshSpaceSettings(),
      sortBy: SpaceAlbumSortBy.RecentlyLinked,
      sortOrder: SortOrder.Desc,
    });
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-sort-btn'));
    await userEvent.click(page.getByTestId('space-albums-sort-option-RecentlyLinked'));
    expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Asc);
  });

  it('writes AlbumSortBy.Title to the space store when "Title" is selected', async () => {
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-sort-btn'));
    await userEvent.click(page.getByTestId('space-albums-sort-option-Title'));
    expect(get(spaceAlbumViewSettings).sortBy).toBe(AlbumSortBy.Title);
  });

  it('never writes to the global albumViewSettings (isolation)', async () => {
    const before = get(albumViewSettings);
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-sort-btn'));
    await userEvent.click(page.getByTestId('space-albums-sort-option-Title'));
    expect(get(albumViewSettings)).toEqual(before);
  });

  it('toggles sort order when the same sort option is re-selected', async () => {
    // Pre-set sortBy to Title; defaultOrder for Title is Asc
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.Title, sortOrder: SortOrder.Asc }));
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-sort-btn'));
    await userEvent.click(page.getByTestId('space-albums-sort-option-Title'));
    expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Desc);
  });
});

describe('SpaceAlbumsControls group dropdown', () => {
  it('renders a group dropdown trigger button', async () => {
    await render(SpaceAlbumsControls);
    expect(page.getByTestId('space-albums-group-btn').element()).toBeInTheDocument();
  });

  it('lists None / Year / Linked by / Owner when the dropdown is opened', async () => {
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-group-btn'));
    const menu = page.getByTestId('space-albums-group-menu').element();
    expect(page.elementLocator(menu).getByText('No grouping', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Group by year', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Group by who linked', { exact: true }).element()).toBeInTheDocument();
    expect(page.elementLocator(menu).getByText('Group by owner', { exact: true }).element()).toBeInTheDocument();
  });

  it('writes the selected groupBy to the space store', async () => {
    // Year is disabled under the default RecentlyLinked sort (S27); pin a
    // Year-compatible sortBy so the option this test selects is clickable.
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.MostRecentPhoto }));
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-group-btn'));
    await userEvent.click(page.getByTestId('space-albums-group-option-Year'));
    expect(get(spaceAlbumViewSettings).groupBy).toBe(SpaceAlbumGroupBy.Year);
  });

  it('never writes to the global albumViewSettings (isolation)', async () => {
    const before = get(albumViewSettings);
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-group-btn'));
    await userEvent.click(page.getByTestId('space-albums-group-option-Owner'));
    expect(get(albumViewSettings)).toEqual(before);
  });

  it('disables the Year option when sortBy is DateCreated', async () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.DateCreated }));
    await render(SpaceAlbumsControls);
    await userEvent.click(page.getByTestId('space-albums-group-btn'));
    expect(page.getByTestId('space-albums-group-option-Year').element()).toBeDisabled();
  });

  // #974 — the stored groupBy survives a sort change that disables it, so the
  // trigger must report the *effective* grouping. Resolving the raw stored
  // groupBy made the button claim "Group by year" over a flat list.
  it('shows the effective grouping on the trigger when the stored one is disabled by the sort', async () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.DateCreated,
    }));
    await render(SpaceAlbumsControls);
    const trigger = page.getByTestId('space-albums-group-btn').element();
    expect(trigger).toMatchTextContent('No grouping');
    expect(trigger).not.toMatchTextContent('Group by year');
  });

  it('keeps the stored grouping on the trigger while the sort still allows it', async () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.MostRecentPhoto,
    }));
    await render(SpaceAlbumsControls);
    expect(page.getByTestId('space-albums-group-btn').element()).toMatchTextContent('Group by year');
  });

  it('hides expand/collapse-all buttons when groupBy is None', async () => {
    await render(SpaceAlbumsControls);
    expect(page.getByTestId('space-albums-expand-all').query()).not.toBeInTheDocument();
    expect(page.getByTestId('space-albums-collapse-all').query()).not.toBeInTheDocument();
  });

  it('shows expand/collapse-all buttons when a group is selected', async () => {
    // Year is disabled under the default RecentlyLinked sort (S27); pin a
    // Year-compatible sortBy so getSelectedSpaceAlbumGroupOption doesn't fall back to None.
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.MostRecentPhoto,
    }));
    await render(SpaceAlbumsControls, { groupIds: ['2024', '2020'] });
    expect(page.getByTestId('space-albums-expand-all').element()).toBeInTheDocument();
    expect(page.getByTestId('space-albums-collapse-all').element()).toBeInTheDocument();
  });

  it('collapse-all collapses the provided group ids in the space store', async () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.MostRecentPhoto,
    }));
    await render(SpaceAlbumsControls, { groupIds: ['2024', '2020'] });
    await userEvent.click(page.getByTestId('space-albums-collapse-all'));
    expect(get(spaceAlbumViewSettings).collapsedGroups.Year.sort()).toEqual(['2020', '2024']);
  });

  it('expand-all clears the collapsed groups in the space store', async () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.MostRecentPhoto,
      collapsedGroups: { Year: ['2024', '2020'] },
    }));
    await render(SpaceAlbumsControls, { groupIds: ['2024', '2020'] });
    await userEvent.click(page.getByTestId('space-albums-expand-all'));
    expect(get(spaceAlbumViewSettings).collapsedGroups.Year).toEqual([]);
  });
});

describe('SpaceAlbumsControls create + link buttons', () => {
  it('shows Create + Link for editors and invokes the callbacks', async () => {
    const onCreate = vi.fn();
    const onLink = vi.fn();
    await render(SpaceAlbumsControls, { canManage: true, onCreate, onLink });
    await userEvent.click(page.getByTestId('create-album-button'));
    await userEvent.click(page.getByTestId('link-album-button'));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onLink).toHaveBeenCalledOnce();
  });

  it('hides Create + Link for viewers but keeps search/sort/group/view', async () => {
    await render(SpaceAlbumsControls, { canManage: false });
    expect(page.getByTestId('create-album-button').query()).not.toBeInTheDocument();
    expect(page.getByTestId('link-album-button').query()).not.toBeInTheDocument();
    expect(page.getByTestId('space-albums-search').element()).toBeInTheDocument();
    expect(page.getByTestId('space-albums-sort-btn').element()).toBeInTheDocument();
    expect(page.getByTestId('space-albums-group-btn').element()).toBeInTheDocument();
    expect(page.getByTestId('space-albums-view-toggle').element()).toBeInTheDocument();
  });
});

import { render, screen, within, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
import { get } from 'svelte/store';
import SpaceAlbumsControls from '$lib/components/spaces/space-albums-controls.svelte';
import SpaceAlbumsControlsWrapper from '$lib/components/spaces/space-albums-controls.test-wrapper.svelte';
import { AlbumSortBy, AlbumViewMode, SortOrder, albumViewSettings } from '$lib/stores/preferences.store';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';

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
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
  await waitLocale('en-US');
});

beforeEach(() => {
  localStorage.clear();
  spaceAlbumViewSettings.set(freshSpaceSettings());
  albumViewSettings.reset();
});

describe('SpaceAlbumsControls search input', () => {
  it('renders a search input with data-testid="space-albums-search"', () => {
    render(SpaceAlbumsControls);
    expect(screen.getByTestId('space-albums-search')).toBeInTheDocument();
  });

  it('reflects the passed searchQuery prop value', () => {
    render(SpaceAlbumsControls, { searchQuery: 'hello' });
    const input = screen.getByTestId('space-albums-search') as HTMLInputElement;
    expect(input.value).toBe('hello');
  });

  it('propagates typed text upward through bind:searchQuery to the parent state', async () => {
    // Render via a wrapper that holds its own $state and passes bind:searchQuery.
    // The wrapper renders a <span data-testid="wrapper-search-query"> with the current state value.
    // If bind:value={searchQuery} were removed from the input, the span would stay empty
    // while the input shows the typed text — proving this test catches missing binding.
    render(SpaceAlbumsControlsWrapper);
    const input = screen.getByTestId('space-albums-search') as HTMLInputElement;
    const wrapperState = screen.getByTestId('wrapper-search-query');

    await userEvent.type(input, 'beach');

    expect(wrapperState).toHaveTextContent('beach');
  });
});

describe('SpaceAlbumsControls sort dropdown', () => {
  it('renders a sort dropdown trigger button', () => {
    render(SpaceAlbumsControls);
    expect(screen.getByTestId('space-albums-sort-btn')).toBeInTheDocument();
  });

  it('renders all seven sort option labels when dropdown is opened', async () => {
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
    const menu = screen.getByTestId('space-albums-sort-menu');
    expect(within(menu).getByText('Title')).toBeInTheDocument();
    expect(within(menu).getByText('Number of items')).toBeInTheDocument();
    expect(within(menu).getByText('Date modified')).toBeInTheDocument();
    expect(within(menu).getByText('Date created')).toBeInTheDocument();
    expect(within(menu).getByText('Most recent photo')).toBeInTheDocument();
    expect(within(menu).getByText('Oldest photo')).toBeInTheDocument();
    expect(within(menu).getByText('Recently linked')).toBeInTheDocument();
  });

  it('writes RecentlyLinked to the space store when "Recently linked" is selected', async () => {
    spaceAlbumViewSettings.set({ ...freshSpaceSettings(), sortBy: AlbumSortBy.Title, sortOrder: SortOrder.Asc });
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
    await userEvent.click(screen.getByTestId('space-albums-sort-option-RecentlyLinked'));
    expect(get(spaceAlbumViewSettings).sortBy).toBe(SpaceAlbumSortBy.RecentlyLinked);
    // S3 — a newly selected option applies its own default direction
    expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Desc);
  });

  // The trigger previously resolved its label through upstream's
  // findSortOptionMetadata, which falls back to MostRecentPhoto for any id it
  // does not know — so RecentlyLinked rendered as "Most recent photo".
  it('shows the Recently linked label on the trigger when that option is active', () => {
    spaceAlbumViewSettings.set({ ...freshSpaceSettings(), sortBy: SpaceAlbumSortBy.RecentlyLinked });
    render(SpaceAlbumsControls);
    expect(screen.getByTestId('space-albums-sort-btn')).toHaveTextContent('Recently linked');
  });

  // S2
  it('toggles sort order when Recently linked is re-selected', async () => {
    spaceAlbumViewSettings.set({
      ...freshSpaceSettings(),
      sortBy: SpaceAlbumSortBy.RecentlyLinked,
      sortOrder: SortOrder.Desc,
    });
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
    await userEvent.click(screen.getByTestId('space-albums-sort-option-RecentlyLinked'));
    expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Asc);
  });

  it('writes AlbumSortBy.Title to the space store when "Title" is selected', async () => {
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
    await userEvent.click(screen.getByTestId('space-albums-sort-option-Title'));
    expect(get(spaceAlbumViewSettings).sortBy).toBe(AlbumSortBy.Title);
  });

  it('never writes to the global albumViewSettings (isolation)', async () => {
    const before = get(albumViewSettings);
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
    await userEvent.click(screen.getByTestId('space-albums-sort-option-Title'));
    expect(get(albumViewSettings)).toEqual(before);
  });

  it('toggles sort order when the same sort option is re-selected', async () => {
    // Pre-set sortBy to Title; defaultOrder for Title is Asc
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.Title, sortOrder: SortOrder.Asc }));
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
    await userEvent.click(screen.getByTestId('space-albums-sort-option-Title'));
    expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Desc);
  });
});

describe('SpaceAlbumsControls group dropdown', () => {
  it('renders a group dropdown trigger button', () => {
    render(SpaceAlbumsControls);
    expect(screen.getByTestId('space-albums-group-btn')).toBeInTheDocument();
  });

  it('lists None / Year / Linked by / Owner when the dropdown is opened', async () => {
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-group-btn'));
    const menu = screen.getByTestId('space-albums-group-menu');
    expect(within(menu).getByText('No grouping')).toBeInTheDocument();
    expect(within(menu).getByText('Group by year')).toBeInTheDocument();
    expect(within(menu).getByText('Group by who linked')).toBeInTheDocument();
    expect(within(menu).getByText('Group by owner')).toBeInTheDocument();
  });

  it('writes the selected groupBy to the space store', async () => {
    // Year is disabled under the default RecentlyLinked sort (S27); pin a
    // Year-compatible sortBy so the option this test selects is clickable.
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.MostRecentPhoto }));
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-group-btn'));
    await userEvent.click(screen.getByTestId('space-albums-group-option-Year'));
    expect(get(spaceAlbumViewSettings).groupBy).toBe(SpaceAlbumGroupBy.Year);
  });

  it('never writes to the global albumViewSettings (isolation)', async () => {
    const before = get(albumViewSettings);
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-group-btn'));
    await userEvent.click(screen.getByTestId('space-albums-group-option-Owner'));
    expect(get(albumViewSettings)).toEqual(before);
  });

  it('disables the Year option when sortBy is DateCreated', async () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.DateCreated }));
    render(SpaceAlbumsControls);
    await userEvent.click(screen.getByTestId('space-albums-group-btn'));
    expect(screen.getByTestId('space-albums-group-option-Year')).toBeDisabled();
  });

  // #974 — the stored groupBy survives a sort change that disables it, so the
  // trigger must report the *effective* grouping. Resolving the raw stored
  // groupBy made the button claim "Group by year" over a flat list.
  it('shows the effective grouping on the trigger when the stored one is disabled by the sort', () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.DateCreated,
    }));
    render(SpaceAlbumsControls);
    const trigger = screen.getByTestId('space-albums-group-btn');
    expect(trigger).toHaveTextContent('No grouping');
    expect(trigger).not.toHaveTextContent('Group by year');
  });

  it('keeps the stored grouping on the trigger while the sort still allows it', () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.MostRecentPhoto,
    }));
    render(SpaceAlbumsControls);
    expect(screen.getByTestId('space-albums-group-btn')).toHaveTextContent('Group by year');
  });

  it('hides expand/collapse-all buttons when groupBy is None', () => {
    render(SpaceAlbumsControls);
    expect(screen.queryByTestId('space-albums-expand-all')).not.toBeInTheDocument();
    expect(screen.queryByTestId('space-albums-collapse-all')).not.toBeInTheDocument();
  });

  it('shows expand/collapse-all buttons when a group is selected', () => {
    // Year is disabled under the default RecentlyLinked sort (S27); pin a
    // Year-compatible sortBy so getSelectedSpaceAlbumGroupOption doesn't fall back to None.
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.MostRecentPhoto,
    }));
    render(SpaceAlbumsControls, { groupIds: ['2024', '2020'] });
    expect(screen.getByTestId('space-albums-expand-all')).toBeInTheDocument();
    expect(screen.getByTestId('space-albums-collapse-all')).toBeInTheDocument();
  });

  it('collapse-all collapses the provided group ids in the space store', async () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.MostRecentPhoto,
    }));
    render(SpaceAlbumsControls, { groupIds: ['2024', '2020'] });
    await userEvent.click(screen.getByTestId('space-albums-collapse-all'));
    expect(get(spaceAlbumViewSettings).collapsedGroups.Year.sort()).toEqual(['2020', '2024']);
  });

  it('expand-all clears the collapsed groups in the space store', async () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      groupBy: SpaceAlbumGroupBy.Year,
      sortBy: AlbumSortBy.MostRecentPhoto,
      collapsedGroups: { Year: ['2024', '2020'] },
    }));
    render(SpaceAlbumsControls, { groupIds: ['2024', '2020'] });
    await userEvent.click(screen.getByTestId('space-albums-expand-all'));
    expect(get(spaceAlbumViewSettings).collapsedGroups.Year).toEqual([]);
  });
});

describe('SpaceAlbumsControls create + link buttons', () => {
  it('shows Create + Link for editors and invokes the callbacks', async () => {
    const onCreate = vi.fn();
    const onLink = vi.fn();
    render(SpaceAlbumsControls, { canManage: true, onCreate, onLink });
    await fireEvent.click(screen.getByTestId('create-album-button'));
    await fireEvent.click(screen.getByTestId('link-album-button'));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onLink).toHaveBeenCalledOnce();
  });

  it('hides Create + Link for viewers but keeps search/sort/group/view', () => {
    render(SpaceAlbumsControls, { canManage: false });
    expect(screen.queryByTestId('create-album-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('link-album-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('space-albums-search')).toBeInTheDocument();
    expect(screen.getByTestId('space-albums-sort-btn')).toBeInTheDocument();
    expect(screen.getByTestId('space-albums-group-btn')).toBeInTheDocument();
    expect(screen.getByTestId('space-albums-view-toggle')).toBeInTheDocument();
  });
});

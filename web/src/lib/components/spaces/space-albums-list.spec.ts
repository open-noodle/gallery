import type { SharedSpaceLinkedAlbumDto, SharedSpaceMemberResponseDto } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { get } from 'svelte/store';
import SpaceAlbumsList from '$lib/components/spaces/space-albums-list.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { AlbumSortBy, AlbumViewMode, SortOrder, albumViewSettings } from '$lib/stores/preferences.store';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import { toggleSpaceAlbumGroupCollapsing } from '$lib/utils/space-album-grouping';
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';
import { userAdminFactory } from '@test-data/factories/user-factory';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (v: unknown) => void) => {
      run({ url: new URL('http://localhost/spaces/space-1/albums'), route: { id: '' } });
      return () => {};
    },
  },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: { primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

function makeAlbum(overrides: Partial<SharedSpaceLinkedAlbumDto> = {}): SharedSpaceLinkedAlbumDto {
  return {
    id: 'album-1',
    ownerId: 'owner-1',
    albumName: 'Vacation',
    assetCount: 5,
    albumThumbnailAssetId: null,
    showInTimeline: true,
    addedById: null,
    linkedAt: '2026-01-01T00:00:00.000Z',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shared: false,
    hasSharedLink: false,
    isActivityEnabled: false,
    startDate: undefined,
    endDate: undefined,
    ...overrides,
  };
}

const idsInCoverOrder = () =>
  screen.getAllByTestId('space-album-card-link').map((a) => a.getAttribute('href')!.split('/').pop());

const idsInListOrder = () =>
  [...document.querySelectorAll('[data-testid^="space-album-row-"]')].map((el) =>
    (el as HTMLElement).dataset['testid']!.replace('space-album-row-', ''),
  );

describe('SpaceAlbumsList', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    localStorage.clear();
    spaceAlbumViewSettings.reset();
    albumViewSettings.reset();
    authManager.setUser(userAdminFactory.build({ id: 'me' }));
  });

  it('renders cover cards by default and switches to the table on view=List', async () => {
    const albums = [makeAlbum({ id: 'a-1' }), makeAlbum({ id: 'a-2' })];
    render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
    expect(screen.getAllByTestId('space-album-card')).toHaveLength(2);
    spaceAlbumViewSettings.update((s) => ({ ...s, view: AlbumViewMode.List }));
    expect(await screen.findByTestId('space-album-row-a-1')).toBeInTheDocument();
  });

  it('never writes the global albumViewSettings (isolation)', () => {
    const before = get(albumViewSettings);
    render(SpaceAlbumsList, { spaceId: 's-1', albums: [makeAlbum({ id: 'a-1' })], canManage: false });
    spaceAlbumViewSettings.update((s) => ({ ...s, view: AlbumViewMode.List }));
    expect(get(albumViewSettings)).toEqual(before);
  });

  it('sorts by Title ascending in cover mode', () => {
    const albums = [makeAlbum({ id: 'b', albumName: 'Bravo' }), makeAlbum({ id: 'a', albumName: 'Alpha' })];
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.Title, sortOrder: SortOrder.Asc }));
    render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
    expect(idsInCoverOrder()).toEqual(['a', 'b']);
  });

  it('sorts by item count descending in cover mode', () => {
    const albums = [makeAlbum({ id: 'lo', assetCount: 2 }), makeAlbum({ id: 'hi', assetCount: 9 })];
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.ItemCount, sortOrder: SortOrder.Desc }));
    render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
    expect(idsInCoverOrder()).toEqual(['hi', 'lo']);
  });

  it('sorts by MostRecentPhoto on endDate, pushing null-date albums last', () => {
    const albums = [
      makeAlbum({ id: 'none' }), // no startDate/endDate
      makeAlbum({ id: 'old', endDate: '2020-01-01T00:00:00.000Z' }),
      makeAlbum({ id: 'new', endDate: '2024-01-01T00:00:00.000Z' }),
    ];
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.MostRecentPhoto, sortOrder: SortOrder.Desc }));
    render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
    const order = idsInCoverOrder();
    expect(order.slice(0, 2)).toEqual(['new', 'old']);
    expect(order[2]).toBe('none'); // null-date last
  });

  it('sorts by OldestPhoto on startDate in cover mode', () => {
    const albums = [
      makeAlbum({ id: 'y2024', startDate: '2024-01-01T00:00:00.000Z' }),
      makeAlbum({ id: 'y2020', startDate: '2020-01-01T00:00:00.000Z' }),
    ];
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.OldestPhoto, sortOrder: SortOrder.Asc }));
    render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
    expect(idsInCoverOrder()).toEqual(['y2020', 'y2024']);
  });

  it('sorts by Title ascending in list mode', () => {
    const albums = [makeAlbum({ id: 'b', albumName: 'Bravo' }), makeAlbum({ id: 'a', albumName: 'Alpha' })];
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      view: AlbumViewMode.List,
      sortBy: AlbumSortBy.Title,
      sortOrder: SortOrder.Asc,
    }));
    render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
    expect(idsInListOrder()).toEqual(['a', 'b']);
  });

  describe('search filtering', () => {
    it('filters by album name (case-insensitive)', () => {
      const albums = [makeAlbum({ id: 'v', albumName: 'Vacation' }), makeAlbum({ id: 'w', albumName: 'Work' })];
      render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false, searchQuery: 'vac' });
      expect(screen.getAllByTestId('space-album-card-link')).toHaveLength(1);
      expect(screen.getByText('Vacation')).toBeInTheDocument();
    });
    it('filters by description and does not throw on null description', () => {
      const albums = [
        makeAlbum({ id: 'a', albumName: 'A', description: 'beach trip' }),
        makeAlbum({ id: 'b', albumName: 'B', description: null as unknown as string }),
      ];
      expect(() =>
        render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false, searchQuery: 'beach' }),
      ).not.toThrow();
      expect(screen.getAllByTestId('space-album-card-link')).toHaveLength(1);
    });
    it('shows a no-matching message when the query matches nothing', () => {
      render(SpaceAlbumsList, {
        spaceId: 's-1',
        albums: [makeAlbum({ id: 'a', albumName: 'Alpha' })],
        canManage: false,
        searchQuery: 'zzz',
      });
      expect(screen.getByTestId('space-albums-no-results')).toBeInTheDocument();
      expect(screen.queryAllByTestId('space-album-card-link')).toHaveLength(0);
    });
    it('an empty query shows everything', () => {
      render(SpaceAlbumsList, {
        spaceId: 's-1',
        albums: [makeAlbum({ id: 'a' }), makeAlbum({ id: 'b' })],
        canManage: false,
        searchQuery: '',
      });
      expect(screen.getAllByTestId('space-album-card-link')).toHaveLength(2);
    });
  });

  describe('grouping (cover mode)', () => {
    it('renders no group headers when groupBy is None', () => {
      const albums = [makeAlbum({ id: 'a-1' }), makeAlbum({ id: 'a-2' })];
      render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
      expect(screen.queryByTestId(/^space-album-group-/)).not.toBeInTheDocument();
      expect(screen.getAllByTestId('space-album-card')).toHaveLength(2);
    });

    it('renders a header per year with names and counts when groupBy is Year', () => {
      const albums = [
        makeAlbum({ id: 'y2020', endDate: '2020-06-01T00:00:00.000Z' }),
        makeAlbum({ id: 'y2024a', endDate: '2024-06-01T00:00:00.000Z' }),
        makeAlbum({ id: 'y2024b', endDate: '2024-07-01T00:00:00.000Z' }),
      ];
      spaceAlbumViewSettings.update((s) => ({
        ...s,
        groupBy: SpaceAlbumGroupBy.Year,
        sortBy: AlbumSortBy.MostRecentPhoto,
        sortOrder: SortOrder.Desc,
      }));
      render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
      const header2024 = screen.getByTestId('space-album-group-2024');
      const header2020 = screen.getByTestId('space-album-group-2020');
      expect(header2024).toHaveTextContent('2024');
      expect(header2024).toHaveTextContent('2');
      expect(header2020).toHaveTextContent('2020');
      expect(header2020).toHaveTextContent('1');
    });

    it('collapsing a group marks its header collapsed (aria-expanded=false)', async () => {
      const albums = [
        makeAlbum({ id: 'y2020', endDate: '2020-06-01T00:00:00.000Z' }),
        makeAlbum({ id: 'y2024', endDate: '2024-06-01T00:00:00.000Z' }),
      ];
      // Year is disabled for the default RecentlyLinked sort (S27), so this test
      // pins a Year-compatible sortBy to exercise the grouping it's actually testing.
      spaceAlbumViewSettings.update((s) => ({
        ...s,
        groupBy: SpaceAlbumGroupBy.Year,
        sortBy: AlbumSortBy.MostRecentPhoto,
      }));
      render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
      expect(screen.getByTestId('space-album-group-2020')).toHaveAttribute('aria-expanded', 'true');
      toggleSpaceAlbumGroupCollapsing('2020');
      await waitFor(() =>
        expect(screen.getByTestId('space-album-group-2020')).toHaveAttribute('aria-expanded', 'false'),
      );
    });

    it('renders member-name headers plus an Unassigned group when groupBy is LinkedBy', () => {
      const members = [{ userId: 'u1', name: 'Alice' }] as unknown as SharedSpaceMemberResponseDto[];
      const albums = [makeAlbum({ id: 'a', addedById: 'u1' }), makeAlbum({ id: 'b', addedById: null })];
      spaceAlbumViewSettings.update((s) => ({ ...s, groupBy: SpaceAlbumGroupBy.LinkedBy }));
      render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false, members });
      expect(screen.getByTestId('space-album-group-u1')).toHaveTextContent('Alice');
      expect(screen.getByTestId('space-album-group-Unassigned')).toHaveTextContent('Unassigned');
    });
  });

  // S10 at list level — the empty album renders last even though the sort is
  // descending. `canManage` is a REQUIRED prop on this component; omitting it
  // breaks the render.
  it('renders albums with no photos last when sorting by Most recent photo', async () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      sortBy: AlbumSortBy.MostRecentPhoto,
      sortOrder: SortOrder.Desc,
      groupBy: SpaceAlbumGroupBy.None,
    }));
    render(SpaceAlbumsList, {
      props: {
        spaceId: 'space-1',
        canManage: false,
        albums: [
          makeAlbum({ id: 'empty', albumName: 'Empty', startDate: undefined, endDate: undefined }),
          makeAlbum({
            id: 'full',
            albumName: 'HasPhotos',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-01-10T00:00:00.000Z',
          }),
        ],
        members: [] as SharedSpaceMemberResponseDto[],
      },
    });

    // Assert DOM order via the card testid rather than a text regex, so the
    // assertion cannot be satisfied by incidental matches elsewhere in the tree.
    await waitFor(() => expect(screen.getAllByTestId('space-album-card')).toHaveLength(2));
    const order = screen.getAllByTestId('space-album-card').map((card) => card.textContent);
    expect(order[0]).toContain('HasPhotos');
    expect(order[1]).toContain('Empty');
  });

  // Discriminates the list-level fix: upstream's sortAlbums has no entry for
  // RecentlyLinked and silently falls back to DateModified (updatedAt)
  // ordering. These two albums' linkedAt and updatedAt orders disagree, so a
  // DateModified fallback would render them in the opposite order from what
  // Recently linked descending requires.
  it('sorts by Recently linked descending, even when it disagrees with Date modified order', async () => {
    spaceAlbumViewSettings.update((s) => ({
      ...s,
      sortBy: SpaceAlbumSortBy.RecentlyLinked,
      sortOrder: SortOrder.Desc,
      groupBy: SpaceAlbumGroupBy.None,
    }));
    render(SpaceAlbumsList, {
      props: {
        spaceId: 'space-1',
        canManage: false,
        albums: [
          makeAlbum({
            id: 'recent-link',
            albumName: 'RecentLink',
            linkedAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2020-01-01T00:00:00.000Z',
          }),
          makeAlbum({
            id: 'old-link',
            albumName: 'OldLink',
            linkedAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          }),
        ],
        members: [] as SharedSpaceMemberResponseDto[],
      },
    });

    await waitFor(() => expect(screen.getAllByTestId('space-album-card')).toHaveLength(2));
    const order = screen.getAllByTestId('space-album-card').map((card) => card.textContent);
    expect(order[0]).toContain('RecentLink');
    expect(order[1]).toContain('OldLink');
  });
});

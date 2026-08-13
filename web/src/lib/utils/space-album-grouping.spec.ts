import type { SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { get } from 'svelte/store';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import {
  buildSpaceAlbumGroups,
  getSelectedSpaceAlbumGroupOption,
  isSpaceAlbumGroupCollapsed,
  toggleSpaceAlbumGroupCollapsing,
  collapseAllSpaceAlbumGroups,
  expandAllSpaceAlbumGroups,
  spaceGroupOptionsMetadata,
  type SpaceAlbumGroupingCtx,
} from '$lib/utils/space-album-grouping';
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';

const CTX: SpaceAlbumGroupingCtx = {
  ungrouped: 'Albums',
  unknownYear: 'Unknown Year',
  unassigned: 'Unassigned',
  currentUserId: 'me',
  members: [],
};

const A = (o: Partial<SharedSpaceLinkedAlbumDto>): SharedSpaceLinkedAlbumDto => ({
  id: 'x',
  ownerId: 'owner-1',
  albumName: 'A',
  assetCount: 0,
  albumThumbnailAssetId: null,
  showInTimeline: true,
  addedById: null,
  linkedAt: '',
  description: '',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  shared: false,
  hasSharedLink: false,
  isActivityEnabled: false,
  ...o,
});

beforeEach(() => {
  localStorage.clear();
  spaceAlbumViewSettings.reset();
});

it('None → a single group named ungrouped', () => {
  const g = buildSpaceAlbumGroups(
    [A({ id: 'a' })],
    { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.None },
    CTX,
  );
  expect(g).toHaveLength(1);
  expect(g[0].albums).toHaveLength(1);
});

it('Year buckets by endDate, unknown-year last', () => {
  const albums = [
    A({ id: 'none' }),
    A({ id: 'y2020', endDate: '2020-06-01T00:00:00Z' }),
    A({ id: 'y2024', endDate: '2024-06-01T00:00:00Z' }),
  ];
  // Year's isDisabled() reads the store directly, so the store (not just the
  // locally-built settings object below) must carry a Year-compatible sortBy.
  spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.MostRecentPhoto }));
  const g = buildSpaceAlbumGroups(
    albums,
    {
      ...get(spaceAlbumViewSettings),
      groupBy: SpaceAlbumGroupBy.Year,
      groupOrder: SortOrder.Desc,
      sortBy: AlbumSortBy.MostRecentPhoto,
    },
    CTX,
  );
  expect(g.map((x) => x.name)).toEqual(['2024', '2020', 'Unknown Year']);
});

it('Year uses startDate under Oldest-photo sort', () => {
  const albums = [A({ id: 's', startDate: '2019-01-01T00:00:00Z', endDate: '2025-01-01T00:00:00Z' })];
  // Year's isDisabled() reads the store directly, so the store (not just the
  // locally-built settings object below) must carry a Year-compatible sortBy.
  spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.OldestPhoto }));
  const g = buildSpaceAlbumGroups(
    albums,
    { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.Year, sortBy: AlbumSortBy.OldestPhoto },
    CTX,
  );
  expect(g[0].name).toBe('2019');
});

it('LinkedBy resolves addedById to member name; null/unknown → unassigned', () => {
  const ctx = { ...CTX, members: [{ userId: 'u1', name: 'Alice' }] };
  const albums = [A({ id: 'a', addedById: 'u1' }), A({ id: 'b', addedById: null }), A({ id: 'c', addedById: 'ghost' })];
  const g = buildSpaceAlbumGroups(albums, { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.LinkedBy }, ctx);
  const byName = Object.fromEntries(g.map((x) => [x.name, x.albums.map((a) => a.id)]));
  expect(byName['Alice']).toEqual(['a']);
  expect(byName['Unassigned'].sort()).toEqual(['b', 'c']);
});

it('Owner groups by ownerId (resolved from ctx.members); missing ownerId → unassigned (no crash)', () => {
  const ctx = {
    ...CTX,
    currentUserId: 'me',
    members: [
      { userId: 'me', name: 'Me' },
      { userId: 'her', name: 'Zoe' },
    ],
  };
  // ownerId is not yet on SharedSpaceLinkedAlbumDto in the SDK; cast to simulate server-side value.
  const withOwner = (album: SharedSpaceLinkedAlbumDto, ownerId: string) =>
    Object.assign(album, { ownerId }) as SharedSpaceLinkedAlbumDto;
  const albums = [
    withOwner(A({ id: 'mine' }), 'me'),
    withOwner(A({ id: 'hers' }), 'her'),
    A({ id: 'noOwner' }), // no ownerId → unassigned
  ];
  const g = buildSpaceAlbumGroups(albums, { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.Owner }, ctx);
  const names = g.map((x) => x.name);
  expect(names).toContain('Zoe');
  expect(names).toContain('Unassigned'); // missing ownerId bucket
  expect(() =>
    buildSpaceAlbumGroups([A({ id: 'e' })], { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.Owner }, ctx),
  ).not.toThrow();
});

it('getSelectedSpaceAlbumGroupOption falls back to None when Year is disabled under date sort', () => {
  const s = { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.Year, sortBy: AlbumSortBy.DateCreated };
  spaceAlbumViewSettings.set(s);
  expect(getSelectedSpaceAlbumGroupOption(s)).toBe(SpaceAlbumGroupBy.None);
});

it('collapse mutators write only the space store, keyed by groupBy', () => {
  spaceAlbumViewSettings.update((s) => ({ ...s, groupBy: SpaceAlbumGroupBy.Year }));
  toggleSpaceAlbumGroupCollapsing('2024');
  expect(isSpaceAlbumGroupCollapsed(get(spaceAlbumViewSettings), '2024')).toBe(true);
  collapseAllSpaceAlbumGroups(['2024', '2020']);
  expect(get(spaceAlbumViewSettings).collapsedGroups.Year.sort()).toEqual(['2020', '2024']);
  expandAllSpaceAlbumGroups();
  expect(get(spaceAlbumViewSettings).collapsedGroups.Year).toEqual([]);
});

// S27
describe('Year grouping availability', () => {
  const yearOption = () => spaceGroupOptionsMetadata.find(({ id }) => id === SpaceAlbumGroupBy.Year)!;

  // Recently linked is the default sort, so disabling Year for it would leave
  // Year grouping unreachable out of the box — the e2e suite caught exactly
  // that. It stays enabled even though it is an album-metadata date.
  it('is enabled while sorting by Recently linked', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: SpaceAlbumSortBy.RecentlyLinked }));
    expect(yearOption().isDisabled()).toBe(false);
  });

  it('stays disabled for Date created and Date modified', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.DateCreated }));
    expect(yearOption().isDisabled()).toBe(true);
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.DateModified }));
    expect(yearOption().isDisabled()).toBe(true);
  });

  it('is enabled for the photo-date sorts', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.MostRecentPhoto }));
    expect(yearOption().isDisabled()).toBe(false);
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.OldestPhoto }));
    expect(yearOption().isDisabled()).toBe(false);
  });
});

// S28
describe('grouped lists sort within each group by Recently linked', () => {
  it('orders each group by linkedAt descending', () => {
    const settings = {
      ...get(spaceAlbumViewSettings),
      groupBy: SpaceAlbumGroupBy.Owner,
      sortBy: SpaceAlbumSortBy.RecentlyLinked,
      sortOrder: SortOrder.Desc,
    };
    const albums = [
      A({ id: '1', albumName: 'OwnerA-Early', ownerId: 'a', linkedAt: '2026-01-01T00:00:00Z' }),
      A({ id: '2', albumName: 'OwnerA-Late', ownerId: 'a', linkedAt: '2026-06-01T00:00:00Z' }),
    ];
    // buildSpaceAlbumGroups returns SpaceAlbumGroup[] = { id, name, albums }.
    // Owner grouping keys the group by ownerId, so select it by id rather than
    // by album count — a length-based lookup would silently pick the wrong
    // group if grouping ever changed.
    const groups = buildSpaceAlbumGroups(albums, settings, CTX);
    const ownerAGroup = groups.find((g) => g.id === 'a');
    expect(ownerAGroup?.albums.map((a) => a.albumName)).toEqual(['OwnerA-Late', 'OwnerA-Early']);
  });
});

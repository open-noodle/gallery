import type { SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import {
  SpaceAlbumSortBy,
  findSpaceAlbumSortOptionMetadata,
  sortSpaceAlbums,
  spaceAlbumSortOptionsMetadata,
} from '$lib/utils/space-album-sort';

const A = (o: Partial<SharedSpaceLinkedAlbumDto>): SharedSpaceLinkedAlbumDto => ({
  id: 'x',
  ownerId: 'owner-1',
  albumName: 'A',
  assetCount: 0,
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
  ...o,
});

const names = (albums: SharedSpaceLinkedAlbumDto[]) => albums.map((a) => a.albumName);

describe('spaceAlbumSortOptionsMetadata', () => {
  it('lists the seven contract options in order', () => {
    expect(spaceAlbumSortOptionsMetadata.map(({ id }) => id)).toEqual([
      AlbumSortBy.Title,
      AlbumSortBy.ItemCount,
      AlbumSortBy.DateModified,
      AlbumSortBy.DateCreated,
      AlbumSortBy.MostRecentPhoto,
      AlbumSortBy.OldestPhoto,
      SpaceAlbumSortBy.RecentlyLinked,
    ]);
  });

  it('defaults Title to ascending and every other option to descending', () => {
    const byId = new Map(spaceAlbumSortOptionsMetadata.map((o) => [o.id, o.defaultOrder]));
    expect(byId.get(AlbumSortBy.Title)).toBe(SortOrder.Asc);
    for (const id of [
      AlbumSortBy.ItemCount,
      AlbumSortBy.DateModified,
      AlbumSortBy.DateCreated,
      AlbumSortBy.MostRecentPhoto,
      AlbumSortBy.OldestPhoto,
      SpaceAlbumSortBy.RecentlyLinked,
    ]) {
      expect(byId.get(id)).toBe(SortOrder.Desc);
    }
  });
});

describe('findSpaceAlbumSortOptionMetadata', () => {
  it('finds a known option', () => {
    expect(findSpaceAlbumSortOptionMetadata(AlbumSortBy.Title).id).toBe(AlbumSortBy.Title);
    expect(findSpaceAlbumSortOptionMetadata(SpaceAlbumSortBy.RecentlyLinked).id).toBe(SpaceAlbumSortBy.RecentlyLinked);
  });

  // S26
  it('falls back to RecentlyLinked for an unrecognised value', () => {
    expect(findSpaceAlbumSortOptionMetadata('NotASort').id).toBe(SpaceAlbumSortBy.RecentlyLinked);
    expect(findSpaceAlbumSortOptionMetadata('').id).toBe(SpaceAlbumSortBy.RecentlyLinked);
  });
});

describe('sortSpaceAlbums delegates the six upstream options', () => {
  // S1
  it('sorts by Title ascending, case-insensitively', () => {
    const albums = [A({ albumName: 'beach' }), A({ albumName: 'Apple' }), A({ albumName: 'Zoo' })];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.Title, orderBy: SortOrder.Asc }))).toEqual([
      'Apple',
      'beach',
      'Zoo',
    ]);
  });

  // S4
  it('sorts by Number of items descending', () => {
    const albums = [
      A({ albumName: 'Small', assetCount: 1 }),
      A({ albumName: 'Big', assetCount: 9 }),
      A({ albumName: 'Mid', assetCount: 5 }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.ItemCount, orderBy: SortOrder.Desc }))).toEqual([
      'Big',
      'Mid',
      'Small',
    ]);
  });

  // S5
  it('sorts by Date modified descending', () => {
    const albums = [
      A({ albumName: 'Jan3', updatedAt: '2026-01-03T00:00:00.000Z' }),
      A({ albumName: 'Jan1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      A({ albumName: 'Jan2', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.DateModified, orderBy: SortOrder.Desc }))).toEqual([
      'Jan3',
      'Jan2',
      'Jan1',
    ]);
  });

  // S6 — createdAt order is the reverse of linkedAt order for this fixture
  it('sorts by Date created descending, independently of linkedAt', () => {
    const albums = [
      A({ albumName: 'Old', createdAt: '2026-01-01T00:00:00.000Z', linkedAt: '2026-03-01T00:00:00.000Z' }),
      A({ albumName: 'New', createdAt: '2026-02-01T00:00:00.000Z', linkedAt: '2026-02-02T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.DateCreated, orderBy: SortOrder.Desc }))).toEqual([
      'New',
      'Old',
    ]);
  });

  // S7 — B's newest is later than A's, but B's oldest is earlier than A's,
  // so a comparator wired to the wrong field produces the opposite order.
  it('sorts by Most recent photo descending', () => {
    const albums = [
      A({ albumName: 'A', startDate: '2026-01-05T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z' }),
      A({ albumName: 'B', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-20T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.MostRecentPhoto, orderBy: SortOrder.Desc }))).toEqual([
      'B',
      'A',
    ]);
  });

  // S8 — same fixture, opposite field. Descending is asserted too: it yields
  // ['A','B'] where MostRecentPhoto descending yields ['B','A'], so a
  // comparator reading endDate here would fail rather than coincidentally pass.
  it('sorts by Oldest photo in both directions', () => {
    const albums = () => [
      A({ albumName: 'A', startDate: '2026-01-05T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z' }),
      A({ albumName: 'B', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-20T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums(), { sortBy: AlbumSortBy.OldestPhoto, orderBy: SortOrder.Asc }))).toEqual([
      'B',
      'A',
    ]);
    expect(names(sortSpaceAlbums(albums(), { sortBy: AlbumSortBy.OldestPhoto, orderBy: SortOrder.Desc }))).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('sortSpaceAlbums RecentlyLinked', () => {
  const albums = () => [
    A({ albumName: 'Old', createdAt: '2026-01-01T00:00:00.000Z', linkedAt: '2026-03-01T00:00:00.000Z' }),
    A({ albumName: 'New', createdAt: '2026-02-01T00:00:00.000Z', linkedAt: '2026-02-02T00:00:00.000Z' }),
  ];

  // S9
  it('puts the most recently linked album first when descending', () => {
    expect(
      names(sortSpaceAlbums(albums(), { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Desc })),
    ).toEqual(['Old', 'New']);
  });

  // S2 (comparator half)
  it('reverses when ascending', () => {
    expect(
      names(sortSpaceAlbums(albums(), { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Asc })),
    ).toEqual(['New', 'Old']);
  });

  // S17 — bulk-linked albums share a linkedAt; order must be stable, not arbitrary
  it('keeps a stable order for identical linkedAt values', () => {
    const tied = [
      A({ id: 'a', albumName: 'First', linkedAt: '2026-01-01T00:00:00.000Z' }),
      A({ id: 'b', albumName: 'Second', linkedAt: '2026-01-01T00:00:00.000Z' }),
      A({ id: 'c', albumName: 'Third', linkedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const once = names(sortSpaceAlbums(tied, { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Desc }));
    const twice = names(sortSpaceAlbums(tied, { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Desc }));
    expect(once).toEqual(['First', 'Second', 'Third']);
    expect(twice).toEqual(once);
  });

  it('does not mutate the input array', () => {
    const input = albums();
    sortSpaceAlbums(input, { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Desc });
    expect(names(input)).toEqual(['Old', 'New']);
  });
});

// S26 — the pill label and the applied ordering must agree
describe('sortSpaceAlbums unknown sortBy', () => {
  it('orders by RecentlyLinked, matching what the finder reports', () => {
    // updatedAt and linkedAt deliberately disagree, so falling through to
    // upstream's DateModified fallback produces the opposite order.
    const albums = [
      A({ albumName: 'ByUpdated', updatedAt: '2026-09-01T00:00:00.000Z', linkedAt: '2026-01-01T00:00:00.000Z' }),
      A({ albumName: 'ByLinked', updatedAt: '2026-01-01T00:00:00.000Z', linkedAt: '2026-09-01T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: 'NotASort', orderBy: SortOrder.Desc }))).toEqual([
      'ByLinked',
      'ByUpdated',
    ]);
    expect(findSpaceAlbumSortOptionMetadata('NotASort').id).toBe(SpaceAlbumSortBy.RecentlyLinked);
  });
});

// S10–S12, S14
describe('sortSpaceAlbums albums without photo dates', () => {
  const mixed = () => [
    A({ albumName: 'Empty', startDate: undefined, endDate: undefined }),
    A({ albumName: 'HasPhotos', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z' }),
  ];

  it('puts the album with no photos last, descending (S10)', () => {
    expect(names(sortSpaceAlbums(mixed(), { sortBy: AlbumSortBy.MostRecentPhoto, orderBy: SortOrder.Desc }))).toEqual([
      'HasPhotos',
      'Empty',
    ]);
  });

  it('puts the album with no photos last, ascending too (S11)', () => {
    expect(names(sortSpaceAlbums(mixed(), { sortBy: AlbumSortBy.MostRecentPhoto, orderBy: SortOrder.Asc }))).toEqual([
      'HasPhotos',
      'Empty',
    ]);
  });

  it('applies the same rule to Oldest photo in both directions (S12)', () => {
    expect(names(sortSpaceAlbums(mixed(), { sortBy: AlbumSortBy.OldestPhoto, orderBy: SortOrder.Desc }))).toEqual([
      'HasPhotos',
      'Empty',
    ]);
    expect(names(sortSpaceAlbums(mixed(), { sortBy: AlbumSortBy.OldestPhoto, orderBy: SortOrder.Asc }))).toEqual([
      'HasPhotos',
      'Empty',
    ]);
  });

  it('keeps every album when none has photo dates (S14)', () => {
    const none = [A({ albumName: 'One' }), A({ albumName: 'Two' }), A({ albumName: 'Three' })];
    const sorted = sortSpaceAlbums(none, { sortBy: AlbumSortBy.MostRecentPhoto, orderBy: SortOrder.Desc });
    expect(sorted).toHaveLength(3);
    expect(new Set(names(sorted))).toEqual(new Set(['One', 'Two', 'Three']));
  });
});

// S18, S19
describe('sortSpaceAlbums boundary inputs', () => {
  const everyOption = spaceAlbumSortOptionsMetadata.map(({ id }) => id);

  it('returns an empty array for every option and direction', () => {
    for (const sortBy of everyOption) {
      for (const orderBy of [SortOrder.Asc, SortOrder.Desc]) {
        expect(sortSpaceAlbums([], { sortBy, orderBy })).toEqual([]);
      }
    }
  });

  it('returns a single album unchanged for every option and direction', () => {
    for (const sortBy of everyOption) {
      for (const orderBy of [SortOrder.Asc, SortOrder.Desc]) {
        expect(names(sortSpaceAlbums([A({ albumName: 'Only' })], { sortBy, orderBy }))).toEqual(['Only']);
      }
    }
  });
});

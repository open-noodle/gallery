import { AlbumUserRole, type AlbumResponseDto } from '@immich/sdk';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import { isAlbumEditor, sortAlbums } from '$lib/utils/album-utils';

const A = (o: Partial<AlbumResponseDto>): AlbumResponseDto =>
  ({
    id: 'a',
    albumName: 'A',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    albumThumbnailAssetId: null,
    shared: false,
    hasSharedLink: false,
    assetCount: 0,
    isActivityEnabled: false,
    albumUsers: [],
    ...o,
  }) as never;

const withUsers = (roles: [userId: string, role: AlbumUserRole][]) =>
  A({ albumUsers: roles.map(([id, role]) => ({ user: { id }, role })) as never });

describe('isAlbumEditor', () => {
  it('is true for the owner', () => {
    expect(isAlbumEditor(withUsers([['u1', AlbumUserRole.Owner]]), 'u1')).toBe(true);
  });

  it('is true for an editor', () => {
    expect(
      isAlbumEditor(
        withUsers([
          ['u1', AlbumUserRole.Owner],
          ['u2', AlbumUserRole.Editor],
        ]),
        'u2',
      ),
    ).toBe(true);
  });

  it('is false for a viewer', () => {
    expect(
      isAlbumEditor(
        withUsers([
          ['u1', AlbumUserRole.Owner],
          ['u2', AlbumUserRole.Viewer],
        ]),
        'u2',
      ),
    ).toBe(false);
  });

  it('is false for someone with no role on the album', () => {
    expect(isAlbumEditor(withUsers([['u1', AlbumUserRole.Owner]]), 'u3')).toBe(false);
  });
});

describe('sortAlbums by DateCreated', () => {
  it('orders by the stored createdAt, newest first', () => {
    const albums = [
      A({ id: 'old', albumName: '1996', createdAt: '1996-06-15T14:30:00.000Z' }),
      A({ id: 'mid', albumName: '2010', createdAt: '2010-01-01T00:00:00.000Z' }),
      A({ id: 'new', albumName: '2026', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];

    const sorted = sortAlbums(albums, { sortBy: AlbumSortBy.DateCreated, orderBy: SortOrder.Desc });

    expect(sorted.map(({ albumName }) => albumName)).toEqual(['2026', '2010', '1996']);
  });

  it('orders oldest first when ascending', () => {
    const albums = [
      A({ id: 'new', albumName: '2026', createdAt: '2026-01-01T00:00:00.000Z' }),
      A({ id: 'old', albumName: '1996', createdAt: '1996-06-15T14:30:00.000Z' }),
    ];

    const sorted = sortAlbums(albums, { sortBy: AlbumSortBy.DateCreated, orderBy: SortOrder.Asc });

    expect(sorted.map(({ albumName }) => albumName)).toEqual(['1996', '2026']);
  });
});

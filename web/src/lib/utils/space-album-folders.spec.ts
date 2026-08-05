import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import {
  buildFolderTree,
  flattenForSearch,
  getFolderContents,
  getFolderPath,
  getFolderPreviewAssetIds,
  getRecursiveAlbumCount,
  isDescendant,
} from '$lib/utils/space-album-folders';

const folder = (id: string, name: string, parentId: string | null = null): SharedSpaceAlbumFolderDto =>
  ({
    id,
    spaceId: 'space-1',
    parentId,
    name,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as SharedSpaceAlbumFolderDto;

const album = (
  id: string,
  albumName: string,
  folderId: string | null = null,
  overrides: Partial<SharedSpaceLinkedAlbumDto> = {},
): SharedSpaceLinkedAlbumDto =>
  ({
    id,
    albumName,
    folderId,
    description: '',
    assetCount: 1,
    albumThumbnailAssetId: `asset-${id}`,
    endDate: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as SharedSpaceLinkedAlbumDto;

// Trips > 2026 > Italy, plus a sibling Family at the root.
const tripsTree = () => [
  folder('trips', 'Trips'),
  folder('y2026', '2026', 'trips'),
  folder('italy', 'Italy', 'y2026'),
  folder('family', 'Family'),
];

describe('space-album-folders', () => {
  describe('buildFolderTree', () => {
    // U-01
    it('U-01: nests folders under their parents and returns roots only at the top', () => {
      const tree = buildFolderTree(tripsTree());

      expect(tree.map((n) => n.folder.id)).toEqual(['trips', 'family']);
      expect(tree[0].children.map((n) => n.folder.id)).toEqual(['y2026']);
      const [year2026] = tree[0].children;
      expect(year2026.children.map((n) => n.folder.id)).toEqual(['italy']);
    });

    // U-02: the mid-flight-delete case. Another editor can delete a folder between our folder
    // fetch and our album fetch, leaving a child pointing at a parent we never received.
    // Treating it as a root keeps the page rendering instead of throwing.
    it('U-02: treats a folder with an unknown parent as a root and does not throw', () => {
      const orphan = folder('orphan', 'Orphan', 'deleted-folder');

      const tree = buildFolderTree([folder('trips', 'Trips'), orphan]);

      expect(tree.map((n) => n.folder.id).sort()).toEqual(['orphan', 'trips']);
    });

    it('U-02: does not loop forever on a self-referencing folder', () => {
      const cyclic = folder('loop', 'Loop', 'loop');

      expect(() => buildFolderTree([cyclic])).not.toThrow();
    });

    it('returns an empty array for no folders', () => {
      expect(buildFolderTree([])).toEqual([]);
    });
  });

  describe('getFolderPath', () => {
    // U-03
    it('U-03: returns the ancestor chain root-first', () => {
      const path = getFolderPath(tripsTree(), 'italy');

      expect(path.map((f) => f.name)).toEqual(['Trips', '2026', 'Italy']);
    });

    it('U-03: returns a single entry for a root folder', () => {
      expect(getFolderPath(tripsTree(), 'trips').map((f) => f.name)).toEqual(['Trips']);
    });

    it('U-03: returns an empty path for the space root', () => {
      expect(getFolderPath(tripsTree(), null)).toEqual([]);
    });

    // Deleting the folder you have open must degrade to the root, not throw — this is what
    // W-06's fallback relies on.
    it('U-03: returns an empty path for an unknown folder id', () => {
      expect(getFolderPath(tripsTree(), 'deleted')).toEqual([]);
    });
  });

  describe('getFolderContents', () => {
    // U-04
    it('U-04: returns only the folders and albums at this level', () => {
      const albums = [album('a1', 'Rome', 'y2026'), album('a2', 'Venice', 'italy'), album('a3', 'Loose')];

      const contents = getFolderContents(tripsTree(), albums, 'y2026');

      expect(contents.folders.map((f) => f.id)).toEqual(['italy']);
      expect(contents.albums.map((a) => a.id)).toEqual(['a1']);
    });

    it('U-04: returns root folders and unfiled albums for the space root', () => {
      const albums = [album('a1', 'Rome', 'y2026'), album('a3', 'Loose')];

      const contents = getFolderContents(tripsTree(), albums, null);

      expect(contents.folders.map((f) => f.id)).toEqual(['trips', 'family']);
      expect(contents.albums.map((a) => a.id)).toEqual(['a3']);
    });

    it('U-04: returns empty lists for an unknown folder id', () => {
      expect(getFolderContents(tripsTree(), [album('a1', 'Rome')], 'deleted')).toEqual({
        folders: [],
        albums: [],
      });
    });
  });

  describe('getRecursiveAlbumCount', () => {
    // U-05: a folder holding only subfolders would read "0 albums" under a direct count,
    // which is why the tile shows the recursive number.
    it('U-05: counts albums anywhere in the subtree', () => {
      const albums = [album('a1', 'Rome', 'y2026'), album('a2', 'Venice', 'italy'), album('a3', 'Loose')];

      expect(getRecursiveAlbumCount(tripsTree(), albums, 'trips')).toBe(2);
      expect(getRecursiveAlbumCount(tripsTree(), albums, 'y2026')).toBe(2);
      expect(getRecursiveAlbumCount(tripsTree(), albums, 'italy')).toBe(1);
      expect(getRecursiveAlbumCount(tripsTree(), albums, 'family')).toBe(0);
    });
  });

  describe('getFolderPreviewAssetIds', () => {
    // U-06
    it('U-06: returns at most four covers, newest first', () => {
      const albums = [
        album('a1', 'One', 'trips', { endDate: '2026-01-01T00:00:00.000Z' }),
        album('a2', 'Two', 'trips', { endDate: '2026-05-01T00:00:00.000Z' }),
        album('a3', 'Three', 'trips', { endDate: '2026-03-01T00:00:00.000Z' }),
        album('a4', 'Four', 'trips', { endDate: '2026-04-01T00:00:00.000Z' }),
        album('a5', 'Five', 'trips', { endDate: '2026-02-01T00:00:00.000Z' }),
      ];

      expect(getFolderPreviewAssetIds(tripsTree(), albums, 'trips')).toEqual([
        'asset-a2',
        'asset-a4',
        'asset-a3',
        'asset-a5',
      ]);
    });

    // Discriminates sort-then-slice from slice-then-sort: the newest album is LAST in the
    // input array. A slice-first implementation would drop it before ever comparing dates.
    it('U-06: the newest album wins even when it is last in the input array', () => {
      const albums = [
        album('a1', 'One', 'trips', { endDate: '2020-01-01T00:00:00.000Z' }),
        album('a2', 'Two', 'trips', { endDate: '2020-01-02T00:00:00.000Z' }),
        album('a3', 'Three', 'trips', { endDate: '2020-01-03T00:00:00.000Z' }),
        album('a4', 'Four', 'trips', { endDate: '2020-01-04T00:00:00.000Z' }),
        album('a5', 'Five', 'trips', { endDate: '2026-01-01T00:00:00.000Z' }),
      ];

      expect(getFolderPreviewAssetIds(tripsTree(), albums, 'trips')[0]).toBe('asset-a5');
    });

    it('U-06: draws covers from anywhere in the subtree', () => {
      const albums = [album('a1', 'Rome', 'italy')];

      expect(getFolderPreviewAssetIds(tripsTree(), albums, 'trips')).toEqual(['asset-a1']);
    });

    // U-07 — SpaceCollage already renders its own "empty" layout for this.
    it('U-07: returns an empty array for an empty folder', () => {
      expect(getFolderPreviewAssetIds(tripsTree(), [], 'family')).toEqual([]);
    });

    // U-08: getLinkedAlbums resolves the cover to null when no space-visible asset remains.
    // Emitting that null would render a broken tile — exactly the L17 bug the server-side
    // COALESCE exists to prevent.
    it('U-08: skips albums whose resolved cover is null', () => {
      const albums = [
        album('a1', 'No cover', 'trips', { albumThumbnailAssetId: null }),
        album('a2', 'Has cover', 'trips'),
      ];

      expect(getFolderPreviewAssetIds(tripsTree(), albums, 'trips')).toEqual(['asset-a2']);
    });
  });

  describe('isDescendant', () => {
    // U-09 — this is the client-side drop guard, so a bad drop fires no request at all.
    it('U-09: is true for descendants at any depth', () => {
      expect(isDescendant(tripsTree(), 'y2026', 'trips')).toBe(true);
      expect(isDescendant(tripsTree(), 'italy', 'trips')).toBe(true);
    });

    it('U-09: is false for ancestors, siblings, and self', () => {
      expect(isDescendant(tripsTree(), 'trips', 'italy')).toBe(false);
      expect(isDescendant(tripsTree(), 'family', 'trips')).toBe(false);
      expect(isDescendant(tripsTree(), 'trips', 'trips')).toBe(false);
    });

    it('U-09: is false when either id is unknown', () => {
      expect(isDescendant(tripsTree(), 'ghost', 'trips')).toBe(false);
      expect(isDescendant(tripsTree(), 'trips', 'ghost')).toBe(false);
    });
  });

  describe('flattenForSearch', () => {
    // U-10
    it('U-10: matches albums space-wide and labels each with its folder path', () => {
      const albums = [album('a1', 'Venice', 'y2026'), album('a2', 'Ventoux', 'italy'), album('a3', 'Rome')];

      const hits = flattenForSearch(tripsTree(), albums, 'ven');

      expect(hits.map((h) => h.album.id).sort()).toEqual(['a1', 'a2']);
      expect(hits.find((h) => h.album.id === 'a1')?.path).toEqual(['Trips', '2026']);
      expect(hits.find((h) => h.album.id === 'a2')?.path).toEqual(['Trips', '2026', 'Italy']);
    });

    it('U-10: gives a root album an empty path', () => {
      const hits = flattenForSearch(tripsTree(), [album('a3', 'Rome')], 'rome');

      expect(hits[0].path).toEqual([]);
    });

    it('U-10: matches case-insensitively and searches the description too', () => {
      const albums = [album('a1', 'Trip', null, { description: 'Amazing VENICE holiday' })];

      expect(flattenForSearch(tripsTree(), albums, 'venice')).toHaveLength(1);
    });

    // U-11: an empty query means "search is inactive", not "match everything". The caller
    // uses a non-empty query as the signal to switch into flattened mode at all.
    it.each([['', ' '.repeat(3)]])('U-11: returns nothing for a blank query (%p)', (query) => {
      expect(flattenForSearch(tripsTree(), [album('a1', 'Rome')], query)).toEqual([]);
    });
  });
});

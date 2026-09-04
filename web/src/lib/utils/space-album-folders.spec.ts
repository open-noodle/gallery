import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import {
  buildFolderSummaries,
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

    // A mutually-cyclic pair (neither self-referencing) gives each folder a "valid" parent in
    // the other, so a naive single pass never pushes either to `roots` and both silently vanish.
    it('does not drop a mutually-cyclic pair of folders', () => {
      const a = folder('a', 'A', 'b');
      const b = folder('b', 'B', 'a');

      const tree = buildFolderTree([a, b]);

      expect(tree.map((n) => n.folder.id).sort()).toEqual(['a', 'b']);
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

    // U-02's self-referencing case, but for getFolderContents: a folder with parentId === id
    // must not appear as a child of itself, or the UI would offer a folder you can navigate
    // into forever.
    it('does not list a self-referencing folder as its own child', () => {
      const cyclic = folder('loop', 'Loop', 'loop');

      expect(getFolderContents([cyclic], [], 'loop')).toEqual({ folders: [], albums: [] });
    });

    // T-08 (mirrored from mobile): a folder-link row for a folder we have not loaded yet is
    // routine mid-flight state (another editor's delete, or on mobile a sync race), not corrupt
    // input. The album must fall back to the ROOT rather than being hidden at every level.
    it('U-04: shows an album at the root when its folder is not loaded, instead of hiding it', () => {
      const albums = [album('a1', 'Rome', 'not-synced-yet')];

      const atRoot = getFolderContents(tripsTree(), albums, null);

      expect(atRoot.albums.map((a) => a.id)).toEqual(['a1']);
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
    // Two cases, not one: `[['', '   ']]` is a SINGLE case with two arguments, so `query` bound to
    // '' and the whitespace-only case never ran at all. It is the one that matters — it is what
    // proves flattenForSearch trims, and therefore that typing a single space does not flip the
    // page into flattened search mode with the folders and breadcrumb hidden.
    it.each([[''], [' '.repeat(3)]])('U-11: returns nothing for a blank query (%p)', (query) => {
      expect(flattenForSearch(tripsTree(), [album('a1', 'Rome')], query)).toEqual([]);
    });
  });

  describe('buildFolderSummaries', () => {
    // The batch pass and the single-folder functions are two implementations of one definition,
    // kept apart because the components need the batch one and the tests above pin the readable
    // one. This is what stops them drifting: for EVERY folder in each fixture, both must agree.
    // Run against the pathological shapes too, since those are exactly where a shared-index
    // rewrite is most likely to diverge.
    const fixtures: Array<[string, SharedSpaceAlbumFolderDto[], SharedSpaceLinkedAlbumDto[]]> = [
      ['an empty space', [], []],
      [
        'a nested tree with albums at several depths',
        tripsTree(),
        [
          album('a1', 'Rome', 'italy'),
          album('a2', 'Venice', 'y2026'),
          album('a3', 'Skiing', 'trips'),
          album('a4', 'Reunion', 'family'),
          album('a5', 'Unfiled'),
        ],
      ],
      [
        'a dangling parentId',
        [folder('trips', 'Trips'), folder('orphan', 'Orphan', 'gone')],
        [album('a1', 'Rome', 'orphan'), album('a2', 'Milan', 'trips')],
      ],
      [
        'a self-referencing folder',
        [{ ...folder('loop', 'Loop'), parentId: 'loop' } as SharedSpaceAlbumFolderDto],
        [album('a1', 'Rome', 'loop')],
      ],
      [
        'a two-folder cycle',
        [folder('a', 'A', 'b'), folder('b', 'B', 'a')],
        [album('a1', 'Rome', 'a'), album('a2', 'Milan', 'b')],
      ],
      [
        'albums whose cover is null',
        [folder('trips', 'Trips')],
        [
          album('a1', 'Rome', 'trips', { albumThumbnailAssetId: null }),
          album('a2', 'Milan', 'trips', { albumThumbnailAssetId: null }),
        ],
      ],
      [
        'more than four albums in one subtree',
        tripsTree(),
        Array.from({ length: 9 }, (_, i) =>
          album(`a${i}`, `Album ${i}`, 'italy', { endDate: `2026-0${(i % 9) + 1}-01T00:00:00.000Z` }),
        ),
      ],
    ];

    it.each(fixtures)('agrees with the single-folder functions for %s', (_name, folders, albums) => {
      const summaries = buildFolderSummaries(folders, albums);

      expect([...summaries.keys()].sort()).toEqual(folders.map((f) => f.id).sort());
      for (const { id } of folders) {
        expect(summaries.get(id)).toEqual({
          albumCount: getRecursiveAlbumCount(folders, albums, id),
          previewAssetIds: getFolderPreviewAssetIds(folders, albums, id),
        });
      }
    });

    // The whole point of the batch pass: cost must not grow with the number of folders times the
    // number of albums. Asserted as work done, not wall-clock, so it cannot flake on a busy
    // machine — a per-card implementation reads every album once PER FOLDER.
    it('scans the album list a bounded number of times, not once per folder', () => {
      const folders = Array.from({ length: 200 }, (_, i) => folder(`f${i}`, `Folder ${i}`));
      let folderIdReads = 0;
      const albums = Array.from({ length: 200 }, (_, i) => {
        const base = album(`a${i}`, `Album ${i}`, `f${i}`);
        return Object.defineProperty({ ...base }, 'folderId', {
          get() {
            folderIdReads++;
            return `f${i}`;
          },
        }) as SharedSpaceLinkedAlbumDto;
      });

      buildFolderSummaries(folders, albums);

      // Exactly one bucketing pass, one read per album. The per-card shape this replaced read
      // folderId once per album PER FOLDER, twice over (count + previews) — 200 x 200 x 2.
      expect(folderIdReads).toBe(albums.length);
    });
  });
});

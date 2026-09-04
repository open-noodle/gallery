import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';

export type FolderNode = {
  folder: SharedSpaceAlbumFolderDto;
  children: FolderNode[];
};

export type SearchHit = {
  album: SharedSpaceLinkedAlbumDto;
  path: string[];
};

const FOLDER_PREVIEW_LIMIT = 4;

/**
 * Every function here is total over the two arrays the albums page already holds. They must
 * never throw on inconsistent input: another editor can delete a folder between our folder
 * fetch and our album fetch, so a `parentId` pointing at a folder we never received is normal,
 * not exceptional. Such a folder is treated as a root.
 */
const byId = (folders: SharedSpaceAlbumFolderDto[]) => new Map(folders.map((f) => [f.id, f]));

/** Walks parent links upward, guarding against a cycle in malformed data. */
const ancestorsOf = (index: Map<string, SharedSpaceAlbumFolderDto>, folderId: string): SharedSpaceAlbumFolderDto[] => {
  const chain: SharedSpaceAlbumFolderDto[] = [];
  const seen = new Set<string>();
  let current = index.get(folderId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }

  return chain;
};

export const buildFolderTree = (folders: SharedSpaceAlbumFolderDto[]): FolderNode[] => {
  const index = byId(folders);
  const nodes = new Map<string, FolderNode>(folders.map((f) => [f.id, { folder: f, children: [] }]));
  const roots: FolderNode[] = [];

  for (const folder of folders) {
    const node = nodes.get(folder.id)!;
    // A self-referencing parentId, or one we never received, both resolve to "root".
    const parent =
      folder.parentId && folder.parentId !== folder.id && index.has(folder.parentId)
        ? nodes.get(folder.parentId)
        : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // A cycle among two or more folders (e.g. A.parentId = B, B.parentId = A — neither
  // self-referencing) gives every node in the cycle a "valid" parent above, so none of them is
  // ever pushed to `roots`, and the whole cycle silently vanishes from the returned tree. Sweep
  // reachability from the roots we do have, then promote anything unreached — severing it from
  // whatever cyclic parent it was attached to, so a promoted node doesn't also linger as a child
  // inside a structure that would recurse forever. Both passes are O(n): the sweep visits each
  // node once, and the total work across all `.filter()` calls is bounded by the total number of
  // child-list entries, which is at most n.
  const reached = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (reached.has(node.folder.id)) {
      continue;
    }
    reached.add(node.folder.id);
    stack.push(...node.children);
  }

  for (const folder of folders) {
    if (reached.has(folder.id)) {
      continue;
    }
    const node = nodes.get(folder.id)!;
    const cyclicParent = folder.parentId ? nodes.get(folder.parentId) : undefined;
    if (cyclicParent) {
      cyclicParent.children = cyclicParent.children.filter((c) => c.folder.id !== folder.id);
    }
    roots.push(node);
  }

  return roots;
};

export const getFolderPath = (
  folders: SharedSpaceAlbumFolderDto[],
  folderId: string | null,
): SharedSpaceAlbumFolderDto[] => {
  if (!folderId) {
    return [];
  }
  return ancestorsOf(byId(folders), folderId).reverse();
};

export const getFolderContents = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string | null,
): { folders: SharedSpaceAlbumFolderDto[]; albums: SharedSpaceLinkedAlbumDto[] } => {
  const index = byId(folders);

  if (folderId !== null && !index.has(folderId)) {
    return { folders: [], albums: [] };
  }

  const isRoot = (folder: SharedSpaceAlbumFolderDto) =>
    !folder.parentId || folder.parentId === folder.id || !index.has(folder.parentId);

  // T-08 (mirrored from mobile): an album whose folderId names a folder we have not loaded yet
  // falls back to the ROOT rather than being hidden. Another editor can delete a folder — or, on
  // mobile, sync can deliver the album-link row before the folder row — between our folder fetch
  // and our album fetch; either way an album vanishing from the grid is the worse failure.
  const effectiveFolderId = (album: SharedSpaceLinkedAlbumDto): string | null =>
    album.folderId && index.has(album.folderId) ? album.folderId : null;

  return {
    // A self-referencing folder (parentId === id) is a root per `isRoot` above — it must not
    // also satisfy `f.parentId === folderId` and list itself as its own child (U-02's case).
    folders: folders.filter((f) => (folderId === null ? isRoot(f) : f.parentId === folderId && f.id !== folderId)),
    albums: albums.filter((a) => effectiveFolderId(a) === folderId),
  };
};

const subtreeIds = (folders: SharedSpaceAlbumFolderDto[], folderId: string): Set<string> => {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId && folder.parentId !== folder.id) {
      childrenByParent.set(folder.parentId, [...(childrenByParent.get(folder.parentId) ?? []), folder.id]);
    }
  }

  const ids = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (ids.has(current)) {
      continue;
    }
    ids.add(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return ids;
};

const albumsInSubtree = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string,
): SharedSpaceLinkedAlbumDto[] => {
  const ids = subtreeIds(folders, folderId);
  return albums.filter((a) => a.folderId && ids.has(a.folderId));
};

export const getRecursiveAlbumCount = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string,
): number => albumsInSubtree(folders, albums, folderId).length;

/** Recency key: an album's newest photo, falling back to its own updatedAt when undated. */
const recencyOf = (album: SharedSpaceLinkedAlbumDto): number =>
  new Date(album.endDate ?? album.updatedAt ?? 0).getTime();

/**
 * Newest first, ties broken by id.
 *
 * The tie-break is not cosmetic. Albums routinely share a recency — a bulk import lands many in
 * the same tick, and an album with no photos falls back to a timestamp it shares with its
 * siblings. Without a total order, which four covers a folder shows depends on the order the
 * albums happen to arrive in, so the same folder can render a different collage after a refetch,
 * and two callers that walk the space differently disagree about the same folder. Mobile's
 * `_byRecencyThenId` is the same comparator, for the same reason.
 */
const byRecencyThenId = (a: SharedSpaceLinkedAlbumDto, b: SharedSpaceLinkedAlbumDto): number =>
  recencyOf(b) - recencyOf(a) || a.id.localeCompare(b.id);

export const getFolderPreviewAssetIds = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string,
): string[] =>
  albumsInSubtree(folders, albums, folderId)
    // A null cover means getLinkedAlbums found no space-visible asset. Emitting it would
    // render a broken tile, which is the exact bug the server-side COALESCE prevents.
    .filter((a) => a.albumThumbnailAssetId !== null)
    .sort(byRecencyThenId)
    .slice(0, FOLDER_PREVIEW_LIMIT)
    .map((a) => a.albumThumbnailAssetId as string);

export type FolderSummary = { albumCount: number; previewAssetIds: string[] };

export const EMPTY_FOLDER_SUMMARY: FolderSummary = { albumCount: 0, previewAssetIds: [] };

/**
 * Every folder's recursive album count and preview covers, in one pass over the space.
 *
 * `getRecursiveAlbumCount` and `getFolderPreviewAssetIds` are each O(folders + albums) on their
 * own — both rebuild the parent index and re-scan every album in the space. Calling them from a
 * card's props, once per rendered folder, makes a level of F folders cost O(F × (folders +
 * albums)) and re-pays it on every reactive change. At this feature's own limits (500 folders per
 * space, and `GET /:id/albums` deliberately unpaginated) that is millions of array operations per
 * render.
 *
 * Here the two indexes are built once and shared, so each folder only walks its own subtree:
 * O(folders × depth + albums) for the whole level, with depth capped at 10 server-side.
 *
 * Cycle and dangling-parent behaviour is deliberately identical to the single-folder functions —
 * self-references are not treated as children, and the `seen` set terminates any longer cycle,
 * with every member of it counting the others' albums exactly as `subtreeIds` does. The
 * "agrees with the single-folder functions" test pins that equivalence so the two cannot drift.
 */
export const buildFolderSummaries = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
): Map<string, FolderSummary> => {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    const parentId = folder.parentId;
    // A self-reference is not a child of itself — same rule as `subtreeIds`.
    if (!parentId || parentId === folder.id) {
      continue;
    }
    const siblings = childrenByParent.get(parentId);
    if (siblings) {
      siblings.push(folder.id);
    } else {
      childrenByParent.set(parentId, [folder.id]);
    }
  }

  const albumsByFolder = new Map<string, SharedSpaceLinkedAlbumDto[]>();
  for (const album of albums) {
    const folderId = album.folderId;
    if (!folderId) {
      continue;
    }
    const bucket = albumsByFolder.get(folderId);
    if (bucket) {
      bucket.push(album);
    } else {
      albumsByFolder.set(folderId, [album]);
    }
  }

  const summaries = new Map<string, FolderSummary>();
  const seen = new Set<string>();
  const stack: string[] = [];

  for (const folder of folders) {
    seen.clear();
    stack.length = 0;
    stack.push(folder.id);

    let albumCount = 0;
    const withCovers: SharedSpaceLinkedAlbumDto[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);

      for (const album of albumsByFolder.get(current) ?? []) {
        albumCount++;
        // A null cover means getLinkedAlbums found no space-visible asset; it still counts
        // toward the album total, but emitting it would render a broken tile.
        if (album.albumThumbnailAssetId !== null) {
          withCovers.push(album);
        }
      }

      const children = childrenByParent.get(current);
      if (children) {
        stack.push(...children);
      }
    }

    summaries.set(folder.id, {
      albumCount,
      previewAssetIds: withCovers
        .sort(byRecencyThenId)
        .slice(0, FOLDER_PREVIEW_LIMIT)
        .map((a) => a.albumThumbnailAssetId as string),
    });
  }

  return summaries;
};

export const isDescendant = (
  folders: SharedSpaceAlbumFolderDto[],
  candidateId: string,
  ancestorId: string,
): boolean => {
  const index = byId(folders);
  if (!index.has(candidateId) || !index.has(ancestorId) || candidateId === ancestorId) {
    return false;
  }
  return ancestorsOf(index, candidateId)
    .slice(1)
    .some((f) => f.id === ancestorId);
};

export const flattenForSearch = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  query: string,
): SearchHit[] => {
  const needle = (query ?? '').trim().toLowerCase();
  // A blank query means "search is inactive", not "match everything" — the caller uses a
  // non-empty query as the signal to switch into flattened mode at all.
  if (!needle) {
    return [];
  }

  const index = byId(folders);

  return albums
    .filter((a) => a.albumName.toLowerCase().includes(needle) || (a.description ?? '').toLowerCase().includes(needle))
    .map((album) => ({
      album,
      path: album.folderId
        ? ancestorsOf(index, album.folderId)
            .reverse()
            .map((f) => f.name)
        : [],
    }));
};

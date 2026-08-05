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

  return {
    folders: folders.filter((f) => (folderId === null ? isRoot(f) : f.parentId === folderId)),
    albums: albums.filter((a) => (a.folderId ?? null) === folderId),
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

export const getFolderPreviewAssetIds = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  folderId: string,
): string[] =>
  albumsInSubtree(folders, albums, folderId)
    // A null cover means getLinkedAlbums found no space-visible asset. Emitting it would
    // render a broken tile, which is the exact bug the server-side COALESCE prevents.
    .filter((a) => a.albumThumbnailAssetId !== null)
    .slice(0, FOLDER_PREVIEW_LIMIT)
    .sort((a, b) => recencyOf(b) - recencyOf(a))
    .map((a) => a.albumThumbnailAssetId as string);

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

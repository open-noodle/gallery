import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';

class FolderNode {
  FolderNode(this.folder) : children = [];
  final SpaceAlbumFolder folder;
  final List<FolderNode> children;
}

class FolderSearchHit {
  const FolderSearchHit(this.album, this.path);
  final SpaceAlbum album;
  final List<String> path;
}

const _previewLimit = 4;

/// Every function here is TOTAL: it must never throw and never loop, on a dangling parentId, a
/// self-reference, or a cycle. Sync makes no ordering guarantee, so those are normal mid-sync
/// states, not corrupt input.
Map<String, SpaceAlbumFolder> _byId(List<SpaceAlbumFolder> folders) => {for (final f in folders) f.id: f};

/// Walks parent links upward with a visited guard, so any cycle terminates.
List<SpaceAlbumFolder> _ancestors(Map<String, SpaceAlbumFolder> index, String folderId) {
  final chain = <SpaceAlbumFolder>[];
  final seen = <String>{};
  var current = index[folderId];
  while (current != null && seen.add(current.id)) {
    chain.add(current);
    final parentId = current.parentId;
    current = parentId == null ? null : index[parentId];
  }
  return chain;
}

/// A folder is a root when it has no parent, its parent is absent (not yet synced), or it is a
/// member of a cycle — including the length-1 case, a self-reference. Cycle membership must be
/// decided HERE, not patched after the fact: a folder hanging below a cycle member (not itself in
/// the cycle) still needs to nest normally under it, and only classifying at construction time
/// keeps that distinction intact.
bool _isRoot(Map<String, SpaceAlbumFolder> index, SpaceAlbumFolder f) {
  final parentId = f.parentId;
  if (parentId == null || !index.containsKey(parentId)) return true;
  return _isCycleMember(index, f);
}

/// True when walking the parent chain up from [f] eventually arrives back at [f] itself. Guarded
/// with a `seen` set keyed by id, so any cycle length terminates the walk in at most
/// `index.length` steps instead of looping.
bool _isCycleMember(Map<String, SpaceAlbumFolder> index, SpaceAlbumFolder f) {
  final seen = <String>{};
  var current = index[f.parentId];
  while (current != null && seen.add(current.id)) {
    if (current.id == f.id) return true;
    final parentId = current.parentId;
    current = parentId == null ? null : index[parentId];
  }
  return false;
}

List<FolderNode> buildFolderTree(List<SpaceAlbumFolder> folders) {
  final index = _byId(folders);
  final nodes = {for (final f in folders) f.id: FolderNode(f)};
  final roots = <FolderNode>[];

  for (final f in folders) {
    final node = nodes[f.id]!;
    if (_isRoot(index, f)) {
      roots.add(node);
    } else {
      nodes[f.parentId]!.children.add(node);
    }
  }

  // No unreachable-node promotion pass is needed here (there used to be one; it was removed —
  // see the mobile Task 6 review). `_isRoot` now classifies every cycle member, including
  // self-references, as a root at construction time. Every other folder's parent chain is
  // therefore guaranteed to terminate at a root (null parent, a dangling parent, or a cycle
  // member) within `folders.length` steps, so it gets attached under a real node instead of being
  // orphaned. A regression that reintroduced an unreachable node would show up as a missing id in
  // `buildFolderTree`'s output or a cycle in `.children` — both are asserted by the T-04 group in
  // `space_album_folders_test.dart`.
  return roots;
}

List<SpaceAlbumFolder> folderPath(List<SpaceAlbumFolder> folders, String? folderId) {
  if (folderId == null) return const [];
  return _ancestors(_byId(folders), folderId).reversed.toList();
}

({List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums}) folderContents(
  List<SpaceAlbumFolder> folders,
  List<SpaceAlbum> albums,
  String? folderId,
) {
  final index = _byId(folders);
  if (folderId != null && !index.containsKey(folderId)) {
    return (folders: const [], albums: const []);
  }

  // T-08: an album whose folderId names a folder we have not synced yet falls back to the ROOT,
  // rather than being hidden at every level. On mobile this is routine, not exotic.
  String? effectiveFolder(SpaceAlbum a) => a.folderId != null && index.containsKey(a.folderId) ? a.folderId : null;

  return (
    folders: folders
        .where((f) => folderId == null ? _isRoot(index, f) : f.parentId == folderId && f.id != folderId)
        .toList(),
    albums: albums.where((a) => effectiveFolder(a) == folderId).toList(),
  );
}

Set<String> _subtreeIds(List<SpaceAlbumFolder> folders, String folderId) {
  final childrenByParent = <String, List<String>>{};
  for (final f in folders) {
    if (f.parentId != null && f.parentId != f.id) {
      childrenByParent.putIfAbsent(f.parentId!, () => []).add(f.id);
    }
  }
  final ids = <String>{};
  final stack = [folderId];
  while (stack.isNotEmpty) {
    final current = stack.removeLast();
    if (!ids.add(current)) continue;
    stack.addAll(childrenByParent[current] ?? const []);
  }
  return ids;
}

List<SpaceAlbum> _albumsInSubtree(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String folderId) {
  final ids = _subtreeIds(folders, folderId);
  return albums.where((a) => a.folderId != null && ids.contains(a.folderId)).toList();
}

int recursiveAlbumCount(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String folderId) =>
    _albumsInSubtree(folders, albums, folderId).length;

List<SpaceAlbum> folderPreviewAlbums(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String folderId) {
  // Filter, then sort, then take — in that exact order.
  //
  // Filter: a null thumbnailAssetId means the album has no space-visible cover (it's empty, or
  // its only asset isn't visible in this space). Emitting it renders a broken tile — the exact
  // bug the server-side COALESCE prevents. This has to happen before the take: the take can only
  // ever shrink what a caller later filters, never recover a good cover it already discarded, so
  // filtering after the take can silently return an all-blank collage while good covers sit
  // further down the list.
  //
  // Sort (after filtering) then take, never take then sort: take-then-sort returns an arbitrary
  // subset — the web implementation shipped that bug once and it is invisible unless the newest
  // album sits late in the list.
  //
  // The comparator also breaks ties on `id`: List.sort() is not guaranteed stable above ~32
  // elements, so relying on input order to break `updatedAt` ties (e.g. a bulk import landing many
  // albums in the same tick) could reshuffle the 4-item preview between rebuilds. Ordering fully
  // by (updatedAt desc, id asc) makes the result independent of the sort algorithm's stability.
  final withCovers = _albumsInSubtree(folders, albums, folderId).where((a) => a.thumbnailAssetId != null).toList()
    ..sort(_byRecencyThenId);
  return withCovers.take(_previewLimit).toList();
}

int _byRecencyThenId(SpaceAlbum a, SpaceAlbum b) {
  final byDate = b.updatedAt.compareTo(a.updatedAt);
  return byDate != 0 ? byDate : a.id.compareTo(b.id);
}

bool isDescendant(List<SpaceAlbumFolder> folders, String candidateId, String ancestorId) {
  final index = _byId(folders);
  if (!index.containsKey(candidateId) || !index.containsKey(ancestorId) || candidateId == ancestorId) {
    return false;
  }
  return _ancestors(index, candidateId).skip(1).any((f) => f.id == ancestorId);
}

List<FolderSearchHit> flattenForSearch(List<SpaceAlbumFolder> folders, List<SpaceAlbum> albums, String query) {
  final needle = query.trim().toLowerCase();
  // A blank query means "search is inactive", not "match everything" — the caller uses a non-empty
  // query as the signal to switch into flattened mode at all.
  if (needle.isEmpty) return const [];

  final index = _byId(folders);
  return albums.where((a) => a.name.toLowerCase().contains(needle)).map((a) {
    final path = a.folderId == null ? <String>[] : _ancestors(index, a.folderId!).reversed.map((f) => f.name).toList();
    return FolderSearchHit(a, path);
  }).toList();
}

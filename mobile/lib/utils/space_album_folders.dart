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

bool _isRoot(Map<String, SpaceAlbumFolder> index, SpaceAlbumFolder f) =>
    f.parentId == null || f.parentId == f.id || !index.containsKey(f.parentId);

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

  // A mutual cycle leaves nodes that are neither roots nor reachable from one. Promote them, or
  // they vanish from the tree entirely — worse than showing them at the wrong level.
  final reached = <String>{};
  final stack = [...roots];
  while (stack.isNotEmpty) {
    final node = stack.removeLast();
    if (!reached.add(node.folder.id)) continue;
    stack.addAll(node.children);
  }
  for (final f in folders) {
    if (!reached.contains(f.id)) {
      roots.add(nodes[f.id]!);
      reached.add(f.id);
    }
  }

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
  // Sort FIRST, then take. Take-then-sort returns an arbitrary subset — the web implementation
  // shipped that bug once and it is invisible unless the newest album sits late in the list.
  final inSubtree = _albumsInSubtree(folders, albums, folderId)..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  return inSubtree.take(_previewLimit).toList();
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

/// Domain model for a shared-space album folder, backed by
/// [SharedSpaceAlbumFolderEntity] / the SharedSpaceAlbumFolderV1 wire stream.
class SpaceAlbumFolder {
  const SpaceAlbumFolder({required this.id, required this.spaceId, required this.parentId, required this.name});

  final String id;
  final String spaceId;
  final String? parentId;
  final String name;
}

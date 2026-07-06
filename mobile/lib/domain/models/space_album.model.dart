/// Domain model for a shared-space album link, produced by
/// [SpaceAlbumRepository.watchLinkedAlbums].
///
/// Combines the album metadata (from [SharedSpaceAlbumEntity] / the
/// SharedSpaceAlbumV1 wire stream) with the per-space link fields
/// (from [SharedSpaceAlbumLinkEntity] / the SharedSpaceAlbumLinkV1 wire
/// stream) for a single reactive join result.
class SpaceAlbum {
  final String id;
  final String name;
  final String? thumbnailAssetId;
  final bool showInTimeline;
  final int assetCount;

  const SpaceAlbum({
    required this.id,
    required this.name,
    this.thumbnailAssetId,
    required this.showInTimeline,
    this.assetCount = 0,
  });
}

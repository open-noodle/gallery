import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';

/// Fixed height of the Albums shelf when it is visible (at least one album
/// or the editor empty-state). This is the value that should be summed with
/// [kSyncStatusBannerSliverHeight] in [SpaceTopSliver._topSliverHeight].
///
/// Breakdown:
///   header row (32) + tile (112) + album name below (20) + padding (16×2) = 196
const double kSpaceAlbumsShelfHeight = 196.0;

/// Tile size for cover art — square, radius 16 per design.
const double _kTileSize = 112.0;
const double _kTileRadius = 16.0;

/// Albums shelf rendered as a horizontal scroll strip at the top of the space
/// timeline. Three visibility cases (§10.3 B2 / mobile design §Surface 1):
///
///  1. [albums] not empty → cover tiles + (if [canEdit]) trailing Link tile.
///  2. [albums] empty && [canEdit] → slim shelf with only the Link tile.
///  3. [albums] empty && !canEdit  → nothing ([SizedBox.shrink]).
///
/// Cover tiles apply a ~60% dim + [Icons.visibility_off] badge when the album
/// has [SpaceAlbum.showInTimeline] == false (off-timeline indicator).
///
/// When [SpaceAlbum.thumbnailAssetId] is null or the cover is not yet locally
/// synced, a [Icons.photo_album_outlined] fallback on [surfaceContainerHighest]
/// is shown (reuses the album_tile.dart D4 pattern without FutureBuilder since
/// the shelf has no assetService access — a null thumbnailAssetId is enough to
/// trigger the fallback unconditionally; B4 can wire real thumbnail loads if
/// needed).
///
/// Callbacks [onLinkTap] and [onAlbumTap] are **no-op stubs in B2** — B4 wires
/// album-tap navigation and B5 wires the link picker.
/// [onSeeAll] is wired in B3 to push [SpaceAlbumsRoute].
class SpaceAlbumsShelf extends ConsumerWidget {
  const SpaceAlbumsShelf({
    super.key,
    required this.spaceId,
    required this.canEdit,
    required this.onLinkTap,
    required this.onAlbumTap,
    this.onSeeAll,
  });

  final String spaceId;
  final bool canEdit;
  final VoidCallback onLinkTap;
  final void Function(String albumId) onAlbumTap;

  /// Called when the "See all ▸" header tap is fired. If null, the "See all"
  /// text is non-tappable (visual only). B3 wires this to push [SpaceAlbumsRoute].
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final albumsAsync = ref.watch(spaceAlbumsProvider(spaceId));

    return albumsAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (albums) => _buildShelf(context, albums),
    );
  }

  Widget _buildShelf(BuildContext context, List<SpaceAlbum> albums) {
    // Case 3: viewer + no albums → hide entirely
    if (albums.isEmpty && !canEdit) {
      return const SizedBox.shrink();
    }

    return SizedBox(
      key: const Key('space-albums-shelf'),
      height: kSpaceAlbumsShelfHeight,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row: "Albums (N)  See all ▸"
          _HeaderRow(count: albums.length, showSeeAll: albums.isNotEmpty, onSeeAll: onSeeAll),
          const SizedBox(height: 8),
          // Horizontal scroll of tiles
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: albums.length + (canEdit ? 1 : 0),
              separatorBuilder: (_, _) => const SizedBox(width: 10),
              itemBuilder: (context, index) {
                if (index < albums.length) {
                  final album = albums[index];
                  return _SpaceAlbumCoverTile(
                    key: Key('space-album-tile-${album.id}'),
                    album: album,
                    onTap: () => onAlbumTap(album.id),
                  );
                }
                // Link tile (editor-only, always last)
                return _LinkTile(
                  key: const Key('space-album-link-tile'),
                  onTap: onLinkTap,
                  label: albums.isEmpty ? context.t.space_albums_empty_editor_cta : context.t.link,
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Internal widgets
// ---------------------------------------------------------------------------

class _HeaderRow extends StatelessWidget {
  const _HeaderRow({required this.count, required this.showSeeAll, this.onSeeAll});
  final int count;
  final bool showSeeAll;
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            context.t.space_albums_shelf_title(count: count),
            style: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
          ),
          if (showSeeAll)
            GestureDetector(
              onTap: onSeeAll,
              child: Text(
                context.t.space_albums_see_all,
                style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.primary),
              ),
            ),
        ],
      ),
    );
  }
}

/// A single cover tile.
///
/// Cover strategy (album_tile.dart FutureBuilder pattern):
///   - If [album.thumbnailAssetId] is null → show [Icons.photo_album_outlined]
///     on [surfaceContainerHighest] immediately (cover is not yet synced).
///   - Otherwise → look up the asset via [assetServiceProvider.getRemoteAsset]
///     and render [Thumbnail.remote] when it resolves; falls back to the same
///     placeholder icon while loading or when the asset is not found.
///
/// Off-timeline dim: ~60 % opacity via [Color.withValues(alpha:)] on the
/// tile + [Icons.visibility_off] badge. [withOpacity] is banned by `dart
/// analyze --fatal-infos` (replaced by [withValues(alpha:)] in Material 3).
class _SpaceAlbumCoverTile extends ConsumerWidget {
  const _SpaceAlbumCoverTile({super.key, required this.album, required this.onTap});

  final SpaceAlbum album;
  final VoidCallback onTap;

  Widget _buildFallback(ColorScheme cs) {
    return Container(
      width: _kTileSize,
      height: _kTileSize,
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(Radius.circular(_kTileRadius)),
        border: Border.all(color: cs.outline.withValues(alpha: 0.3), width: 1),
      ),
      child: const Icon(Icons.photo_album_outlined, size: 32, color: Colors.grey),
    );
  }

  Widget _buildCoverArt(BuildContext context, WidgetRef ref, ColorScheme cs) {
    final thumbnailId = album.thumbnailAssetId;
    if (thumbnailId == null) {
      return _buildFallback(cs);
    }
    return FutureBuilder<RemoteAsset?>(
      future: ref.read(assetServiceProvider).getRemoteAsset(thumbnailId),
      builder: (context, snapshot) {
        if (snapshot.hasData && snapshot.data != null) {
          return ClipRRect(
            borderRadius: const BorderRadius.all(Radius.circular(_kTileRadius)),
            child: SizedBox(
              width: _kTileSize,
              height: _kTileSize,
              child: Thumbnail.remote(remoteId: thumbnailId, thumbhash: snapshot.data!.thumbHash ?? ''),
            ),
          );
        }
        return _buildFallback(cs);
      },
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = context.colorScheme;
    final isOffTimeline = !album.showInTimeline;

    return GestureDetector(
      // Cover art is an image/placeholder that does not register in hit-testing,
      // so the default deferToChild behavior would ignore taps on the cover
      // (only the name Text below was hittable). Opaque makes the whole tile tap.
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: SizedBox(
        width: _kTileSize,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Cover art (with optional dim + badge for off-timeline)
            Stack(
              children: [
                // Cover background / thumbnail
                Opacity(opacity: isOffTimeline ? 0.6 : 1.0, child: _buildCoverArt(context, ref, cs)),
                // Off-timeline badge
                if (isOffTimeline)
                  Positioned.fill(
                    child: Center(
                      child: Icon(Icons.visibility_off, size: 20, color: cs.onSurface.withValues(alpha: 0.7)),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            // Album name
            Text(
              album.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }
}

/// Dashed "Link" tile for editors — last in the horizontal list.
class _LinkTile extends StatelessWidget {
  const _LinkTile({super.key, required this.onTap, required this.label});

  final VoidCallback onTap;
  final String label;

  @override
  Widget build(BuildContext context) {
    final cs = context.colorScheme;

    return GestureDetector(
      // Match the cover tiles: the dashed box / icon do not fully register in
      // hit-testing, so make the whole Link tile tappable.
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: SizedBox(
        width: _kTileSize,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CustomPaint(
              painter: _DashedBorderPainter(color: cs.outline.withValues(alpha: 0.5), radius: _kTileRadius),
              child: Container(
                width: _kTileSize,
                height: _kTileSize,
                decoration: BoxDecoration(
                  color: cs.surfaceContainer,
                  borderRadius: const BorderRadius.all(Radius.circular(_kTileRadius)),
                ),
                child: Icon(Icons.add, size: 28, color: cs.primary),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500, color: cs.primary),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints a dashed rectangular border with rounded corners.
class _DashedBorderPainter extends CustomPainter {
  const _DashedBorderPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    const dashWidth = 5.0;
    const dashSpace = 4.0;
    final rrect = RRect.fromRectAndRadius(Rect.fromLTWH(0, 0, size.width, size.height), Radius.circular(radius));
    final path = Path()..addRRect(rrect);
    final metrics = path.computeMetrics();
    for (final metric in metrics) {
      double distance = 0;
      while (distance < metric.length) {
        canvas.drawPath(metric.extractPath(distance, distance + dashWidth), paint);
        distance += dashWidth + dashSpace;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBorderPainter oldDelegate) => oldDelegate.color != color || oldDelegate.radius != radius;
}

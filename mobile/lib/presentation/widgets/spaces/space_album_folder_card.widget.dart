import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';

/// Folder tile shown in the space-albums grid.
///
/// Mirrors the album card's structure (`_AlbumCard` in `space_albums.page.dart`)
/// -- cover area, name, count -- so the two line up in the same 2-column grid.
///
/// [albumCount] is the RECURSIVE count (`recursiveAlbumCount`), not just the
/// albums directly inside this folder, so a folder holding only subfolders
/// never reads "0 albums" (U-12).
///
/// [previewAlbums] is expected to already be narrowed by `folderPreviewAlbums`
/// at most four albums, newest first, each with a non-null
/// `thumbnailAssetId`. This widget does not re-filter or re-sort it, and lays
/// out correctly whether it receives 0, 1, 2, 3 or 4 covers -- an empty list
/// falls back to a folder glyph rather than rendering broken/blank tiles.
///
/// The overflow menu (Rename / Move to folder… / Delete) is keyed
/// `space-album-folder-card-menu` and rendered only when [canEdit] is true
/// (U-06) -- viewers get no management affordances at all.
class SpaceAlbumFolderCard extends StatelessWidget {
  const SpaceAlbumFolderCard({
    super.key,
    required this.folder,
    required this.albumCount,
    required this.previewAlbums,
    required this.canEdit,
    this.onTap,
    this.onRename,
    this.onMove,
    this.onDelete,
  });

  final SpaceAlbumFolder folder;
  final int albumCount;
  final List<SpaceAlbum> previewAlbums;
  final bool canEdit;
  final VoidCallback? onTap;
  final VoidCallback? onRename;
  final VoidCallback? onMove;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final cs = context.colorScheme;

    return GestureDetector(
      // The cover collage / fallback glyph do not register themselves in
      // hit-testing, so the default deferToChild behavior would make a tap on
      // the cover -- where users actually tap -- a no-op. Opaque makes the
      // whole card tappable, matching `_AlbumCard`.
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: ClipRRect(
                    borderRadius: const BorderRadius.all(Radius.circular(16)),
                    child: _FolderCoverCollage(previewAlbums: previewAlbums),
                  ),
                ),
                // Badge, so a folder is never mistaken for an album at a glance.
                Positioned(
                  left: 8,
                  bottom: 8,
                  child: Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.55), shape: BoxShape.circle),
                    child: const Icon(Icons.folder, size: 16, color: Colors.white),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      folder.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
                    ),
                    Text(
                      context.t.space_album_folder_albums_count(count: albumCount.toString()),
                      style: context.textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              if (canEdit)
                SizedBox(
                  width: 24,
                  height: 24,
                  child: PopupMenuButton<_FolderCardAction>(
                    key: const Key('space-album-folder-card-menu'),
                    padding: EdgeInsets.zero,
                    iconSize: 18,
                    onSelected: (action) {
                      switch (action) {
                        case _FolderCardAction.rename:
                          onRename?.call();
                        case _FolderCardAction.move:
                          onMove?.call();
                        case _FolderCardAction.delete:
                          onDelete?.call();
                      }
                    },
                    itemBuilder: (ctx) => [
                      PopupMenuItem(
                        key: const Key('space-album-folder-card-rename'),
                        value: _FolderCardAction.rename,
                        child: Text(ctx.t.space_album_folder_rename),
                      ),
                      PopupMenuItem(
                        key: const Key('space-album-folder-card-move'),
                        value: _FolderCardAction.move,
                        child: Text(ctx.t.space_album_folder_move),
                      ),
                      PopupMenuItem(
                        key: const Key('space-album-folder-card-delete'),
                        value: _FolderCardAction.delete,
                        child: Text(ctx.t.space_album_folder_delete),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

enum _FolderCardAction { rename, move, delete }

// ---------------------------------------------------------------------------
// Cover collage
// ---------------------------------------------------------------------------

/// Lays out up to four cover thumbnails. Branches on the exact count instead
/// of always assuming four, so 0/1/2/3-cover folders render a complete
/// collage rather than broken or blank tiles in the missing quadrants:
///   - 0: a centered folder glyph on a neutral background.
///   - 1: a single image filling the square.
///   - 2-3: one tall tile on the left, 1-2 stacked tiles on the right.
///   - 4: a 2x2 grid.
class _FolderCoverCollage extends ConsumerWidget {
  const _FolderCoverCollage({required this.previewAlbums});

  final List<SpaceAlbum> previewAlbums;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = context.colorScheme;
    final count = previewAlbums.length;

    if (count == 0) {
      return _buildEmptyState(cs);
    }
    if (count == 1) {
      return _buildTile(context, ref, previewAlbums[0]);
    }
    if (count <= 3) {
      return Row(
        children: [
          Expanded(child: _buildTile(context, ref, previewAlbums[0])),
          const SizedBox(width: 2),
          Expanded(
            child: Column(
              children: [
                Expanded(child: _buildTile(context, ref, previewAlbums[1])),
                if (count == 3) ...[
                  const SizedBox(height: 2),
                  Expanded(child: _buildTile(context, ref, previewAlbums[2])),
                ],
              ],
            ),
          ),
        ],
      );
    }
    // count >= 4 -- folderPreviewAlbums caps at 4, so this is always exactly 4.
    return Column(
      children: [
        Expanded(
          child: Row(
            children: [
              Expanded(child: _buildTile(context, ref, previewAlbums[0])),
              const SizedBox(width: 2),
              Expanded(child: _buildTile(context, ref, previewAlbums[1])),
            ],
          ),
        ),
        const SizedBox(height: 2),
        Expanded(
          child: Row(
            children: [
              Expanded(child: _buildTile(context, ref, previewAlbums[2])),
              const SizedBox(width: 2),
              Expanded(child: _buildTile(context, ref, previewAlbums[3])),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyState(ColorScheme cs) {
    return Container(
      color: cs.surfaceContainerHighest,
      child: Center(child: Icon(Icons.folder_outlined, size: 40, color: cs.onSurfaceVariant)),
    );
  }

  Widget _buildTileFallback(ColorScheme cs) {
    return Container(color: cs.surfaceContainerHighest);
  }

  /// Resolves the thumbhash for [album.thumbnailAssetId] before rendering, the
  /// same `FutureBuilder<RemoteAsset?>` pattern `_AlbumCard`/`_SpaceAlbumCoverTile`
  /// use, then reuses `Thumbnail.remote` for the actual pixels.
  Widget _buildTile(BuildContext context, WidgetRef ref, SpaceAlbum album) {
    final cs = context.colorScheme;
    final thumbnailId = album.thumbnailAssetId;
    // Defensive only: `folderPreviewAlbums` already filters to albums with a
    // non-null `thumbnailAssetId`, so this should never trigger in practice.
    if (thumbnailId == null) return _buildTileFallback(cs);

    return FutureBuilder<RemoteAsset?>(
      future: ref.read(assetServiceProvider).getRemoteAsset(thumbnailId),
      builder: (context, snapshot) {
        if (snapshot.hasData && snapshot.data != null) {
          return Thumbnail.remote(remoteId: thumbnailId, thumbhash: snapshot.data!.thumbHash ?? '');
        }
        return _buildTileFallback(cs);
      },
    );
  }
}

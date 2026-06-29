import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/routing/router.dart';

/// Space Albums list/manage page — Surface 2 of the Phase-2B design.
///
/// Pushed via [SpaceAlbumsRoute(spaceId, canEdit)] (standard slide-right).
///
/// Renders a 2-column grid of cards (cover + name + asset count + Hidden
/// label), with:
///  - Editor-only card ⋮ overflow (Show/Hide in timeline, Unlink) — stub
///    callbacks [onToggle]/[onUnlink] (real mutations land in B6).
///  - Editor-only app-bar "＋ Link" action — stub callback [onLink] (link
///    picker lands in B5).
///  - Centered empty state for an empty list.
///
/// Role-gated: affordances only shown when [canEdit] is true.
@RoutePage()
class SpaceAlbumsPage extends ConsumerWidget {
  final String spaceId;
  final bool canEdit;

  /// Called when the editor taps "Show/Hide in timeline" for an album.
  /// No-op default in B3; B6 supplies the real mutation.
  final void Function(String albumId) onToggle;

  /// Called when the editor taps "Unlink from space" for an album.
  /// No-op default in B3; B6 supplies the real mutation + confirm dialog.
  final void Function(String albumId) onUnlink;

  /// Called when the editor taps the "＋ Link" app-bar action.
  /// No-op default in B3; B5 supplies the link picker.
  final VoidCallback onLink;

  const SpaceAlbumsPage({
    super.key,
    required this.spaceId,
    required this.canEdit,
    void Function(String albumId)? onToggle,
    void Function(String albumId)? onUnlink,
    VoidCallback? onLink,
  }) : onToggle = onToggle ?? _noop,
       onUnlink = onUnlink ?? _noop,
       onLink = onLink ?? _voidNoop;

  static void _noop(String _) {}
  static void _voidNoop() {}

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final albumsAsync = ref.watch(spaceAlbumsProvider(spaceId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Albums'),
        centerTitle: false,
        actions: [
          if (canEdit)
            TextButton.icon(
              key: const Key('space-albums-link-action'),
              onPressed: onLink,
              icon: const Icon(Icons.add),
              label: const Text('Link'),
            ),
        ],
      ),
      body: albumsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load albums: $error')),
        data: (albums) => albums.isEmpty
            ? _EmptyState(key: const Key('space-albums-empty'), canEdit: canEdit, onLink: onLink)
            : _AlbumGrid(
                albums: albums,
                canEdit: canEdit,
                onToggle: onToggle,
                onUnlink: onUnlink,
                onTap: (albumId) =>
                    context.pushRoute(SpaceAlbumDetailRoute(spaceId: spaceId, albumId: albumId, canEdit: canEdit)),
              ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Album grid
// ---------------------------------------------------------------------------

class _AlbumGrid extends StatelessWidget {
  const _AlbumGrid({
    required this.albums,
    required this.canEdit,
    required this.onToggle,
    required this.onUnlink,
    required this.onTap,
  });

  final List<SpaceAlbum> albums;
  final bool canEdit;
  final void Function(String albumId) onToggle;
  final void Function(String albumId) onUnlink;
  final void Function(String albumId) onTap;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 12,
        mainAxisSpacing: 16,
        childAspectRatio: 0.75,
      ),
      itemCount: albums.length,
      itemBuilder: (context, index) {
        final album = albums[index];
        return _AlbumCard(
          key: Key('space-album-card-${album.id}'),
          album: album,
          canEdit: canEdit,
          onToggle: onToggle,
          onUnlink: onUnlink,
          onTap: onTap,
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Album card
// ---------------------------------------------------------------------------

class _AlbumCard extends ConsumerWidget {
  const _AlbumCard({
    super.key,
    required this.album,
    required this.canEdit,
    required this.onToggle,
    required this.onUnlink,
    required this.onTap,
  });

  final SpaceAlbum album;
  final bool canEdit;
  final void Function(String albumId) onToggle;
  final void Function(String albumId) onUnlink;
  final void Function(String albumId) onTap;

  Widget _buildFallback(ColorScheme cs) {
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(Radius.circular(16)),
        border: Border.all(color: cs.outline.withValues(alpha: 0.3), width: 1),
      ),
      child: const Center(child: Icon(Icons.photo_album_outlined, size: 40, color: Colors.grey)),
    );
  }

  Widget _buildCoverArt(BuildContext context, WidgetRef ref, ColorScheme cs) {
    final thumbnailId = album.thumbnailAssetId;
    if (thumbnailId == null) return _buildFallback(cs);
    return FutureBuilder<RemoteAsset?>(
      future: ref.read(assetServiceProvider).getRemoteAsset(thumbnailId),
      builder: (context, snapshot) {
        if (snapshot.hasData && snapshot.data != null) {
          return ClipRRect(
            borderRadius: const BorderRadius.all(Radius.circular(16)),
            child: Thumbnail.remote(
              remoteId: thumbnailId,
              thumbhash: snapshot.data!.thumbHash ?? '',
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
      onTap: () => onTap(album.id),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Cover
          Expanded(
            child: Stack(
              children: [
                Opacity(
                  opacity: isOffTimeline ? 0.6 : 1.0,
                  child: _buildCoverArt(context, ref, cs),
                ),
                // Off-timeline badge
                if (isOffTimeline)
                  Positioned.fill(
                    child: Center(
                      child: Icon(Icons.visibility_off, size: 24, color: cs.onSurface.withValues(alpha: 0.7)),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          // Name + overflow row
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      album.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
                    ),
                    Row(
                      children: [
                        Text(
                          '${album.assetCount} photos',
                          style: context.textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                        ),
                        if (isOffTimeline)
                          Text('· Hidden', style: context.textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                      ],
                    ),
                  ],
                ),
              ),
              if (canEdit)
                SizedBox(
                  width: 24,
                  height: 24,
                  child: PopupMenuButton<_CardAction>(
                    key: Key('space-album-card-menu-${album.id}'),
                    padding: EdgeInsets.zero,
                    iconSize: 18,
                    onSelected: (action) {
                      switch (action) {
                        case _CardAction.toggle:
                          onToggle(album.id);
                        case _CardAction.unlink:
                          onUnlink(album.id);
                      }
                    },
                    itemBuilder: (ctx) => [
                      PopupMenuItem(
                        value: _CardAction.toggle,
                        child: Text(album.showInTimeline ? 'Hide in timeline' : 'Show in timeline'),
                      ),
                      const PopupMenuItem(value: _CardAction.unlink, child: Text('Unlink from space')),
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

enum _CardAction { toggle, unlink }

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState({super.key, required this.canEdit, required this.onLink});

  final bool canEdit;
  final VoidCallback onLink;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.photo_album_outlined,
            size: 64,
            color: context.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
          ),
          const SizedBox(height: 16),
          Text(
            'No albums yet',
            style: context.textTheme.titleMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
          ),
          if (canEdit) ...[
            const SizedBox(height: 12),
            FilledButton.icon(onPressed: onLink, icon: const Icon(Icons.add), label: const Text('Link album')),
          ],
        ],
      ),
    );
  }
}

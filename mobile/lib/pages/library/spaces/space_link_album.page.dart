import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/utils/space_link_album_candidates.dart';

/// Space Link-Album Picker — Surface 4 of the Phase-2B design.
///
/// Pushed via [SpaceLinkAlbumRoute(spaceId, linkedAlbumIds)].
///
/// Shows the albums the current user **owns or can edit** that are **not yet**
/// linked to the space. The user selects one or more, then taps "Link (N)" to
/// confirm. The page returns the selected ids via [onAlbumsPicked] and
/// [context.maybePop(List<String>)] — it does NOT call the link API (that is
/// B6's responsibility).
///
/// Searchable multi-select: checkbox + cover thumbnail + name + asset count.
/// Empty state shown when no candidates are available.
@RoutePage()
class SpaceLinkAlbumPage extends HookConsumerWidget {
  final String spaceId;
  final List<String> linkedAlbumIds;

  /// Called with the selected album ids when the user confirms.
  /// No-op by default; B6 replaces with the PUT loop + sync-nudge.
  final void Function(List<String> ids) onAlbumsPicked;

  const SpaceLinkAlbumPage({
    super.key,
    required this.spaceId,
    required this.linkedAlbumIds,
    void Function(List<String> ids)? onAlbumsPicked,
  }) : onAlbumsPicked = onAlbumsPicked ?? _noop;

  static void _noop(List<String> _) {}

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final albums = ref.watch(remoteAlbumProvider.select((s) => s.albums));
    final currentUserId = ref.watch(currentUserProvider.select((u) => u?.id));

    final queryController = useTextEditingController();
    final query = useState('');
    useEffect(() {
      void listener() => query.value = queryController.text;
      queryController.addListener(listener);
      return () => queryController.removeListener(listener);
    }, [queryController]);

    final candidates = useMemoized(
      () => linkableAlbumCandidates(
        albums: albums,
        currentUserId: currentUserId ?? '',
        linkedAlbumIds: linkedAlbumIds.toSet(),
        query: query.value,
      ),
      [albums, currentUserId, linkedAlbumIds, query.value],
    );

    final selectedIds = useState<Set<String>>({});

    void toggleSelection(String albumId) {
      final current = selectedIds.value;
      if (current.contains(albumId)) {
        selectedIds.value = current.where((id) => id != albumId).toSet();
      } else {
        selectedIds.value = {...current, albumId};
      }
    }

    void confirm() {
      final ids = selectedIds.value.toList();
      onAlbumsPicked(ids);
      // Use AutoRouter's maybePop when available (normal app), fall back to
      // Navigator for test environments that wrap with plain MaterialApp.
      try {
        context.maybePop(ids);
      } catch (_) {
        Navigator.of(context).maybePop(ids);
      }
    }

    final selectedCount = selectedIds.value.length;
    final confirmLabel = selectedCount > 0 ? 'Link ($selectedCount)' : 'Link';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Link Albums'),
        centerTitle: false,
        leading: IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => context.maybePop()),
        actions: [
          TextButton(
            key: const Key('link-album-confirm'),
            onPressed: selectedCount > 0 ? confirm : null,
            child: Text(
              confirmLabel,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: selectedCount > 0 ? context.primaryColor : null,
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: TextField(
              controller: queryController,
              decoration: InputDecoration(
                hintText: 'Search albums',
                prefixIcon: const Icon(Icons.search_rounded),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                filled: true,
                fillColor: context.colorScheme.surfaceContainerHigh,
                contentPadding: const EdgeInsets.symmetric(vertical: 0),
              ),
            ),
          ),
          // Album list or empty state
          Expanded(
            child: candidates.isEmpty
                ? Center(
                    key: const Key('link-album-empty'),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.photo_album_outlined,
                          size: 56,
                          color: context.colorScheme.onSurfaceVariant.withValues(alpha: 0.4),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'No albums to link',
                          style: context.textTheme.titleMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    itemCount: candidates.length,
                    itemBuilder: (context, index) {
                      final album = candidates[index];
                      final isSelected = selectedIds.value.contains(album.id);
                      return _AlbumRow(
                        key: Key('link-album-row-${album.id}'),
                        album: album,
                        isSelected: isSelected,
                        onTap: () => toggleSelection(album.id),
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
// Row widget
// ---------------------------------------------------------------------------

class _AlbumRow extends StatelessWidget {
  const _AlbumRow({super.key, required this.album, required this.isSelected, required this.onTap});

  final RemoteAlbum album;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = context.colorScheme;

    return ListTile(
      leading: _AlbumCover(album: album),
      title: Text(
        album.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w500),
      ),
      subtitle: Text('${album.assetCount} photos', style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12)),
      trailing: Checkbox(value: isSelected, onChanged: (_) => onTap(), shape: const CircleBorder()),
      onTap: onTap,
    );
  }
}

// ---------------------------------------------------------------------------
// Cover thumbnail
// ---------------------------------------------------------------------------

class _AlbumCover extends ConsumerWidget {
  const _AlbumCover({required this.album});
  final RemoteAlbum album;

  Widget _buildFallback(ColorScheme cs) {
    return Container(
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: cs.outline.withValues(alpha: 0.3), width: 1),
      ),
      child: const Center(child: Icon(Icons.photo_album_outlined, size: 24, color: Colors.grey)),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = context.colorScheme;
    final thumbnailId = album.thumbnailAssetId;
    if (thumbnailId == null) return _buildFallback(cs);
    return SizedBox(
      width: 52,
      height: 52,
      child: FutureBuilder<RemoteAsset?>(
        future: ref.read(assetServiceProvider).getRemoteAsset(thumbnailId),
        builder: (context, snapshot) {
          if (snapshot.hasData && snapshot.data != null) {
            return ClipRRect(
              borderRadius: const BorderRadius.all(Radius.circular(8)),
              child: Thumbnail.remote(remoteId: thumbnailId, thumbhash: snapshot.data!.thumbHash ?? ''),
            );
          }
          return _buildFallback(cs);
        },
      ),
    );
  }
}

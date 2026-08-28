import 'dart:async';
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_kebab.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';

/// Space Album detail page — pushes a `TimelineRouteScope + Timeline` scoped
/// to a single shared-space album.
///
/// Route params:
///   [spaceId]  — the parent shared space.
///   [albumId]  — the specific album to display.
///   [canEdit]  — true for Owner/Editor role; drives kebab and bottom-sheet
///                gating (space role, NOT album ownership — see D3).
///
/// B6: mutations (Add photos, Show/Hide in timeline, Unlink) are wired to the
/// real REST calls via [SpaceAlbumActions] + sync-nudge.
@RoutePage()
class SpaceAlbumDetailPage extends ConsumerStatefulWidget {
  final String spaceId;
  final String albumId;
  final bool canEdit;

  const SpaceAlbumDetailPage({super.key, required this.spaceId, required this.albumId, required this.canEdit});

  @override
  ConsumerState<SpaceAlbumDetailPage> createState() => _SpaceAlbumDetailPageState();
}

class _SpaceAlbumDetailPageState extends ConsumerState<SpaceAlbumDetailPage> {
  String? _spaceName;

  @override
  void initState() {
    super.initState();
    unawaited(_loadSpaceName());
  }

  Future<void> _loadSpaceName() async {
    try {
      final space = await ref.read(sharedSpaceApiRepositoryProvider).get(widget.spaceId);
      if (mounted) {
        setState(() => _spaceName = space.name);
      }
    } catch (_) {
      // Best-effort — the subtitle simply won't render until the name loads.
    }
  }

  /// Add photos to this album by pushing the asset-selection timeline, then
  /// calling the server-only add path (D3 — server enforces space-editor
  /// permission), then nudging sync.
  ///
  /// Routes through [SpaceAlbumActions.addAssets] (REST add only, no local
  /// `remote_album_asset` junction write) so an absorbed linked album — one
  /// with no local `remote_album` row — does not hit the junction FK and
  /// surface a false "Failed to add photos" toast (mobile F1).
  Future<void> _addPhotos() async {
    final newAssets = await context.pushRoute<Set<BaseAsset>>(AssetSelectionTimelineRoute());
    if (newAssets == null || newAssets.isEmpty) {
      return;
    }

    // Filter to remote assets only (local assets can't be added to a space
    // album via the REST endpoint — the server requires remote asset ids).
    final remoteAssetIds = newAssets.whereType<RemoteAsset>().map((a) => a.id).toList();
    if (remoteAssetIds.isEmpty) {
      return;
    }

    try {
      final count = await ref.read(spaceAlbumActionsProvider).addAssets(widget.albumId, remoteAssetIds);
      if (mounted && count > 0) {
        ImmichToast.show(
          context: context,
          msg: context.t.space_album_add_photos_success(count: count),
          toastType: ToastType.success,
        );
      }
    } catch (_) {
      if (mounted) {
        ImmichToast.show(context: context, msg: context.t.space_album_add_photos_failed, toastType: ToastType.error);
      }
    }
  }

  Future<void> _toggleTimeline() async {
    final albumsAsync = ref.read(spaceAlbumsProvider(widget.spaceId));
    final album = albumsAsync.valueOrNull?.where((a) => a.id == widget.albumId).firstOrNull;
    if (album == null) {
      return;
    }

    try {
      await ref
          .read(spaceAlbumActionsProvider)
          .toggleTimeline(widget.spaceId, widget.albumId, current: album.showInTimeline);
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: album.showInTimeline ? context.t.space_album_timeline_hidden : context.t.space_album_timeline_shown,
          toastType: ToastType.success,
        );
      }
    } catch (_) {
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: context.t.space_album_timeline_update_failed,
          toastType: ToastType.error,
        );
      }
    }
  }

  Future<void> _unlink() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(ctx.t.space_album_unlink_from_space),
        content: Text(ctx.t.space_album_unlink_confirmation),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(ctx.t.cancel)),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
            child: Text(ctx.t.space_album_unlink_action),
          ),
        ],
      ),
    );

    if (confirmed != true) {
      return;
    }

    try {
      await ref.read(spaceAlbumActionsProvider).unlink(widget.spaceId, widget.albumId);
      if (mounted) {
        ImmichToast.show(context: context, msg: context.t.space_album_unlinked_success, toastType: ToastType.success);
        await context.maybePop();
      }
    } catch (_) {
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: context.t.spaces_linked_albums_error_unlink,
          toastType: ToastType.error,
        );
      }
    }
  }

  Future<void> _triggerSync() async {
    try {
      await ref.read(backgroundSyncProvider).syncRemote();
    } catch (_) {
      // Non-fatal — sync will catch up on next cycle.
    }
  }

  @override
  Widget build(BuildContext context) {
    final albumsAsync = ref.watch(spaceAlbumsProvider(widget.spaceId));
    final album = albumsAsync.valueOrNull?.where((a) => a.id == widget.albumId).firstOrNull;

    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) => ref
          .watch(timelineFactoryProvider)
          .spaceAlbum(spaceId: widget.spaceId, albumId: widget.albumId, groupBy: groupBy, temporalScope: scope),
      child: Timeline(
        withGroupingPill: true,
        appBar: SpaceAlbumAppBar(
          canEdit: widget.canEdit,
          album: album,
          spaceName: _spaceName,
          onAddPhotos: widget.canEdit ? _addPhotos : () {},
          onToggleTimeline: widget.canEdit ? _toggleTimeline : () {},
          onUnlink: widget.canEdit ? _unlink : () {},
        ),
        bottomSheet: SpaceAlbumBottomSheet(
          canEdit: widget.canEdit,
          albumId: widget.albumId,
          onRemoved: () async {
            // Nudge sync after the remove-from-album action so assets
            // disappear from Drift without waiting for the next cycle.
            await _triggerSync();
          },
        ),
      ),
    );
  }
}

/// Extracted SliverAppBar + [SpaceAlbumKebab] sub-widget.
///
/// Exposed as a named (non-private) class so widget tests can pump it in
/// isolation without needing the full [Timeline] + [TimelineRouteScope]
/// plumbing.
class SpaceAlbumAppBar extends StatelessWidget {
  const SpaceAlbumAppBar({
    super.key,
    required this.canEdit,
    this.album,
    this.spaceName,
    this.onAddPhotos,
    this.onToggleTimeline,
    this.onUnlink,
  });

  final bool canEdit;
  final SpaceAlbum? album;

  /// The name of the parent shared space, used for the app bar subtitle.
  /// Null until the space metadata has loaded (subtitle is hidden until then).
  final String? spaceName;

  /// Called when the editor taps "Add photos" in the kebab.
  final VoidCallback? onAddPhotos;

  /// Called when the editor taps "Show/Hide in timeline" in the kebab.
  final VoidCallback? onToggleTimeline;

  /// Called when the editor taps "Unlink from space" in the kebab.
  final VoidCallback? onUnlink;

  @override
  Widget build(BuildContext context) {
    final showSubtitle = album != null && spaceName != null;
    return SliverAppBar(
      floating: true,
      pinned: false,
      title: album != null
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(album!.name),
                if (showSubtitle)
                  Text(
                    [
                      context.t.space_album_photo_count(count: album!.assetCount),
                      context.t.space_album_in_space(space: spaceName!),
                    ].join(' · '),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            )
          : null,
      actions: [
        SpaceAlbumKebab(
          canEdit: canEdit,
          showInTimeline: album?.showInTimeline ?? true,
          toggleEnabled: album != null,
          onAddPhotos: onAddPhotos ?? () {},
          onToggleTimeline: onToggleTimeline ?? () {},
          onUnlink: onUnlink ?? () {},
        ),
      ],
    );
  }
}

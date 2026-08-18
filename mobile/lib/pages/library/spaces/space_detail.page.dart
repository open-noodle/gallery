import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_detail_kebab.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_edit_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_top_sliver.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/space_face_recognition.dart';
import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_mobile/widgets/spaces/sync_status_banner.dart';
import 'package:openapi/api.dart';

// PR 2 — Task 35: the space timeline is now served directly by the Drift
// sharedSpace() query (see DriftTimelineRepository.sharedSpace), so this page
// no longer fetches assets over the network. Metadata + member list still
// load from the API because they are not yet mirrored in Drift.

@RoutePage()
class SpaceDetailPage extends ConsumerStatefulWidget {
  final String spaceId;

  const SpaceDetailPage({super.key, required this.spaceId});

  static const timelineOverviewControlsEnabled = true;
  static double syncBannerTopSliverHeight({required bool isRemoteSyncing}) =>
      isRemoteSyncing ? kSyncStatusBannerSliverHeight : 0;

  @override
  ConsumerState<SpaceDetailPage> createState() => _SpaceDetailPageState();
}

class _SpaceDetailPageState extends ConsumerState<SpaceDetailPage> {
  SharedSpaceResponseDto? _space;
  List<SharedSpaceMemberResponseDto>? _members;
  String? _error;
  bool _loading = true;
  bool _isRefreshing = false;
  bool _togglingTimeline = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadData());
  }

  Future<void> _loadData() async {
    if (_isRefreshing) {
      return;
    }
    _isRefreshing = true;
    try {
      final repo = ref.read(sharedSpaceApiRepositoryProvider);
      final results = await Future.wait([repo.get(widget.spaceId), repo.getMembers(widget.spaceId)]);

      if (mounted) {
        setState(() {
          _space = results[0] as SharedSpaceResponseDto;
          _members = results[1] as List<SharedSpaceMemberResponseDto>;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    } finally {
      _isRefreshing = false;
    }
  }

  // Drift reactivity now propagates asset additions/removals automatically,
  // so we only need to refresh metadata (e.g. lastActivityAt) after an
  // add/remove action. Members and assets take care of themselves.
  Future<void> _refreshSpaceMetadata() async {
    try {
      final space = await ref.read(sharedSpaceApiRepositoryProvider).get(widget.spaceId);
      if (mounted) {
        setState(() => _space = space);
      }
    } catch (_) {
      // Best-effort refresh — failures are non-fatal; the Drift stream still
      // drives the asset grid.
    }
  }

  SharedSpaceMemberResponseDto? get _currentMember {
    final currentUser = ref.read(currentUserProvider);
    if (currentUser == null || _members == null) {
      return null;
    }
    return _members!.where((m) => m.userId == currentUser.id).firstOrNull;
  }

  bool get _isOwner {
    final space = _space;
    if (space == null) {
      return false;
    }
    return spaceIsOwned(space, ref.read(currentUserProvider)?.id);
  }

  bool get _canEdit {
    final space = _space;
    if (space == null) {
      return false;
    }
    return spaceIsWritable(space, ref.read(currentUserProvider)?.id);
  }

  SharedSpaceRole get _currentRole {
    final member = _currentMember;
    if (member == null) {
      return SharedSpaceRole.viewer;
    }
    return SharedSpaceRole.fromJson(member.role.toString()) ?? SharedSpaceRole.viewer;
  }

  Future<void> _addPhotos() async {
    final newAssets = await context.pushRoute<Set<BaseAsset>>(DriftAssetSelectionTimelineRoute());

    if (newAssets == null || newAssets.isEmpty) {
      return;
    }

    try {
      final assetIds = newAssets.whereType<RemoteAsset>().map((a) => a.id).toList();
      await ref.read(sharedSpaceApiRepositoryProvider).addAssets(widget.spaceId, assetIds);
      ref.invalidate(sharedSpacesProvider);
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: 'Added ${assetIds.length} photos to space',
          toastType: ToastType.success,
        );
      }
      // Drift's sharedSpace() stream auto-refreshes the timeline as new
      // shared_space_asset rows land in local Drift. Trigger an incremental
      // sync now so the rows arrive without waiting for the next app start.
      // The websocket has no per-space asset event subscription on the gallery
      // fork, so without this nudge the user wouldn't see the photos until
      // the app is restarted (closed-from-recents and reopened).
      await _triggerSpaceSync();
      await _refreshSpaceMetadata();
    } catch (e) {
      if (mounted) {
        ImmichToast.show(context: context, msg: 'Failed to add photos', toastType: ToastType.error);
      }
    }
  }

  // Pull new shared_space_* events from the server immediately. The Drift
  // sync stream is incremental — each call only fetches rows newer than the
  // last ack — so this is a cheap nudge to bring the local DB in line after
  // a mutation that the websocket doesn't push (add/remove/rename/etc).
  Future<void> _triggerSpaceSync() async {
    try {
      await ref.read(backgroundSyncProvider).syncRemote();
    } catch (error) {
      // Failure here is non-fatal — the sync will eventually catch up on
      // the next app resume. The mutation already succeeded server-side.
    }
  }

  Future<void> _deleteSpace() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(ctx.t.spaces_delete),
        content: Text(ctx.t.spaces_delete_confirmation(name: _space?.name ?? '')),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(ctx.t.cancel)),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
            child: Text(ctx.t.delete),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await ref.read(sharedSpaceApiRepositoryProvider).delete(widget.spaceId);
        ref.invalidate(sharedSpacesProvider);
        if (mounted) {
          ImmichToast.show(context: context, msg: 'Space deleted', toastType: ToastType.success);
          await context.maybePop();
        }
      } catch (e) {
        if (mounted) {
          ImmichToast.show(context: context, msg: 'Failed to delete space', toastType: ToastType.error);
        }
      }
    }
  }

  Future<void> _editSpace() async {
    final space = _space;
    if (space == null) {
      return;
    }

    final saved = await SpaceEditSheet.show(context, space);
    if (saved != true) {
      return;
    }

    // The grid reads sharedSpacesProvider; the app bar reads this page's own
    // `_space`, which is network-loaded rather than Drift-backed. A sync nudge would
    // NOT refresh the title -- nothing reads the local shared_space name column for
    // display -- so re-fetch the metadata explicitly.
    ref.invalidate(sharedSpacesProvider);
    await _refreshSpaceMetadata();
  }

  bool get _showInTimeline {
    final member = _currentMember;
    return member?.showInTimeline ?? true;
  }

  Future<void> _toggleTimeline() async {
    if (_togglingTimeline) {
      return;
    }
    setState(() => _togglingTimeline = true);
    try {
      final newValue = !_showInTimeline;
      final repo = ref.read(sharedSpaceApiRepositoryProvider);
      await repo.updateMemberTimeline(widget.spaceId, showInTimeline: newValue);
      final members = await repo.getMembers(widget.spaceId);
      if (mounted) {
        setState(() {
          _members = members;
          _togglingTimeline = false;
        });
        ImmichToast.show(
          context: context,
          msg: newValue ? 'Space added to timeline' : 'Space removed from timeline',
          toastType: ToastType.success,
        );
      }
      // Same nudge as _addPhotos: pull the sharedSpaceMemberUpdateV1 event so
      // the new showInTimeline value lands in local Drift immediately.
      // Without this, the main timeline's mergedBucket query keeps returning
      // the pre-toggle result until the next background sync cycle fires, so
      // toggling appears not to take effect until the user closes and reopens
      // the app.
      await _triggerSpaceSync();
    } catch (e) {
      if (mounted) {
        setState(() => _togglingTimeline = false);
        ImmichToast.show(context: context, msg: 'Failed to update timeline setting', toastType: ToastType.error);
      }
    }
  }

  /// Opens the [SpaceLinkAlbumPage] picker with the current linked-album ids
  /// pre-excluded. The picker returns the selected ids via [context.maybePop];
  /// this method calls [_onAlbumsPicked] once on the returned list to loop the
  /// PUT endpoint and fire the sync-nudge.
  Future<void> _openLinkPicker() async {
    // Collect the ids of albums already linked to this space so the picker
    // can exclude them from the candidate list.
    final linkedAlbumIds =
        ref
            .read(spaceAlbumsProvider(widget.spaceId))
            .whenData((albums) => albums.map((a) => a.id).toList())
            .valueOrNull ??
        <String>[];

    if (!mounted) {
      return;
    }
    final picked = await context.pushRoute<List<String>>(
      SpaceLinkAlbumRoute(spaceId: widget.spaceId, linkedAlbumIds: linkedAlbumIds),
    );
    if (picked == null || picked.isEmpty) {
      return;
    }
    await _onAlbumsPicked(picked);
  }

  /// B6: Loop PUT /shared-spaces/:id/albums/:albumId for each picked album,
  /// then fire the sync-nudge and show a success toast.
  Future<void> _onAlbumsPicked(List<String> ids) async {
    if (ids.isEmpty) {
      return;
    }
    try {
      await ref.read(spaceAlbumActionsProvider).link(widget.spaceId, ids);
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: context.t.space_album_linked_success(count: ids.length),
          toastType: ToastType.success,
        );
      }
    } catch (_) {
      if (mounted) {
        ImmichToast.show(context: context, msg: context.t.spaces_linked_albums_error_link, toastType: ToastType.error);
      }
    }
  }

  /// B6: Toggle `showInTimeline` for a linked album from the list/manage page.
  Future<void> _onToggleAlbumTimeline(String albumId) async {
    final albumsAsync = ref.read(spaceAlbumsProvider(widget.spaceId));
    final album = albumsAsync.valueOrNull?.where((a) => a.id == albumId).firstOrNull;
    if (album == null) {
      return;
    }

    try {
      await ref.read(spaceAlbumActionsProvider).toggleTimeline(widget.spaceId, albumId, current: album.showInTimeline);
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

  /// B6: Confirm + unlink an album from the list/manage page.
  Future<void> _onUnlinkAlbum(String albumId) async {
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
      await ref.read(spaceAlbumActionsProvider).unlink(widget.spaceId, albumId);
      if (mounted) {
        ImmichToast.show(context: context, msg: context.t.space_album_unlinked_success, toastType: ToastType.success);
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

  void _navigateToMembers() {
    unawaited(
      context.pushRoute<String>(SpaceMembersRoute(spaceId: widget.spaceId)).then((result) async {
        if (!mounted) {
          return;
        }
        if (result == 'left') {
          // The user just left this space from the members page. Re-fetching
          // the space metadata would 403, so just pop ourselves back to the
          // spaces list.
          await context.maybePop();
          return;
        }
        await _loadData();
      }),
    );
  }

  void _navigateToSpacePeople() {
    unawaited(context.pushRoute(SpacePeopleRoute(spaceId: widget.spaceId, canEdit: _canEdit)));
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Space')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null || _space == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Space')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 48),
              const SizedBox(height: 16),
              Text('Failed to load space: ${_error ?? "Unknown error"}'),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () {
                  setState(() {
                    _loading = true;
                    _error = null;
                  });
                  unawaited(_loadData());
                },
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    final isRemoteSyncing = ref.watch(syncStatusProvider.select((s) => s.isRemoteSyncing));

    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) => ref
          .watch(timelineFactoryProvider)
          .sharedSpace(spaceId: widget.spaceId, groupBy: groupBy, temporalScope: scope),
      child: Timeline(
        withGroupingPill: true,
        topSliverWidget: SpaceTopSliver(
          spaceId: widget.spaceId,
          canEdit: _canEdit,
          // B5: opens the link picker.
          onLinkTap: _openLinkPicker,
          // B4: tapping an album tile pushes the detail page.
          onAlbumTap: (albumId) =>
              context.pushRoute(SpaceAlbumDetailRoute(spaceId: widget.spaceId, albumId: albumId, canEdit: _canEdit)),
          // B3: "See all ▸" pushes the list/manage page; B5/B6 pass the real callbacks.
          onSeeAll: () => context.pushRoute(
            SpaceAlbumsRoute(
              spaceId: widget.spaceId,
              canEdit: _canEdit,
              onLink: _openLinkPicker,
              onToggle: _onToggleAlbumTimeline,
              onUnlink: _onUnlinkAlbum,
            ),
          ),
        ),
        topSliverWidgetHeight: computeTopSliverHeight(
          ref: ref,
          spaceId: widget.spaceId,
          canEdit: _canEdit,
          isRemoteSyncing: isRemoteSyncing,
        ),
        appBar: SliverAppBar(
          title: Text(_space!.name),
          centerTitle: false,
          floating: true,
          pinned: false,
          snap: false,
          // Adding photos is the only action that stays on the bar; everything else lives in the
          // kebab, which is why that menu is no longer hidden for viewers.
          actions: [
            if (_canEdit)
              IconButton(
                icon: const Icon(Icons.add_photo_alternate_outlined),
                onPressed: _addPhotos,
                tooltip: context.t.add_photos,
              ),
            SpaceDetailKebab(
              canEdit: _canEdit,
              canDelete: _isOwner,
              showInTimeline: _showInTimeline,
              timelineBusy: _togglingTimeline,
              showPeople: spacePeopleVisible(_space!),
              onToggleTimeline: _toggleTimeline,
              onPeople: _navigateToSpacePeople,
              onMembers: _navigateToMembers,
              onEdit: _editSpace,
              onDelete: _deleteSpace,
            ),
          ],
        ),
        bottomSheet: SpaceBottomSheet(
          spaceId: widget.spaceId,
          currentUserRole: _currentRole,
          onAssetsRemoved: () async {
            // Same nudge as _addPhotos — pull new shared_space_asset_audit rows
            // so the deletes propagate to local Drift before the next sync.
            await _triggerSpaceSync();
            await _refreshSpaceMetadata();
          },
        ),
      ),
    );
  }
}

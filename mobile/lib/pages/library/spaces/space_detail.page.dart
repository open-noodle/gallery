import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
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
    _loadData();
  }

  Future<void> _loadData() async {
    if (_isRefreshing) return;
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
    if (currentUser == null || _members == null) return null;
    return _members!.where((m) => m.userId == currentUser.id).firstOrNull;
  }

  bool get _isOwner {
    final member = _currentMember;
    if (member == null) return false;
    return member.role == SharedSpaceRole.owner;
  }

  bool get _canEdit {
    final member = _currentMember;
    if (member == null) return false;
    return member.role == SharedSpaceRole.owner || member.role == SharedSpaceRole.editor;
  }

  SharedSpaceRole get _currentRole {
    final member = _currentMember;
    if (member == null) return SharedSpaceRole.viewer;
    return SharedSpaceRole.fromJson(member.role.value) ?? SharedSpaceRole.viewer;
  }

  Future<void> _addPhotos() async {
    final newAssets = await context.pushRoute<Set<BaseAsset>>(DriftAssetSelectionTimelineRoute());

    if (newAssets == null || newAssets.isEmpty) return;

    try {
      final assetIds = newAssets.whereType<RemoteAsset>().map((a) => a.id).toList();
      await ref.read(sharedSpaceApiRepositoryProvider).addAssets(widget.spaceId, assetIds);
      ref.invalidate(sharedSpacesProvider);
      if (context.mounted) {
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
      if (context.mounted) {
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
        title: const Text('Delete Space'),
        content: Text('Are you sure you want to delete "${_space?.name}"? This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await ref.read(sharedSpaceApiRepositoryProvider).delete(widget.spaceId);
        ref.invalidate(sharedSpacesProvider);
        if (context.mounted) {
          ImmichToast.show(context: context, msg: 'Space deleted', toastType: ToastType.success);
          await context.maybePop();
        }
      } catch (e) {
        if (context.mounted) {
          ImmichToast.show(context: context, msg: 'Failed to delete space', toastType: ToastType.error);
        }
      }
    }
  }

  bool get _showInTimeline {
    final member = _currentMember;
    return member?.showInTimeline ?? true;
  }

  Future<void> _toggleTimeline() async {
    if (_togglingTimeline) return;
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

  void _navigateToMembers() {
    context.pushRoute<String>(SpaceMembersRoute(spaceId: widget.spaceId)).then((result) async {
      if (!mounted) return;
      if (result == 'left') {
        // The user just left this space from the members page. Re-fetching
        // the space metadata would 403, so just pop ourselves back to the
        // spaces list.
        await context.maybePop();
        return;
      }
      await _loadData();
    });
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
                  _loadData();
                },
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    return ProviderScope(
      overrides: [
        timelineServiceProvider.overrideWith((ref) {
          final timelineService = ref.watch(timelineFactoryProvider).sharedSpace(spaceId: widget.spaceId);
          ref.onDispose(timelineService.dispose);
          return timelineService;
        }),
      ],
      child: Timeline(
        topSliverWidget: const SyncStatusBannerSliver(),
        appBar: SliverAppBar(
          title: Text(_space!.name),
          centerTitle: false,
          floating: true,
          pinned: false,
          snap: false,
          actions: [
            IconButton(
              icon: Icon(_showInTimeline ? Icons.visibility : Icons.visibility_off),
              onPressed: _togglingTimeline ? null : _toggleTimeline,
              tooltip: _showInTimeline ? 'Hide from timeline' : 'Show in timeline',
            ),
            if (_canEdit)
              IconButton(
                icon: const Icon(Icons.add_photo_alternate_outlined),
                onPressed: _addPhotos,
                tooltip: 'Add Photos',
              ),
            IconButton(icon: const Icon(Icons.people_outline), onPressed: _navigateToMembers, tooltip: 'Members'),
            if (_isOwner)
              PopupMenuButton<String>(
                onSelected: (value) {
                  if (value == 'delete') _deleteSpace();
                },
                itemBuilder: (context) => [const PopupMenuItem(value: 'delete', child: Text('Delete Space'))],
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

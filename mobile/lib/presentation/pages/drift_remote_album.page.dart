import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/album/pending_uploads_banner.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/remote_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/remote_album/drift_album_option.widget.dart';
import 'package:immich_mobile/presentation/widgets/remote_album/space_link_picker.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/current_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/common/date_time_picker.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_mobile/widgets/common/remote_album_sliver_app_bar.dart';
import 'package:intl/intl.dart';

@RoutePage()
class RemoteAlbumPage extends ConsumerStatefulWidget {
  final RemoteAlbum album;

  const RemoteAlbumPage({super.key, required this.album});

  static const timelineOverviewControlsEnabled = true;

  @override
  ConsumerState<RemoteAlbumPage> createState() => _RemoteAlbumPageState();
}

class _RemoteAlbumPageState extends ConsumerState<RemoteAlbumPage> {
  late RemoteAlbum _album;
  @override
  void initState() {
    super.initState();
    _album = widget.album;
  }

  Future<void> addAssets(BuildContext context) async {
    final notifier = ref.read(remoteAlbumProvider.notifier);
    final albumAssets = await notifier.getAssets(_album.id);

    final newAssets = await context.pushRoute<Set<BaseAsset>>(
      DriftAssetSelectionTimelineRoute(lockedSelectionAssets: albumAssets.toSet()),
    );

    if (newAssets == null || newAssets.isEmpty) {
      return;
    }

    final added = await notifier.addAssetsToAlbum(_album.id, newAssets);

    if (added > 0 && context.mounted) {
      ImmichToast.show(
        context: context,
        msg: "assets_added_to_album_count".t(context: context, args: {'count': added.toString()}),
        toastType: ToastType.success,
      );
    }
  }

  Future<void> addUsers(BuildContext context) async {
    final newUsers = await context.pushRoute<List<String>>(DriftUserSelectionRoute(album: _album));

    if (newUsers == null || newUsers.isEmpty) {
      return;
    }

    try {
      await ref.read(remoteAlbumProvider.notifier).addUsers(_album.id, newUsers);

      if (newUsers.isNotEmpty) {
        ImmichToast.show(
          context: context,
          msg: "users_added_to_album_count".t(context: context, args: {'count': newUsers.length}),
          toastType: ToastType.success,
        );
      }

      ref.invalidate(remoteAlbumSharedUsersProvider(_album.id));
    } catch (e) {
      ImmichToast.show(
        context: context,
        msg: "Failed to add users to album: ${e.toString()}",
        toastType: ToastType.error,
      );
    }
  }

  Future<void> toggleAlbumOrder() async {
    await ref.read(remoteAlbumProvider.notifier).toggleAlbumOrder(_album.id);

    ref.invalidate(timelineServiceProvider);
  }

  Future<void> deleteAlbum(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: Text('delete_album'.t(context: context)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('album_delete_confirmation'.t(context: context, args: {'album': _album.name})),
              const SizedBox(height: 8),
              Text('album_delete_confirmation_description'.t(context: context)),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text('cancel'.t(context: context)),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
              child: Text('delete_album'.t(context: context)),
            ),
          ],
        );
      },
    );

    if (confirmed == true) {
      try {
        await ref.read(remoteAlbumProvider.notifier).deleteAlbum(_album.id);

        ImmichToast.show(
          context: context,
          msg: 'album_deleted'.t(context: context),
          toastType: ToastType.success,
        );

        unawaited(context.pushRoute(const DriftLibraryRoute()));
      } catch (e) {
        ImmichToast.show(
          context: context,
          msg: 'album_viewer_appbar_share_err_delete'.t(context: context),
          toastType: ToastType.error,
        );
      }
    }
  }

  Future<void> showEditAlbum(BuildContext context) async {
    final result = await showDialog<_EditAlbumData?>(
      context: context,
      barrierDismissible: true,
      builder: (context) => _EditAlbumDialog(album: _album),
    );

    if (result != null && context.mounted) {
      setState(() {
        _album = _album.copyWith(name: result.name, description: result.description ?? '', createdAt: result.createdAt);
      });
      unawaited(HapticFeedback.mediumImpact());
    }
  }

  Future<void> showActivity(BuildContext context) async {
    unawaited(context.pushRoute(DriftActivitiesRoute(album: _album)));
  }

  /// L15 — "Link to space" entry point from the album itself: opens the
  /// space picker (Owner/Editor spaces) and links this album to the selected
  /// space via the same [SpaceAlbumActions.link] path already used from
  /// inside a space (B6 / [SpaceDetailPage._onAlbumsPicked]).
  Future<void> linkToSpace(BuildContext context) async {
    final space = await SpaceLinkPickerSheet.show(context);
    if (space == null || !context.mounted) return;

    try {
      await ref.read(spaceAlbumActionsProvider).link(space.id, [_album.id]);
      if (context.mounted) {
        ImmichToast.show(
          context: context,
          msg: 'album_linked_to_space'.t(context: context, args: {'space': space.name}),
          toastType: ToastType.success,
        );
      }
    } catch (_) {
      if (context.mounted) {
        ImmichToast.show(
          context: context,
          msg: 'spaces_linked_albums_error_link'.t(context: context),
          toastType: ToastType.error,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final isOwner = user != null ? user.id == _album.ownerId : false;

    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) =>
          ref.watch(timelineFactoryProvider).remoteAlbum(albumId: _album.id, groupBy: groupBy, temporalScope: scope),
      overrides: [currentRemoteAlbumScopedProvider.overrideWithValue(_album)],
      child: Timeline(
        withGroupingPill: true,
        topSliverWidget: PendingUploadsBanner(albumId: _album.id),
        appBar: RemoteAlbumSliverAppBar(
          icon: Icons.photo_album_outlined,
          kebabMenu: _AlbumKebabMenu(
            album: _album,
            onDeleteAlbum: () => deleteAlbum(context),
            onAddUsers: () => addUsers(context),
            onAddPhotos: () => addAssets(context),
            onToggleAlbumOrder: () => toggleAlbumOrder(),
            onEditAlbum: () => showEditAlbum(context),
            onCreateSharedLink: () => unawaited(context.pushRoute(SharedLinkEditRoute(albumId: _album.id))),
            onShowOptions: () => context.pushRoute(DriftAlbumOptionsRoute(album: _album)),
            onLinkToSpace: () => unawaited(linkToSpace(context)),
          ),
          onEditTitle: isOwner ? () => showEditAlbum(context) : null,
          onActivity: () => showActivity(context),
        ),
        bottomSheet: RemoteAlbumBottomSheet(album: _album),
      ),
    );
  }
}

class _EditAlbumData {
  final String name;
  final String? description;
  final DateTime createdAt;

  const _EditAlbumData({required this.name, this.description, required this.createdAt});
}

class _EditAlbumDialog extends ConsumerStatefulWidget {
  final RemoteAlbum album;

  const _EditAlbumDialog({required this.album});

  @override
  ConsumerState<_EditAlbumDialog> createState() => _EditAlbumDialogState();
}

class _EditAlbumDialogState extends ConsumerState<_EditAlbumDialog> {
  late final TextEditingController titleController;
  late final TextEditingController descriptionController;
  final formKey = GlobalKey<FormState>();
  late DateTime createdAt;

  @override
  void initState() {
    super.initState();
    titleController = TextEditingController(text: widget.album.name);
    descriptionController = TextEditingController(
      text: widget.album.description.isEmpty ? '' : widget.album.description,
    );
    createdAt = widget.album.createdAt;
  }

  @override
  void dispose() {
    titleController.dispose();
    descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickCreatedAt() async {
    // Returns an ISO string with a +HH:MM offset, or null when dismissed —
    // same contract action.service.dart:202-219 consumes for asset dates.
    final picked = await showDateTimePicker(context: context, initialDateTime: createdAt);
    if (picked == null) {
      return;
    }
    setState(() => createdAt = DateTime.parse(picked).toLocal());
  }

  Future<void> _handleSave() async {
    if (formKey.currentState?.validate() != true) {
      return;
    }

    try {
      final newTitle = titleController.text.trim();
      final newDescription = descriptionController.text.trim();

      await ref
          .read(remoteAlbumProvider.notifier)
          .updateAlbum(widget.album.id, name: newTitle, description: newDescription, createdAt: createdAt);

      if (mounted) {
        Navigator.of(context).pop(
          _EditAlbumData(
            name: newTitle,
            description: newDescription.isEmpty ? null : newDescription,
            createdAt: createdAt,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: 'album_update_error'.t(context: context),
          toastType: ToastType.error,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.all(24),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(16))),
      child: SingleChildScrollView(
        child: Container(
          padding: const EdgeInsets.all(16),
          constraints: const BoxConstraints(maxWidth: 550),
          child: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(Icons.edit_outlined, color: context.colorScheme.primary, size: 24),
                    const SizedBox(width: 12),
                    Text('edit_album'.t(context: context), style: context.textTheme.titleMedium),
                  ],
                ),
                const SizedBox(height: 24),

                // Album Name
                Text(
                  'album_name'.t(context: context).toUpperCase(),
                  style: context.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                TextFormField(
                  controller: titleController,
                  maxLines: 1,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                    filled: true,
                    fillColor: context.colorScheme.surface,
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'album_name_required'.t(context: context);
                    }

                    return null;
                  },
                ),
                const SizedBox(height: 18),

                // Description
                Text(
                  'description'.t(context: context).toUpperCase(),
                  style: context.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                TextFormField(
                  controller: descriptionController,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                    filled: true,
                    fillColor: context.colorScheme.surface,
                  ),
                ),
                const SizedBox(height: 18),

                // Created date
                Text(
                  'date_created'.t(context: context).toUpperCase(),
                  style: context.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                ListTile(
                  key: const Key('album-edit-created-at'),
                  tileColor: context.colorScheme.surface,
                  shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                  title: Text(DateFormat.yMMMd().format(createdAt), style: context.textTheme.bodyMedium),
                  trailing: Icon(Icons.edit_outlined, size: 18, color: context.colorScheme.primary),
                  onTap: _pickCreatedAt,
                ),
                const SizedBox(height: 24),

                // Action Buttons
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(null),
                      child: Text('cancel'.t(context: context)),
                    ),
                    const SizedBox(width: 12),
                    FilledButton(
                      key: const Key('album-edit-save'),
                      onPressed: _handleSave,
                      child: Text('save'.t(context: context)),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AlbumKebabMenu extends ConsumerWidget {
  final RemoteAlbum album;
  final VoidCallback? onDeleteAlbum;
  final VoidCallback? onAddUsers;
  final VoidCallback? onAddPhotos;
  final VoidCallback? onToggleAlbumOrder;
  final VoidCallback? onEditAlbum;
  final VoidCallback? onCreateSharedLink;
  final VoidCallback? onShowOptions;
  final VoidCallback? onLinkToSpace;

  const _AlbumKebabMenu({
    required this.album,
    this.onDeleteAlbum,
    this.onAddUsers,
    this.onAddPhotos,
    this.onToggleAlbumOrder,
    this.onEditAlbum,
    this.onCreateSharedLink,
    this.onShowOptions,
    this.onLinkToSpace,
  });

  double _calculateScrollProgress(FlexibleSpaceBarSettings? settings) {
    if (settings?.maxExtent == null || settings?.minExtent == null) {
      return 1.0;
    }

    final deltaExtent = settings!.maxExtent - settings.minExtent;
    if (deltaExtent <= 0.0) {
      return 1.0;
    }

    return (1.0 - (settings.currentExtent - settings.minExtent) / deltaExtent).clamp(0.0, 1.0);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = context.dependOnInheritedWidgetOfExactType<FlexibleSpaceBarSettings>();
    final scrollProgress = _calculateScrollProgress(settings);

    final iconColor = Color.lerp(Colors.white, context.primaryColor, scrollProgress);
    final iconShadows = [
      if (scrollProgress < 0.95)
        Shadow(offset: const Offset(0, 2), blurRadius: 5, color: Colors.black.withValues(alpha: 0.5))
      else
        const Shadow(offset: Offset(0, 2), blurRadius: 0, color: Colors.transparent),
    ];

    final user = ref.watch(currentUserProvider);
    final isOwner = user != null && user.id == album.ownerId;

    return FutureBuilder<bool>(
      future: ref
          .read(remoteAlbumServiceProvider)
          .getUserRole(album.id, user?.id ?? '')
          .then((role) => role == AlbumUserRole.editor),
      builder: (context, snapshot) {
        final canAddPhotos = snapshot.data ?? false;

        return DriftRemoteAlbumOption(
          iconColor: iconColor,
          iconShadows: iconShadows,
          onDeleteAlbum: isOwner ? onDeleteAlbum : null,
          onAddUsers: isOwner ? onAddUsers : null,
          onAddPhotos: isOwner || canAddPhotos ? onAddPhotos : null,
          onToggleAlbumOrder: isOwner ? onToggleAlbumOrder : null,
          onEditAlbum: isOwner || canAddPhotos ? onEditAlbum : null,
          onCreateSharedLink: isOwner ? onCreateSharedLink : null,
          onShowOptions: onShowOptions,
          // L15: gated to owned albums (mirrors web's isOwned gate on the same affordance).
          onLinkToSpace: isOwner ? onLinkToSpace : null,
        );
      },
    );
  }
}

import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/theme_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/pages/user_selection.page.dart';
import 'package:immich_mobile/providers/auth.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/current_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_mobile/widgets/common/user_circle_avatar.dart';

@RoutePage()
class AlbumOptionsPage extends HookConsumerWidget {
  final RemoteAlbum album;
  const AlbumOptionsPage({super.key, required this.album});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sharedUsersAsync = ref.watch(remoteAlbumSharedUsersProvider(album.id));
    final userId = ref.watch(authProvider).userId;
    final activityEnabled = useState(album.isActivityEnabled);
    final isOwner = album.ownerId == userId;
    final owner = isOwner ? ref.watch(currentUserProvider) : null;
    final allUsers = isOwner ? null : ref.watch(usersProvider);

    void showErrorMessage() {
      ContextHelper(context).pop();
      ImmichToast.show(
        context: context,
        msg: context.t.shared_album_section_people_action_error,
        toastType: ToastType.error,
        gravity: ToastGravity.BOTTOM,
      );
    }

    Future<void> leaveAlbum() async {
      try {
        await ref.read(remoteAlbumProvider.notifier).leaveAlbum(album.id, userId: userId);
        if (!context.mounted) {
          return;
        }

        unawaited(context.navigateTo(const LibraryRoute()));
      } catch (_) {
        showErrorMessage();
      }
    }

    Future<void> removeUserFromAlbum(UserDto user) async {
      try {
        await ref.read(remoteAlbumProvider.notifier).removeUser(album.id, user.id);
        ref.invalidate(remoteAlbumSharedUsersProvider(album.id));
      } catch (_) {
        showErrorMessage();
      }

      ContextHelper(context).pop();
    }

    Future<void> addUsers() async {
      final newUsers = await context.pushRoute<List<String>>(UserSelectionRoute(album: album));

      if (newUsers == null || newUsers.isEmpty) {
        return;
      }

      try {
        if (!context.mounted) {
          return;
        }

        await ref.read(remoteAlbumProvider.notifier).addUsers(album.id, newUsers);
        ref.invalidate(remoteAlbumSharedUsersProvider(album.id));
        if (!context.mounted) {
          return;
        }

        ImmichToast.show(
          context: context,
          msg: context.t.users_added_to_album_count(count: newUsers.length),
          toastType: ToastType.success,
        );
      } catch (e) {
        if (!context.mounted) {
          return;
        }

        ImmichToast.show(context: context, msg: "Failed to add users to album: $e", toastType: ToastType.error);
      }
    }

    Padding buildSectionTitle(String text) {
      return Padding(
        padding: const EdgeInsets.all(16.0),
        child: Text(text, style: context.textTheme.bodySmall),
      );
    }

    // M8: mobile album owners can't view/revoke space links. `sharedSpaceLinks` is
    // owner-only and absent from the Drift sync stream, so it's fetched live via
    // GET /albums/:id (albumSharedSpaceLinksProvider) purely for owned albums.
    Future<void> unlinkSpace(String spaceId, String spaceName) async {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(ctx.t.unlink_album_from_space(space: spaceName)),
          content: Text(ctx.t.unlink_album_from_space_confirmation(space: spaceName)),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(ctx.t.cancel)),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
              child: Text(ctx.t.spaces_linked_albums_unlink),
            ),
          ],
        ),
      );
      if (confirmed != true) {
        return;
      }

      try {
        await ref.read(spaceAlbumActionsProvider).unlink(spaceId, album.id);
        ref.invalidate(albumSharedSpaceLinksProvider(album.id));
        if (context.mounted) {
          ImmichToast.show(context: context, msg: 'Album unlinked', toastType: ToastType.success);
        }
      } catch (_) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: context.t.spaces_linked_albums_error_unlink,
            toastType: ToastType.error,
          );
        }
      }
    }

    RenderObjectWidget buildLinkedSpacesList() {
      final linksAsync = ref.watch(albumSharedSpaceLinksProvider(album.id));
      return linksAsync.maybeWhen(
        data: (links) {
          if (links.isEmpty) {
            return const SizedBox();
          }

          return Column(
            key: const Key('album-linked-spaces-section'),
            children: [
              buildSectionTitle(context.t.linked_spaces),
              ListView.builder(
                primary: false,
                shrinkWrap: true,
                itemCount: links.length,
                itemBuilder: (context, index) {
                  final link = links[index];
                  return ListTile(
                    key: Key('album-space-link-${link.spaceId}'),
                    leading: const Icon(Icons.dashboard_customize_rounded),
                    title: Text(link.spaceName, style: const TextStyle(fontWeight: FontWeight.w500)),
                    subtitle: link.showInTimeline
                        ? null
                        : Text(
                            context.t.space_albums_hidden_from_timeline,
                            key: Key('album-space-link-hidden-badge-${link.spaceId}'),
                            style: TextStyle(color: context.colorScheme.onSurfaceSecondary),
                          ),
                    trailing: IconButton(
                      key: Key('album-space-link-unlink-${link.spaceId}'),
                      icon: const Icon(Icons.link_off_rounded),
                      onPressed: () => unlinkSpace(link.spaceId, link.spaceName),
                    ),
                  );
                },
              ),
            ],
          );
        },
        orElse: () => const SizedBox(),
      );
    }

    void handleUserClick(UserDto user) {
      var actions = [];

      if (user.id == userId) {
        actions = [
          ListTile(
            leading: const Icon(Icons.exit_to_app_rounded),
            title: Text(context.t.leave_album),
            onTap: leaveAlbum,
          ),
        ];
      }

      if (isOwner) {
        actions = [
          ListTile(
            leading: const Icon(Icons.person_remove_rounded),
            title: Text(context.t.remove_user),
            onTap: () => removeUserFromAlbum(user),
          ),
        ];
      }

      unawaited(
        showModalBottomSheet(
          backgroundColor: context.colorScheme.surfaceContainer,
          isScrollControlled: false,
          context: context,
          builder: (context) {
            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.only(top: 24.0),
                child: Column(mainAxisSize: MainAxisSize.min, children: [...actions]),
              ),
            );
          },
        ),
      );
    }

    Widget buildOwnerInfo() {
      if (isOwner) {
        return ListTile(
          leading: owner != null ? UserCircleAvatar(user: owner) : const SizedBox(),
          title: Text(album.ownerName, style: const TextStyle(fontWeight: FontWeight.w500)),
          subtitle: Text(owner?.email ?? "", style: TextStyle(color: context.colorScheme.onSurfaceSecondary)),
          trailing: Text(context.t.owner, style: context.textTheme.labelLarge),
        );
      } else {
        if (allUsers == null) {
          return const SizedBox();
        }

        return allUsers.maybeWhen(
          data: (users) {
            final user = users.firstWhereOrNull((u) => u.id == album.ownerId);

            if (user == null) {
              return const SizedBox();
            }

            return ListTile(
              leading: UserCircleAvatar(user: user),
              title: Text(user.name, style: const TextStyle(fontWeight: FontWeight.w500)),
              subtitle: Text(user.email, style: TextStyle(color: context.colorScheme.onSurfaceSecondary)),
              trailing: Text(context.t.owner, style: context.textTheme.labelLarge),
            );
          },
          orElse: () => const SizedBox(),
        );
      }
    }

    Widget buildSharedUsersList() {
      return sharedUsersAsync.maybeWhen(
        data: (sharedUsers) => ListView.builder(
          primary: false,
          shrinkWrap: true,
          itemCount: sharedUsers.length,
          itemBuilder: (context, index) {
            final user = sharedUsers[index];
            return ListTile(
              leading: UserCircleAvatar(user: user),
              title: Text(user.name, style: const TextStyle(fontWeight: FontWeight.w500)),
              subtitle: Text(user.email, style: TextStyle(color: context.colorScheme.onSurfaceSecondary)),
              trailing: userId == user.id || isOwner ? const Icon(Icons.more_horiz_rounded) : const SizedBox(),
              onTap: userId == user.id || isOwner ? () => handleUserClick(user) : null,
            );
          },
        ),
        orElse: () => const Center(child: CircularProgressIndicator()),
      );
    }

    return ProviderScope(
      overrides: [currentRemoteAlbumScopedProvider.overrideWithValue(album)],
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new_rounded),
            onPressed: () => context.maybePop(null),
          ),
          centerTitle: true,
          title: Text(context.t.options),
        ),
        body: ListView(
          children: [
            const SizedBox(height: 8),
            if (isOwner)
              SwitchListTile.adaptive(
                value: activityEnabled.value,
                onChanged: (bool value) async {
                  activityEnabled.value = value;
                  await ref.read(remoteAlbumProvider.notifier).setActivityStatus(album.id, value);
                },
                activeThumbColor: activityEnabled.value ? context.primaryColor : context.themeData.disabledColor,
                dense: true,
                title: Text(
                  context.t.comments_and_likes,
                  style: context.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w500),
                ),
                subtitle: Text(
                  context.t.let_others_respond,
                  style: context.textTheme.labelLarge?.copyWith(color: context.colorScheme.onSurfaceSecondary),
                ),
              ),
            buildSectionTitle(context.t.shared_album_section_people_title),
            if (isOwner) ...[
              ListTile(
                leading: const Icon(Icons.person_add_rounded),
                title: Text(context.t.invite_people),
                onTap: () async => addUsers(),
              ),
              const Divider(indent: 16),
            ],
            buildOwnerInfo(),
            buildSharedUsersList(),
            // M8: owner-only recourse to view/revoke the spaces this album is linked into.
            // Gated on isOwner so non-owners never trigger the GET /albums/:id fetch — the
            // server would return an empty list for them anyway (rbac-6).
            if (isOwner) buildLinkedSpacesList(),
          ],
        ),
      ),
    );
  }
}

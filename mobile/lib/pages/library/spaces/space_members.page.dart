import 'dart:async';
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:openapi/api.dart';

@RoutePage()
class SpaceMembersPage extends HookConsumerWidget {
  final String spaceId;

  const SpaceMembersPage({super.key, required this.spaceId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    String roleLabel(SharedSpaceRole role) => switch (role) {
      SharedSpaceRole.owner => context.t.owner,
      SharedSpaceRole.editor => context.t.role_editor,
      _ => context.t.role_viewer,
    };

    final membersAsync = ref.watch(sharedSpaceMembersProvider(spaceId));
    final currentUser = ref.watch(currentUserProvider);

    SharedSpaceMemberResponseDto? getCurrentMember(List<SharedSpaceMemberResponseDto> members) {
      return members.where((m) => m.userId == currentUser?.id).firstOrNull;
    }

    Future<void> removeMember(SharedSpaceMemberResponseDto member) async {
      final isLeaving = member.userId == currentUser?.id;
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(isLeaving ? ctx.t.spaces_leave : ctx.t.spaces_remove_member),
          content: Text(
            isLeaving
                ? ctx.t.spaces_leave_this_space_confirmation
                : ctx.t.spaces_remove_member_confirmation(name: member.name),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(ctx.t.cancel)),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
              child: Text(isLeaving ? ctx.t.leave : ctx.t.remove),
            ),
          ],
        ),
      );

      if (confirmed == true) {
        try {
          await ref.read(sharedSpaceApiRepositoryProvider).removeMember(spaceId, member.userId);
          // Only refetch the member list if we removed SOMEONE ELSE. When the
          // current user just left, hitting GET /shared-spaces/{id}/members
          // triggers a 403 "Not a member of this space" because the backend
          // permission check correctly rejects us. The spaces list is always
          // safe to refresh.
          if (!isLeaving) {
            ref.invalidate(sharedSpaceMembersProvider(spaceId));
          }
          ref.invalidate(sharedSpacesProvider);
          if (isLeaving && context.mounted) {
            // Signal to SpaceDetailPage that we just left, so it can pop
            // itself without trying to re-fetch this (now inaccessible) space.
            await context.maybePop<String>('left');
          } else if (context.mounted) {
            ImmichToast.show(
              context: context,
              msg: context.t.spaces_activity_was_removed(name: member.name),
              toastType: ToastType.success,
            );
          }
        } catch (e) {
          if (context.mounted) {
            ImmichToast.show(context: context, msg: context.t.errors.error_removing_member, toastType: ToastType.error);
          }
        }
      }
    }

    Future<void> updateRole(SharedSpaceMemberResponseDto member, SharedSpaceRole newRole) async {
      try {
        await ref.read(sharedSpaceApiRepositoryProvider).updateMember(spaceId, member.userId, newRole);
        ref.invalidate(sharedSpaceMembersProvider(spaceId));
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: context.t.spaces_changed_role(name: member.name, role: roleLabel(newRole)),
            toastType: ToastType.success,
          );
        }
      } catch (e) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: context.t.errors.error_updating_member_role,
            toastType: ToastType.error,
          );
        }
      }
    }

    void showMemberActions(SharedSpaceMemberResponseDto member, bool isOwner) {
      unawaited(
        showModalBottomSheet(
          context: context,
          builder: (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(member.name, style: context.textTheme.titleMedium),
                ),
                if (isOwner && member.role != SharedSpaceRole.owner) ...[
                  ListTile(
                    leading: const Icon(Icons.edit_outlined),
                    title: Text(ctx.t.role_editor),
                    trailing: member.role == SharedSpaceRole.editor ? const Icon(Icons.check) : null,
                    onTap: () {
                      Navigator.of(ctx).pop();
                      unawaited(updateRole(member, SharedSpaceRole.editor));
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.visibility_outlined),
                    title: Text(ctx.t.role_viewer),
                    trailing: member.role == SharedSpaceRole.viewer ? const Icon(Icons.check) : null,
                    onTap: () {
                      Navigator.of(ctx).pop();
                      unawaited(updateRole(member, SharedSpaceRole.viewer));
                    },
                  ),
                  const Divider(),
                  ListTile(
                    leading: Icon(Icons.person_remove_outlined, color: Theme.of(ctx).colorScheme.error),
                    title: Text(ctx.t.remove_from_space, style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      unawaited(removeMember(member));
                    },
                  ),
                ],
                if (!isOwner && member.userId == currentUser?.id)
                  ListTile(
                    leading: Icon(Icons.exit_to_app, color: Theme.of(ctx).colorScheme.error),
                    title: Text(ctx.t.spaces_leave, style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      unawaited(removeMember(member));
                    },
                  ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(context.t.members),
        centerTitle: false,
        actions: [
          membersAsync.when(
            data: (members) {
              final currentMember = getCurrentMember(members);
              if (currentMember?.role == SharedSpaceRole.owner) {
                return IconButton(
                  icon: const Icon(Icons.person_add_outlined),
                  onPressed: () async {
                    final existingIds = members.map((m) => m.userId).toList();
                    await context.pushRoute(
                      SpaceMemberSelectionRoute(spaceId: spaceId, existingMemberIds: existingIds),
                    );
                    ref.invalidate(sharedSpaceMembersProvider(spaceId));
                  },
                  tooltip: context.t.spaces_add_member,
                );
              }
              return const SizedBox.shrink();
            },
            loading: () => const SizedBox.shrink(),
            error: (_, _) => const SizedBox.shrink(),
          ),
        ],
      ),
      body: membersAsync.when(
        data: (members) {
          final currentMember = getCurrentMember(members);
          final isOwner = currentMember?.role == SharedSpaceRole.owner;

          return ListView.builder(
            itemCount: members.length,
            itemBuilder: (context, index) {
              final member = members[index];
              return ListTile(
                leading: CircleAvatar(child: Text(member.name.isNotEmpty ? member.name[0].toUpperCase() : '?')),
                title: Text(member.name),
                subtitle: Text(member.email),
                trailing: Chip(
                  label: Text(roleLabel(member.role), style: context.textTheme.labelSmall),
                  padding: EdgeInsets.zero,
                  visualDensity: VisualDensity.compact,
                ),
                onTap:
                    (isOwner && member.role != SharedSpaceRole.owner) || (!isOwner && member.userId == currentUser?.id)
                    ? () => showMemberActions(member, isOwner)
                    : null,
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text(context.t.spaces_members_load_failed(error: '$error'))),
      ),
    );
  }
}

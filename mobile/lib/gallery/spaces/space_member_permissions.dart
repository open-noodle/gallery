import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:openapi/api.dart';

/// Field names accepted by [SharedSpaceApiRepository.updateMemberPermission].
const spaceEditorsCanAddMembersField = 'editorsCanAddMembers';
const spaceEditorsCanChangeRolesField = 'editorsCanChangeRoles';

SharedSpaceMemberManagementDto? _block(SharedSpaceResponseDto? space) {
  if (space == null) {
    return null;
  }
  final optional = space.memberManagement;
  return optional.isPresent ? optional.value : null;
}

/// Whether the viewer may add members to [space]. A server that predates the feature sends no
/// `memberManagement` block: fall back to today's rule (owners only).
bool canAddSpaceMembers(SharedSpaceResponseDto? space, SharedSpaceRole? role) =>
    _block(space)?.canAddMembers ?? role == SharedSpaceRole.owner;

/// Whether the viewer may switch members between viewer and editor. Same fail-closed fallback.
bool canChangeSpaceRoles(SharedSpaceResponseDto? space, SharedSpaceRole? role) =>
    _block(space)?.canChangeRoles ?? role == SharedSpaceRole.owner;

/// Owner-only controls for the two per-space member-management overrides. Each is a
/// three-way choice: server default, on, off. Renders nothing against an older server.
class SpaceMemberPermissionSettings extends ConsumerWidget {
  final String spaceId;
  final SharedSpaceResponseDto space;

  const SpaceMemberPermissionSettings({super.key, required this.spaceId, required this.space});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final block = _block(space);
    if (block == null) {
      return const SizedBox.shrink();
    }

    Future<void> change(String field, bool? value) async {
      try {
        await ref.read(sharedSpaceApiRepositoryProvider).updateMemberPermission(spaceId, field: field, value: value);
        ref.invalidate(sharedSpaceProvider(spaceId));
      } catch (_) {
        if (context.mounted) {
          ImmichToast.show(context: context, msg: 'Failed to update setting', toastType: ToastType.error);
        }
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _PermissionChoice(
          label: context.t.spaces_editors_can_add_members,
          value: block.editorsCanAddMembers,
          serverDefault: block.serverEditorsCanAddMembers,
          onChanged: (v) => change(spaceEditorsCanAddMembersField, v),
        ),
        _PermissionChoice(
          label: context.t.spaces_editors_can_change_roles,
          value: block.editorsCanChangeRoles,
          serverDefault: block.serverEditorsCanChangeRoles,
          onChanged: (v) => change(spaceEditorsCanChangeRolesField, v),
        ),
        const Divider(),
      ],
    );
  }
}

class _PermissionChoice extends StatelessWidget {
  final String label;
  final bool? value;
  final bool serverDefault;
  final Future<void> Function(bool?) onChanged;

  const _PermissionChoice({
    required this.label,
    required this.value,
    required this.serverDefault,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final defaultLabel = serverDefault
        ? context.t.spaces_member_permission_server_default_on
        : context.t.spaces_member_permission_server_default_off;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: context.textTheme.titleSmall),
          const SizedBox(height: 8),
          SegmentedButton<bool?>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment<bool?>(value: null, label: Text(defaultLabel, textAlign: TextAlign.center)),
              ButtonSegment<bool?>(value: true, label: Text(context.t.spaces_member_permission_on)),
              ButtonSegment<bool?>(value: false, label: Text(context.t.spaces_member_permission_off)),
            ],
            selected: {value},
            onSelectionChanged: (s) => onChanged(s.first),
          ),
        ],
      ),
    );
  }
}

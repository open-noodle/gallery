import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:openapi/api.dart';

/// L15 — minimal "Link to space" picker, the reverse of [SpaceLinkAlbumPage]
/// (which picks albums FROM a space). This one picks a SPACE from an album,
/// then the caller links the album to it via the existing
/// [SpaceAlbumActions.link] / `PUT /shared-spaces/{id}/albums/{albumId}` path.
///
/// Kept as a bottom sheet rather than a routed `@RoutePage()` page — this is a
/// net-new, minimal entry point; a full auto_route page (with the associated
/// router codegen) isn't warranted for a one-tap list.
///
/// Lists only spaces the current user can write to (Owner/Editor) — matches
/// the gating already applied by [SpaceLinkAlbumPage] on the album side and
/// the web `SpacePickerModal` counterpart.
class SpaceLinkPickerSheet extends ConsumerWidget {
  const SpaceLinkPickerSheet({super.key});

  /// Shows the picker as a modal bottom sheet and resolves with the selected
  /// space, or `null` if the user dismissed it without picking one.
  static Future<SharedSpaceResponseDto?> show(BuildContext context) {
    return showModalBottomSheet<SharedSpaceResponseDto>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const SpaceLinkPickerSheet(),
    );
  }

  static bool _canWrite(SharedSpaceResponseDto space, String? currentUserId) {
    if (currentUserId == null) return false;
    if (space.createdById == currentUserId) return true;
    final role = (space.members.value ?? const []).where((m) => m.userId == currentUserId).firstOrNull?.role;
    return role == SharedSpaceRole.owner || role == SharedSpaceRole.editor;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final spacesAsync = ref.watch(sharedSpacesProvider);
    final currentUserId = ref.watch(currentUserProvider.select((u) => u?.id));

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Text('link_album_to_space'.t(context: context), style: context.textTheme.titleMedium),
            ),
            Flexible(
              child: spacesAsync.when(
                data: (spaces) {
                  final writable = spaces.where((s) => _canWrite(s, currentUserId)).toList();
                  if (writable.isEmpty) {
                    return _CenteredMessage(text: 'spaces_no_writable_spaces'.t(context: context));
                  }
                  return ListView.builder(
                    shrinkWrap: true,
                    itemCount: writable.length,
                    itemBuilder: (context, index) {
                      final space = writable[index];
                      return ListTile(
                        key: Key('space-link-picker-row-${space.id}'),
                        leading: const Icon(Icons.photo_library_outlined),
                        title: Text(space.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                        onTap: () => Navigator.of(context).pop(space),
                      );
                    },
                  );
                },
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 32),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (_, _) => _CenteredMessage(text: 'failed_to_load_spaces'.t(context: context)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CenteredMessage extends StatelessWidget {
  const _CenteredMessage({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

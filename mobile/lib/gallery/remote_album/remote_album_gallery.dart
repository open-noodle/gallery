import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/remote_album/space_link_picker.widget.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/widgets/common/date_time_picker.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:intl/intl.dart';

// Gallery additions to remote_album.page.dart: "Link to space" and the album created-date field.

/// L15 — "Link to space" entry point from the album itself: opens the
/// space picker (Owner/Editor spaces) and links this album to the selected
/// space via the same [SpaceAlbumActions.link] path already used from
/// inside a space (B6 / `SpaceDetailPage._onAlbumsPicked`).
Future<void> linkAlbumToSpace(BuildContext context, WidgetRef ref, String albumId) async {
  final space = await SpaceLinkPickerSheet.show(context);
  if (space == null || !context.mounted) {
    return;
  }

  try {
    await ref.read(spaceAlbumActionsProvider).link(space.id, [albumId]);
    if (context.mounted) {
      ImmichToast.show(
        context: context,
        msg: context.t.album_linked_to_space(space: space.name),
        toastType: ToastType.success,
      );
    }
  } catch (_) {
    if (context.mounted) {
      ImmichToast.show(context: context, msg: context.t.spaces_linked_albums_error_link, toastType: ToastType.error);
    }
  }
}

/// The edit-album dialog's created-date row (label plus a tile that opens the date-time picker).
class AlbumCreatedAtField extends StatelessWidget {
  final DateTime createdAt;
  final ValueChanged<DateTime> onChanged;

  const AlbumCreatedAtField({super.key, required this.createdAt, required this.onChanged});

  Future<void> _pickCreatedAt(BuildContext context) async {
    // Returns an ISO string with a +HH:MM offset, or null when dismissed —
    // same contract action.service.dart:202-219 consumes for asset dates.
    final picked = await showDateTimePicker(context: context, initialDateTime: createdAt);
    if (picked == null) {
      return;
    }
    onChanged(DateTime.parse(picked).toLocal());
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 18),

        // Created date
        Text(
          context.t.date_created.toUpperCase(),
          style: context.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        ListTile(
          key: const Key('album-edit-created-at'),
          tileColor: context.colorScheme.surface,
          shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
          title: Text(DateFormat.yMMMd().format(createdAt), style: context.textTheme.bodyMedium),
          trailing: Icon(Icons.edit_outlined, size: 18, color: context.colorScheme.primary),
          onTap: () => _pickCreatedAt(context),
        ),
      ],
    );
  }
}

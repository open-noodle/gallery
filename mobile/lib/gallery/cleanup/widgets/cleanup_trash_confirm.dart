import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// The words of a trash confirmation.
class LibraryCleanupTrashPrompt {
  const LibraryCleanupTrashPrompt({this.title, required this.message, required this.confirm, required this.permanent});

  /// "Permanently delete" when the trash is off; no title otherwise.
  final String? title;
  final String message;
  final String confirm;

  /// The trash is off: nothing can be undone.
  final bool permanent;
}

/// The prompt for [check], made of the sentences the web's `confirmCleanupTrash` composes
/// (`web/src/lib/gallery/cleanup/cleanup-actions.ts`), or null when nothing needs confirming.
///
/// With the trash off: the permanent sentence, then the space and external-library sentences when they apply. With the
/// trash on: the space sentence and the external-library sentence, whichever apply.
LibraryCleanupTrashPrompt? libraryCleanupTrashPrompt(BuildContext context, LibraryCleanupTrashCheck check) {
  if (!check.needsConfirmation) {
    return null;
  }
  final t = context.t;
  final external = check.externalCount > 0
      ? [t.cleanup_external_library_warning(count: check.externalCount)]
      : const <String>[];
  if (!check.trashEnabled) {
    return LibraryCleanupTrashPrompt(
      title: t.permanently_delete,
      message: [
        t.cleanup_permanent_delete_prompt(count: check.trashCount),
        if (check.inSpacesCount > 0) t.cleanup_permanent_delete_space_warning(count: check.inSpacesCount),
        ...external,
      ].join(' '),
      confirm: t.permanently_delete,
      permanent: true,
    );
  }
  return LibraryCleanupTrashPrompt(
    message: [if (check.inSpacesCount > 0) t.cleanup_space_warning(count: check.inSpacesCount), ...external].join(' '),
    confirm: t.trash,
    permanent: false,
  );
}

/// Asks the user to confirm a trash commit, as a [LibraryCleanupConfirm] would. Resolves true at once when nothing
/// needs confirming, and false when the dialog is cancelled or dismissed.
Future<bool> showLibraryCleanupTrashConfirm(BuildContext context, LibraryCleanupTrashCheck check) async {
  final prompt = libraryCleanupTrashPrompt(context, check);
  if (prompt == null) {
    return true;
  }
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) {
      final colors = Theme.of(context).colorScheme;
      return AlertDialog(
        key: const Key('cleanup-trash-confirm'),
        title: prompt.title == null ? null : Text(prompt.title!),
        content: Text(prompt.message),
        actions: [
          TextButton(
            key: const Key('cleanup-trash-confirm-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.t.cancel),
          ),
          TextButton(
            key: const Key('cleanup-trash-confirm-ok'),
            style: TextButton.styleFrom(foregroundColor: colors.error),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(prompt.confirm),
          ),
        ],
      );
    },
  );
  return confirmed ?? false;
}

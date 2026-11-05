import 'package:flutter/material.dart';
import 'package:immich_ui/immich_ui.dart';

/// The error snackbar of `immich_ui`, with room for an explanation.
///
/// The shared one (`snackbar.error`) clips its message at two lines, which cut a linked album's name and the
/// instruction after it off the "photos that stay" message of a removal from a space. It is upstream's, so it keeps
/// its limit; this draws the same snackbar with more lines. Built without a context, like the shared one.
void showLongErrorSnackbar(String message, {Duration duration = const Duration(seconds: 6)}) {
  final messenger = scaffoldMessengerKey.currentState;
  final context = scaffoldMessengerKey.currentContext;
  if (messenger == null || context == null) {
    return;
  }

  final theme = Theme.of(context);
  final colors = theme.extension<ImmichColors>() ?? ImmichColors.harmonized(theme.colorScheme);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: colors.error,
      duration: duration,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(ImmichRadius.sm))),
      persist: false,
      content: Row(
        children: [
          Icon(Icons.warning_rounded, color: colors.onError, size: ImmichIconSize.sm),
          const SizedBox(width: ImmichSpacing.md),
          Expanded(
            child: Text(
              message,
              maxLines: 6,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: colors.onError, fontWeight: FontWeight.w600, fontSize: ImmichTextSize.body),
            ),
          ),
        ],
      ),
    ),
  );
}

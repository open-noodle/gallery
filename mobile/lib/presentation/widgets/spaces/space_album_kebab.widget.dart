import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// Space-role-gated kebab menu for the Space Album detail page.
///
/// When [canEdit] is false, renders [SizedBox.shrink] (no menu).
/// When [canEdit] is true, renders a [PopupMenuButton] with exactly 3 items:
///   - Add photos   (Key: space-album-kebab-add)
///   - Show in timeline / Hide from timeline  (Key: space-album-kebab-toggle)
///   - Unlink from space  (Key: space-album-kebab-unlink)
///
/// The [onAddPhotos], [onToggleTimeline], [onUnlink] callbacks are B6 stubs —
/// they are no-ops in B4.
class SpaceAlbumKebab extends StatelessWidget {
  const SpaceAlbumKebab({
    super.key,
    required this.canEdit,
    required this.showInTimeline,
    required this.onAddPhotos,
    required this.onToggleTimeline,
    required this.onUnlink,
    this.toggleEnabled = true,
  });

  final bool canEdit;
  final bool showInTimeline;
  final VoidCallback onAddPhotos;
  final VoidCallback onToggleTimeline;
  final VoidCallback onUnlink;

  /// Whether the "Show/Hide in timeline" menu item is interactive.
  ///
  /// Set to [false] while the album stream is unresolved so an editor who
  /// taps the item before metadata loads neither no-ops silently nor triggers
  /// a premature mutation.
  final bool toggleEnabled;

  @override
  Widget build(BuildContext context) {
    if (!canEdit) return const SizedBox.shrink();

    return PopupMenuButton<_KebabAction>(
      onSelected: (action) {
        switch (action) {
          case _KebabAction.add:
            onAddPhotos();
          case _KebabAction.toggle:
            onToggleTimeline();
          case _KebabAction.unlink:
            onUnlink();
        }
      },
      itemBuilder: (context) => [
        PopupMenuItem<_KebabAction>(
          key: const Key('space-album-kebab-add'),
          value: _KebabAction.add,
          child: Text('add_photos'.t(context: context)),
        ),
        PopupMenuItem<_KebabAction>(
          key: const Key('space-album-kebab-toggle'),
          value: _KebabAction.toggle,
          enabled: toggleEnabled,
          child: Text(
            showInTimeline
                ? 'spaces_hide_from_timeline'.t(context: context)
                : 'spaces_linked_albums_show_in_timeline'.t(context: context),
          ),
        ),
        PopupMenuItem<_KebabAction>(
          key: const Key('space-album-kebab-unlink'),
          value: _KebabAction.unlink,
          child: Text('space_album_unlink_from_space'.t(context: context)),
        ),
      ],
    );
  }
}

enum _KebabAction { add, toggle, unlink }

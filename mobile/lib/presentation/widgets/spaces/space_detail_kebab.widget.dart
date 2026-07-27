import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// Role-gated overflow menu for the space detail page.
///
/// Extracted from [SpaceDetailPage] so the RBAC table can be widget-tested without
/// pumping a routed page that loads network metadata, members and a Drift timeline.
/// Mirrors the existing [SpaceAlbumKebab].
///
/// Naming and appearance are editor-level server-side, so the menu itself is shown
/// for [canEdit]; only deletion is restricted further, via [canDelete].
class SpaceDetailKebab extends StatelessWidget {
  const SpaceDetailKebab({
    super.key,
    required this.canEdit,
    required this.canDelete,
    required this.onEdit,
    required this.onDelete,
  });

  final bool canEdit;
  final bool canDelete;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    if (!canEdit) return const SizedBox.shrink();

    return PopupMenuButton<_KebabAction>(
      key: const Key('space-detail-kebab'),
      onSelected: (action) => switch (action) {
        _KebabAction.edit => onEdit(),
        _KebabAction.delete => onDelete(),
      },
      itemBuilder: (context) => [
        PopupMenuItem<_KebabAction>(
          key: const Key('space-detail-kebab-edit'),
          value: _KebabAction.edit,
          child: Text('spaces_edit'.t(context: context)),
        ),
        if (canDelete)
          PopupMenuItem<_KebabAction>(
            key: const Key('space-detail-kebab-delete'),
            value: _KebabAction.delete,
            child: Text('spaces_delete'.t(context: context)),
          ),
      ],
    );
  }
}

enum _KebabAction { edit, delete }
